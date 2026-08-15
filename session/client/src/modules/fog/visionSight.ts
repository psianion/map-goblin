// S3 P2 §2 — what the party can see *right now*, on the client, and the memo that keeps a
// party standing still from paying for it twice.
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
import type { DungeonLayer, Layer } from '@dnd/core/src/store/types';
import type { Token } from '@dnd/mechanics/tokens';

/**
 * The tokens the party's mask is drawn through — the server's filter, to the character: a
 * claimed token is a player at the table, an unclaimed one is scenery the DM moves, a hidden
 * one has been taken off the board, and a token with no sight is not looking at anything.
 */
export const sighted = (tokens: readonly Token[]): Token[] =>
  tokens.filter((t) => t.ownerId !== null && !t.hidden && (t.sight?.range ?? 0) > 0);

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
 * The occluders the *referee* swept against, rebuilt here — which is a copy of core's dungeon
 * layers with `mergedFloor` nulled, and that field is the whole reason the copy exists.
 *
 * The server sweeps over the map document, where `mergedFloor` is null on disk: core
 * recomputes it on every load and nothing ever saves it (even the dressed gate map ships
 * null), so a floor ring is not an occluder there — the authored walls are. Core's store
 * *has* recomputed it, and `resolveWalls` promotes every ring edge to a light-blocking wall,
 * so sweeping the layers as they stand would box the party inside their own floor and answer
 * "what can they see" differently from the referee that is redacting their tokens.
 *
 * The id is suffixed because `resolveWalls`/`resolveDoors` memoize per layer *id*: sharing
 * one with the lighting pass, which resolves the same layer *with* its floor rings, would
 * make every resolve a miss for both. This pass gets its own slot, and its memo keys — the
 * untouched `standaloneWalls` array and a constant null — are stable across rebuilds.
 *
 * ponytail: a player holds fewer walls than the DM (D4), so a sweep can run further here than
 * the server's does wherever it escapes into geometry they were never sent. That clears void
 * — map the referee is not fogging at all — so it errs open on nothing rather than dark on
 * something; the day it matters, the fix is the server sending the mask, not more walls.
 */
const sightLayers = (layers: readonly Layer[]): DungeonLayer[] =>
  layers
    .filter((layer): layer is DungeonLayer => layer.type === 'dungeon')
    .map((layer) => ({ ...layer, id: `${layer.id}\0sight`, mergedFloor: null }));

export interface SightCache {
  /** One polygon per token given, in that order. Feed it {@link sighted}. */
  partySight(layers: readonly Layer[], tokens: readonly Token[]): Polygon[];
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
    quadtree.build(extractWallSegments(sightLayers(layers)));
    const next: Built = { quadtree, polygons: new Map() };
    cache.set(layers, next);
    return next;
  };

  return {
    sweeps: () => sweeps,

    partySight(layers, tokens) {
      if (tokens.length === 0) return [];
      const built = builtFor(layers);
      if (built.polygons.size > SWEEP_CAP) built.polygons.clear();
      return tokens.map((token) => {
        const range = token.sight!.range;
        // Purely geometric in P2, like the server's: `visionMode: 'darkvision'` sweeps the
        // same as normal — the light gate is P3 — and `sight.angle` is ignored (a v1
        // non-goal), so the key is where the token stands and how far it sees, nothing else.
        const key = `${token.x},${token.y},${range}`;
        let polygon = built.polygons.get(key);
        if (!polygon) {
          sweeps += 1;
          polygon = clockwiseSweep(
            [token.x, token.y],
            range,
            built.quadtree.query(
              token.x - range,
              token.y - range,
              token.x + range,
              token.y + range,
            ),
          ).map((v) => v.point);
          built.polygons.set(key, polygon);
        }
        return polygon;
      });
    },
  };
}

/** The one the mask uses. A second instance would be a second cache over the same answers. */
export const sightCache = createSightCache();
