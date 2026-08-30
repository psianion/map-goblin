// S3 P2 §2 — what the party can see *right now*, on the client, and the memo that keeps a
// party standing still from paying for it twice. P3 §2 adds the other half of the same
// question in the dark — what the scene's lights reach — and it is the same sweep from a
// different origin, so it shares the occluders and the memo rather than growing a pass of
// its own.
//
// No geometry is written here, the same claim the server's `fog/sweep.ts` makes about its
// half: `clockwiseSweep`, `SegmentQuadtree` and `extractWallSegments` are core's own lighting
// pass, already pure, and `LightManager.getOrComputePolygon` is the memo shape this mirrors —
// quadtree query, sweep, cache by key, recompute only what moved.
//
// The live door state is already on the layers this reads. `syncDoorsToLighting` writes the
// table's answer onto the core store's own door children so core's sight pass sees it (D12),
// and this pass reads the same layers, so a door the party just opened is open for both. A
// player's copy of those layers is the redacted document, so an unfound secret door is absent
// from it, the wall it sits on is never split, and it occludes end to end — which is exactly
// what the server's sweep answers for the same party.

import { clockwiseSweep } from '@dnd/core/src/engine/lighting/ClockwiseSweep';
import { SegmentQuadtree } from '@dnd/core/src/engine/lighting/SegmentQuadtree';
import { extractWallSegments } from '@dnd/core/src/engine/lighting/raycaster';
import type { Polygon } from '@dnd/core/src/geometry/GeometryEngine';
import type { LightChild } from '@dnd/core/src/shared/types';
import type { DungeonLayer, Layer } from '@dnd/core/src/store/types';
import { SIGHT_REACH, type LightSource, type PlacedLight } from '@dnd/mechanics/fog';
import { sightParty, type Token } from '@dnd/mechanics/tokens';
import { isTokenLight } from '../triggers/lightSync';

/**
 * The tokens the mask is drawn through — the server's filter, to the character: a claimed
 * token is a player at the table, an unclaimed one is scenery the DM moves, a hidden one has
 * been taken off the board, and a token with no sight is not looking at anything.
 *
 * Literally the server's filter now (P4 §4): `sightParty` is the shared predicate the referee's
 * own sweep runs, imported rather than mirrored, so a sight link the DM makes cannot widen what
 * a player is *sent* without widening what their mask lets them *see*.
 *
 * P5 — `isSeed` is where `visionShare` lands, and it is the whole client-side change: in
 * individual share this seat seeds on its *own* claimed tokens (`ownerId === you.identityId`)
 * and the closure carries their linked familiars in, exactly as the referee's own per-seat
 * sweep does. It is not belt-and-braces: a seat is legitimately sent the other party members'
 * tokens whenever they walk into its sight, and drawing the mask through those eyes too would
 * hand it back the party view the DM just turned off.
 */
export const sighted = (tokens: readonly Token[], isSeed?: (token: Token) => boolean): Token[] =>
  sightParty(tokens, isSeed).filter((t) => (t.sight?.range ?? 0) > 0);

/**
 * ponytail: one entry per layers array, holding every sweep taken against that geometry, and
 * capped so a party walking a long corridor cannot grow it without bound. A per-token LRU is
 * the upgrade the day a table measures one.
 */
const SWEEP_CAP = 256;

interface Built {
  quadtree: SegmentQuadtree;
  polygons: Map<string, Polygon>;
}

/**
 * Every authored light this tab holds, for the shared light rule (S3 P3 §2).
 *
 * Off core's layers rather than the redacted document, and for the reason the sweep is: these
 * are the same light children `LightManager` renders from, so the pool the player sees and the
 * pool their mask clears cannot be two different circles. A player's copy carries only the
 * lights inside the rooms they hold, which is the referee's own cut, not a second one.
 *
 * *Placed* is the operative word: `lightSync` also writes a pseudo-light child per carried
 * torch onto these same layers so the renderer draws its pool, and the token behind it is
 * already a source in its own right (`lightSources`). Reading both would sweep one torch
 * twice — harmless only while the two radii agree by coincidence, and a real divergence the
 * day dim and bright stop being one number (D4).
 */
export const placedLights = (layers: readonly Layer[]): PlacedLight[] =>
  layers
    .filter((layer): layer is DungeonLayer => layer.type === 'dungeon')
    .flatMap((layer) =>
      layer.children
        .filter(
          (child): child is LightChild =>
            child.childType === 'light' && !isTokenLight(child.id),
        )
        .map((light) => ({
          id: light.id,
          x: light.position.x,
          y: light.position.y,
          radius: light.radius,
          visible: light.visible,
        })),
    );

export interface SightCache {
  /**
   * One line-of-sight polygon per token given, in that order. Feed it {@link sighted}.
   *
   * `rangeLimited` is the scene's `sightRangeLimit`, and it must be the same answer the
   * referee swept with (`sweep.ts`) or the mask draws sight the server never granted.
   */
  partySight(
    layers: readonly Layer[],
    tokens: readonly Token[],
    rangeLimited?: boolean,
  ): Polygon[];
  /** One polygon per light source given, in that order. Feed it `lightSources`. */
  litArea(layers: readonly Layer[], sources: readonly LightSource[]): Polygon[];
  /** How many sweeps have actually been taken — the memo's own instrument. */
  sweeps(): number;
}

/**
 * Keyed on the layers array itself rather than on a door key of its own.
 *
 * Core's store is immer-backed, so it replaces that array wholesale on every write, and both
 * writes that can move a sweep are writes to it: a door swinging (`syncDoorsToLighting`
 * stamps the new state onto the door child) and a reveal delta landing (the map grows). A
 * stale entry is then unreachable by construction and there is no invalidation call anywhere
 * to forget — the same reason `createSweeps` keys on the parsed map object server-side.
 */
export function createSightCache(): SightCache {
  const cache = new WeakMap<readonly Layer[], Built>();
  let sweeps = 0;

  const builtFor = (layers: readonly Layer[]): Built => {
    const hit = cache.get(layers);
    if (hit) return hit;
    const quadtree = new SegmentQuadtree();
    // The occluders the party's own sweep is taken against — core's dungeon layers, as they
    // stand, `mergedFloor` included.
    //
    // Used to sweep a copy with `mergedFloor` nulled out under a suffixed id, because the
    // server's own sweep read a persisted map where the field ships null (mergedFloor.ts:21-27
    // strips it on save) — a floor ring was not an occluder there, only the authored walls
    // were, and the two passes had to agree or a party could see through a cave's rock on one
    // side and not the other. The server now heals that null at scene-index time
    // (session/server/src/fog/sceneMap.ts's `healMergedFloor`, gated on Clipper2 actually
    // being loaded — session/server/src/fog/clipperBoot.ts), so both sides occlude on the same
    // union. Sweeping the real layers here, unmodified, lets this pass share `resolveWalls`'
    // memo with the lighting pass outright instead of paying for a second resolve of the same
    // geometry under a second id.
    //
    // ponytail: a player holds fewer walls than the DM (D4), so this sweep can still run
    // further than the server's wherever it escapes into geometry they were never sent — that
    // clears void, so it errs open on nothing rather than dark on something. The DM's own copy
    // (the fuller layer set) is asymmetric with a player's redacted one the same way; both
    // residual gaps err the identical direction, dark rather than a leak, so neither is worth
    // closing until a table actually measures one. The day it matters, the fix is the server
    // sending the mask, not more or fewer walls.
    quadtree.build(extractWallSegments(layers.filter((l): l is DungeonLayer => l.type === 'dungeon')));
    const next: Built = { quadtree, polygons: new Map() };
    cache.set(layers, next);
    return next;
  };

  /**
   * One sweep, memoized on where it starts and how far it reaches — which is the whole key
   * either way, so an eye and a torch standing in the same spot with the same reach share the
   * answer. `visionMode: 'darkvision'` sweeps the same geometry as a normal eye (P3 changes
   * the light test, not the shadowcast) and `sight.angle` is ignored (a v1 non-goal).
   */
  const sweepAt = (built: Built, x: number, y: number, radius: number): Polygon => {
    const key = `${x},${y},${radius}`;
    let polygon = built.polygons.get(key);
    if (!polygon) {
      sweeps += 1;
      polygon = clockwiseSweep(
        [x, y],
        radius,
        built.quadtree.query(x - radius, y - radius, x + radius, y + radius),
      ).map((v) => v.point);
      built.polygons.set(key, polygon);
    }
    return polygon;
  };

  const sweepAll = (layers: readonly Layer[], origins: readonly LightSource[]): Polygon[] => {
    if (origins.length === 0) return [];
    const built = builtFor(layers);
    if (built.polygons.size > SWEEP_CAP) built.polygons.clear();
    return origins.map((o) => sweepAt(built, o.x, o.y, o.radius));
  };

  return {
    sweeps: () => sweeps,

    // Line of sight, to the whole map — the referee's own reach (`sweep.ts`). A token's
    // `range` bounds only what it sees *unlit*, which is the darkvision sweep the renderer
    // takes through `litArea` at that radius.
    //
    // …unless the DM has turned `sightRangeLimit` on, which is the switch for a map with no
    // walls to bound a sweep. Then the reach *is* the range, here exactly as on the referee.
    partySight: (layers, tokens, rangeLimited) =>
      sweepAll(
        layers,
        tokens.map((token) => ({
          x: token.x,
          y: token.y,
          radius: rangeLimited ? (token.sight?.range ?? SIGHT_REACH) : SIGHT_REACH,
        })),
      ),

    litArea: (layers, sources) => sweepAll(layers, sources),
  };
}

/** The one the mask uses. A second instance would be a second cache over the same answers. */
export const sightCache = createSightCache();
