// The fog layer, on every seat. With fog on, the map frame is covered by the living cloud
// (`livingFog.ts`) except the ground cleared on the level shown: the cleared record is the mask,
// composited on the GPU (`tierPlan` + `tierCompositor`). Off, nothing is drawn at all.
//
// A player's seat draws it solid, over a flat black scrim that is the fail-dark backstop: if the
// shader never draws, fogged ground is still black. The DM's seat draws the same cloud
// see-through with a line on its edge, so the DM reads where the players' fog lies without losing
// the map under it; "As players see it" (`asPlayers.ts`) draws the DM's seat solid instead.
//
// Where this sits is load-bearing. The engine composites lighting as a screen-space multiply
// *after* the world container, so the fog mounts above that composite and mirrors the camera:
// the lighting is composited beneath the fog, never recomputed for it.
//
// The two stencils the overlays above the map wear (`SIGHT_MASK` for the token chips and the
// turn ring, `SHOWN_MASK` for the door marks) are both the mask itself, carried by two sprites.
// They are labelled only where the fog is drawn solid: a wearer that finds no stencil draws
// unmasked, which is what a seat with fog off, or the DM's own view, wants.
//
// ponytail: pixi through @dnd/core, the same reach-through TokenRenderer documents.
import { Container, Graphics, Sprite } from 'pixi.js';
import type { Polygon } from '@dnd/core/src/geometry/GeometryEngine';
import type { Layer } from '@dnd/core/src/store/types';
import type { RenderEngine } from '@dnd/core/src/engine/RenderEngine';
import type { SceneGraph } from '@dnd/core/src/engine/sceneGraph';
import { useStore } from '@dnd/core/src/store/store';
import { clearedOn, fogOn, getCell, lightSources, rebaseRegion, type FogState, type RegionMask } from '@dnd/mechanics/fog';
import { SIZE_CELLS, type Token, type TokensState } from '@dnd/mechanics/tokens';
import { roomEditsOf, sceneTriggersOf, worldSkyOf, type LightEdit, type TriggersState } from '@dnd/mechanics/triggers';
import { timeBucket } from '@dnd/core/src/shared/world';
import { litFrame, skyFrame } from '@dnd/core/src/shared/sky';
import { levelGrade, regionGrade } from '@dnd/core/src/shared/regionGrade';
import { tableAllLit } from '@dnd/core/src/engine/worldOverride';
import { darkTest, layersOnLevel, onLevel } from '@dnd/core/src/shared/visionGate';
import { shownLevelId } from '@dnd/core/src/store/selectors';
import { isFrozen } from '@dnd/core/src/shared/freeze';
import { SHOWN_MASK, SIGHT_MASK, addScreenOverlay, mountWhenEngineReady } from '../../renderer/overlayLayer';
import { prefersReducedMotion } from '../../session/motion';
import { useSessionStore } from '../../session/store';
import { tokensOf } from '../tokens/TokenRenderer';
import { useAsPlayers } from './asPlayers';
import { fogFrame, sceneFog } from './fog';
import { placedLights } from './visionSight';
import { DEFAULT_FOG_LOOK, createLivingFog, fogPalette, type FogLook, type FogPool } from './livingFog';
import { effectiveFogLook } from './effectiveFogLook';
import { GUARD_BLUR_CELLS, ownClearing, tierPlan } from './tierPlan';
import { createTierCompositor } from './tierCompositor';

/** The door marks' reveal beat, which `DoorRenderer` still plays. A play beat, not decoration. */
export const REVEAL_MS = 300;

/** How long a reveal takes on this machine. Reduced motion ⇒ a cut, per PRODUCT §A11y. */
export const revealDurationMs = (): number => (prefersReducedMotion() || isFrozen() ? 0 : REVEAL_MS);

/** Ease-out quart. No bounce, no elastic — the room settles, it does not spring. */
export const easeOutQuart = (t: number): number => 1 - (1 - t) ** 4;

/**
 * The floor under `subscribeFogScene`'s frame coalescing: a hidden tab never gets an animation
 * frame, and a seat that is not being looked at is still a seat being sent state.
 */
export const REBUILD_FLOOR_MS = 100;

/**
 * The cloud's density over fogged ground on the DM's see-through view: enough to read as cloud,
 * little enough that the map under it stays legible.
 */
export const DM_DENSE = 0.55;

/** How much of the mist over a fading edge a scene keeps on the brightest sky, 0..1. */
export const MEMORY_WASH_FLOOR = 0.45;
/** The cloud's mist inside the fade band where cleared ground meets the cloud, on the darkest scene. */
export const MEMORY_MIST = 0.5;
/** How hard the grade composites — the same for every seat, and the editor's own value. */
export const GRADE_STRENGTH = 0.95;
/** How wide the edge reads, in cells, before the look's own `fade` takes over. */
export const FOG_FADE = 1.2;

/** How dark the scene reads, 0.45..1, off the sky's darkness: the cloud's palette and mist follow it. */
export const washDarkness = (skyDarkness: number): number => 0.45 + 0.55 * Math.min(1, Math.max(0, skyDarkness));

/** LightingRenderer's label for its full-screen multiply sprite (overlayLayer knows it too). */
const LIGHTING_COMPOSITE = 'lightingComposite';

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface FogScene {
  sceneId: string | null;
  /** The scene's fog is on. Off, nothing is drawn on any seat. */
  on: boolean;
  isPlayer: boolean;
  /** Drawn solid: a player's seat, or the DM's "As players see it". Otherwise see-through. */
  solid: boolean;
  /** The map frame, while fog is on and a document is in hand; null draws nothing. */
  bounds: Bounds | null;
  /** The cleared cells of the level shown, on the frame's grid. */
  cleared?: RegionMask;
  /** This seat's own tokens' footprints on the shown level: always clear (default f). */
  own: Polygon[];
  /** How dark the scene reads (`washDarkness`): the cloud's palette and mist follow it. */
  darkness: number;
  /** The shown level's grade, as the lighting pass lands on it for this sky. */
  grade: string;
  /** The shown level's tint carrying the hour, darkness left out: the cloud palette's hue. */
  cloudTint: string;
  /** …and the coarsened clock it was composed at. */
  timeBucket: number;
  /** The cloud's look: the map's authored `fogLook` under the DM's live override. */
  look: FogLook;
  /** The lights that warm the cloud, on a dark level: only those this seat may know of. */
  pools: FogPool[];
}

/** The square a token covers, centred on it (tiny counts as one cell, as it snaps). */
export function footprintOf(token: Token): Polygon {
  const half = Math.max(1, SIZE_CELLS[token.size] ?? 1) / 2;
  return [
    [token.x - half, token.y - half],
    [token.x + half, token.y - half],
    [token.x + half, token.y + half],
    [token.x - half, token.y + half],
  ];
}

/**
 * Where a pool starts easing, as a share of its radius: every pool eases over the outer half and
 * is gone at the radius, so the glow comes in as the light goes out.
 */
export const POOL_EASE_START = 0.5;

/** The lights that glow the cloud warm: every placed light the table has on, and every carried one. */
export function nightPools(layers: readonly Layer[], tokens: readonly Token[], lightEdits: Record<string, LightEdit>): FogPool[] {
  const switches: Record<string, boolean> = {};
  for (const [id, edit] of Object.entries(lightEdits)) {
    if (edit.visible !== undefined) switches[id] = edit.visible;
  }
  return lightSources(placedLights(layers), tokens, switches)
    .filter((s) => !s.darkness)
    .map((s) => ({ x: s.x, y: s.y, inner: s.radius * POOL_EASE_START, outer: s.radius, warm: true }));
}

/**
 * The pools a solid seat may see glow: lights on cleared ground, and lights its own tokens carry.
 * A lamp under fog stays out, or its glow would tell where it stands.
 */
export function glowPools(pools: readonly FogPool[], cleared: RegionMask | undefined, own: readonly Polygon[]): FogPool[] {
  const onOwn = (x: number, y: number): boolean =>
    own.some((f) => x >= f[0]![0] && x <= f[2]![0] && y >= f[0]![1] && y <= f[2]![1]);
  return pools.filter(
    (p) => onOwn(p.x, p.y) || (cleared !== undefined && getCell(cleared, Math.floor(p.x - cleared.minX), Math.floor(p.y - cleared.minY))),
  );
}

/** Everything the fog draws from, read once per mutation. */
export function fogScene(): FogScene {
  const { session, you, mapData } = useSessionStore.getState();
  const sceneId = session?.activeSceneId ?? null;
  const fog = sceneFog(session?.modules?.fog as FogState | undefined, sceneId);
  const on = fogOn(fog);
  const isPlayer = you?.role !== 'dm';
  const solid = isPlayer || useAsPlayers.getState().on;
  const triggers = session?.modules?.triggers as TriggersState | undefined;
  const scene = sceneId && triggers ? sceneTriggersOf(triggers, sceneId) : undefined;
  const core = useStore.getState();
  const mapSettings = core.mapSettings;
  // One sky for the referee, the picture and this cloud. Day until the join snapshot lands.
  const sky = triggers ? worldSkyOf(triggers, mapSettings, sceneId) : skyFrame({ ...mapSettings, time: 'day' });
  // The shown level: this seat's viewed level, which worldSync installs as `ui.activeLevelId`.
  // A map stored without levels has the one the server names `level-1`.
  const level = shownLevelId(core) || 'level-1';
  const levelLayers = layersOnLevel(core, core.layers, level);
  const levelObj = core.levels?.find((l) => l.id === level);
  const outdoorLook = { place: 'outdoor' as const, tint: mapSettings.ambientLight };
  const grade = tableAllLit() ? regionGrade(outdoorLook, litFrame(sky)) : levelGrade(mapSettings, levelObj, sky);
  const cloudTint = regionGrade(outdoorLook, tableAllLit() ? litFrame(sky) : { ...sky, darkness: 0 });
  const bounds = on && mapData ? fogFrame(mapData) : null;
  const cleared = bounds ? rebaseRegion(clearedOn(fog, level), bounds) : undefined;
  const tokens = tokensOf(session?.modules?.tokens as TokensState | undefined, sceneId).filter((t) => onLevel(core, t, level));
  const own = isPlayer && you ? tokens.filter((t) => t.ownerId === you.identityId).map(footprintOf) : [];
  // The glow only where something on the shown level is dark: daylight has none to show.
  const dark = scene ? darkTest(core, levelLayers, level, sky, roomEditsOf(scene)).any : false;
  const pools = dark && scene ? nightPools(levelLayers, tokens, scene.lightEdits) : [];
  return {
    sceneId,
    on,
    isPlayer,
    solid,
    bounds,
    cleared,
    own,
    darkness: washDarkness(sky.darkness),
    grade,
    cloudTint,
    timeBucket: timeBucket(sky.minutes),
    look: effectiveFogLook(mapSettings, fog),
    pools: solid ? glowPools(pools, cleared, own) : pools,
  };
}

/**
 * Fires when anything the fog is built from changes, and once on subscribe. The session store
 * fires on every ping and the core store on every camera nudge; slice identity tells those apart,
 * because both stores replace slices wholesale.
 *
 * Coalesced to the frame, with a timer floor under it (`REBUILD_FLOOR_MS`) since a hidden tab
 * never gets a frame. The first paint stays synchronous: the mask has to exist before the map
 * under it is drawn, or a player sees one unmasked frame.
 */
export function subscribeFogScene(onChange: () => void): () => void {
  let last: unknown[] = [];
  let queued = false;

  const changed = (): boolean => {
    const { session, you, mapData } = useSessionStore.getState();
    const core = useStore.getState();
    const next = [
      you?.role,
      you?.identityId,
      session?.activeSceneId,
      session?.modules?.fog,
      session?.modules?.tokens,
      session?.modules?.triggers,
      mapData,
      core.layers,
      core.levels,
      core.ui.activeLevelId,
      core.mapSettings,
      useAsPlayers.getState().on,
    ];
    if (next.length === last.length && next.every((v, i) => v === last[i])) return false;
    last = next;
    return true;
  };

  // A rebuild that throws must not end the fog: it is logged, and the change detector forgets
  // what it saw, so the next store write of any kind rebuilds again.
  const rebuild = (): void => {
    try {
      onChange();
    } catch (err) {
      console.error('[fog] rebuild failed', err);
      last = [];
    }
  };
  const flush = (): void => {
    if (!queued) return;
    queued = false;
    rebuild();
  };
  const check = (): void => {
    if (!changed() || queued) return;
    queued = true;
    requestAnimationFrame(flush);
    setTimeout(flush, REBUILD_FLOOR_MS);
  };

  const unsubSession = useSessionStore.subscribe(check);
  const unsubMap = useStore.subscribe(check);
  const unsubAsPlayers = useAsPlayers.subscribe(check);
  if (changed()) rebuild();
  return () => {
    queued = false;
    unsubSession();
    unsubMap();
    unsubAsPlayers();
  };
}

function mountPlayerFog(engine: RenderEngine, sceneGraph: SceneGraph): () => void {
  const layer = new Container();
  // The fail-dark backstop for a seat whose mask could not be composited: flat black, no holes.
  const scrim = new Graphics();
  const fog = createLivingFog(engine, { dense: 1, mist: MEMORY_MIST, rim: 0.75, fade: FOG_FADE / 2, oneTier: true });
  fog.setLook(DEFAULT_FOG_LOOK);
  // The mask, composited straight into the textures the cloud shader is bound to: a fresh
  // RenderTexture is a source the shader's bind never follows.
  const tiers = createTierCompositor(engine, fog.maskTextures);
  // The scrim with the mask's holes erased on the GPU, drawn under the cloud on a solid seat.
  const scrimSprite = new Sprite(tiers.scrim);
  scrimSprite.visible = false;
  // The two stencils, both the mask. Pixi takes a Sprite as an alpha mask; kept out of the build
  // from the first frame, since a white fill drawn as content would be one frame of the whole map.
  const sightSprite = new Sprite(tiers.mask);
  sightSprite.includeInBuild = false;
  const shownSprite = new Sprite(tiers.mask);
  shownSprite.includeInBuild = false;
  // …and their fail-dark twins for a seat with no composited mask: empty, so they hide everything.
  const sightMask = new Graphics();
  sightMask.includeInBuild = false;
  const shownMask = new Graphics();
  shownMask.includeInBuild = false;
  layer.addChild(scrim, scrimSprite, fog.mesh, sightMask, sightSprite, shownMask, shownSprite);
  layer.eventMode = 'none';
  addScreenOverlay(sceneGraph, layer, 'playerFog');

  /** Null on a table with no lighting engine — then there is no multiply to hold back. */
  const composite = (): Container | null =>
    (sceneGraph.overlayContainer.children.find((c) => c.label === LIGHTING_COMPOSITE) as Container | undefined) ?? null;

  const world = sceneGraph.worldContainer;
  /** The cover the composited mask stood for at the last rebuild (`shownAt`). */
  let liveCover: Bounds | null = null;
  let lastLookKey = '';
  let cleared = 0;
  let solid = false;
  let dense = 1;

  // Read-only instruments for the e2e lanes (unguarded: nothing here a script on the page could
  // not already read), plus `maskAt`, dev only, which stalls the pipeline to read a texel back.
  const fogProbe = {
    rebuilds: 0,
    /** How long the last mask took to build. */
    lastRebuildMs: 0,
    /** How many cells the shown level's cleared record holds. */
    clearedCells: (): number => cleared,
    /** Drawn solid (a player, or "As players see it") rather than see-through. */
    solid: (): boolean => solid,
    /** The cloud's density over fogged ground. */
    dense: (): number => dense,
    /** Whether a world point is shown on this seat: the mask's texel there. Null without a mask. */
    shownAt: (x: number, y: number): boolean | null => {
      const read = engine.renderer?.()?.extract;
      const c = liveCover;
      if (!c || !read) return null;
      const rt = tiers.mask;
      const tx = Math.floor(((x - c.minX) / (c.maxX - c.minX)) * rt.width);
      const ty = Math.floor(((y - c.minY) / (c.maxY - c.minY)) * rt.height);
      if (tx < 0 || ty < 0 || tx >= rt.width || ty >= rt.height) return false;
      const { pixels } = read.pixels(rt);
      return pixels[(ty * rt.width + tx) * 4 + 3]! > 128;
    },
    /** Where a world point is on this canvas right now, for a test driving the real pointer. */
    screenOf: (x: number, y: number): { x: number; y: number } => engine.worldToScreen(x, y),
    /** Dev only: the mask's own texel at a world point, RGBA as the cloud shader samples it. */
    maskAt: (x: number, y: number): number[] | null => {
      if (!import.meta.env.DEV) return null;
      const fit = fog.maskFit();
      const rt = fog.maskTextures.mask;
      const read = engine.renderer?.()?.extract;
      if (!fit || !read) return null;
      const { minX, minY, maxX, maxY } = fit.bounds;
      const tx = Math.floor(((x - minX) / (maxX - minX)) * rt.width);
      const ty = Math.floor(((y - minY) / (maxY - minY)) * rt.height);
      if (tx < 0 || ty < 0 || tx >= rt.width || ty >= rt.height) return null;
      const { pixels } = read.pixels(rt);
      const i = (ty * rt.width + tx) * 4;
      return [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!, pixels[i + 3]!];
    },
    /** Whether the fog is drawn on this canvas at all right now, and a way to force it off. */
    visible: (): boolean => layer.visible,
    setVisible: (v: boolean): void => {
      layer.visible = v;
    },
  };
  (window as Window & { __fogProbe?: typeof fogProbe }).__fogProbe = fogProbe;

  const rebuild = (): void => {
    const startedAt = performance.now();
    const scene = fogScene();
    const showing = scene.bounds !== null;
    solid = scene.solid;
    layer.visible = showing;
    const lit = composite();
    if (lit) lit.alpha = GRADE_STRENGTH;

    const plan = tierPlan({ frame: scene.bounds, cleared: scene.cleared, own: scene.own });
    cleared = plan.cells;
    fog.setMaskBounds(plan.cover);
    // The frame the glow stays inside and the cover is cut at; set before `setLook`, whose soft
    // re-render reads the cover past the frame as shown.
    fog.setFrame(scene.bounds);
    const fit = fog.maskFit();
    const raster = showing && fit !== null;
    // Run even when nothing can be composited, so no target keeps the previous rebuild's holes.
    tiers.run(raster ? plan : { cover: null, ops: [], cells: plan.cells }, { scale: fit?.scale ?? 1, fade: GUARD_BLUR_CELLS });
    scrim.clear();
    if (showing && !raster && scene.solid && plan.cover) {
      const { minX, minY, maxX, maxY } = plan.cover;
      scrim.rect(minX, minY, maxX - minX, maxY - minY).fill({ color: 0x000000, alpha: 1 });
    }
    const cover = raster ? plan.cover : null;
    liveCover = cover;
    scrimSprite.visible = raster && scene.solid;
    fog.mesh.visible = showing;
    if (cover) {
      for (const sprite of [scrimSprite, sightSprite, shownSprite]) {
        sprite.position.set(cover.minX, cover.minY);
        sprite.width = cover.maxX - cover.minX;
        sprite.height = cover.maxY - cover.minY;
      }
    }
    // The stencils, on a solid seat only, and one carrier of each label wherever fog is drawn:
    // a wearer that finds no stencil draws unmasked, and a chip in the fog is the one failure
    // direction fog may not have. The empty Graphics is the fallback, and hides everything.
    const stencil = showing && scene.solid;
    sightSprite.label = stencil && raster ? SIGHT_MASK : '';
    shownSprite.label = stencil && raster ? SHOWN_MASK : '';
    sightMask.label = stencil && !raster ? SIGHT_MASK : '';
    shownMask.label = stencil && !raster ? SHOWN_MASK : '';

    dense = scene.solid ? 1 : DM_DENSE;
    fog.setDense(dense);
    fog.setEdgeLine(!scene.solid);
    fog.setPalette(fogPalette(scene.cloudTint, scene.darkness));
    // `setLook` re-renders the soft mask, real GPU work, so only when the weather moved.
    const lookKey = JSON.stringify(scene.look);
    if (lookKey !== lastLookKey) {
      lastLookKey = lookKey;
      fog.setLook(scene.look);
    }
    fog.setMist(MEMORY_MIST * (MEMORY_WASH_FLOOR + (1 - MEMORY_WASH_FLOOR) * scene.darkness));
    fog.setPools(scene.pools);
    fog.setOwn(scene.own.map(ownClearing));
    fogProbe.rebuilds += 1;
    fogProbe.lastRebuildMs = performance.now() - startedAt;
  };

  // Per frame: mirror the camera (the layer lives in screen space, above the lighting composite)
  // and advance the cloud's clock. No geometry is touched.
  const tick = (): void => {
    layer.position.copyFrom(world.position);
    layer.scale.copyFrom(world.scale);
    if (!layer.visible) return;
    // The cover quad tracks the viewport, so the fog lies over map and void alike.
    const vp = engine.viewport();
    const tl = engine.screenToWorld(0, 0);
    const br = engine.screenToWorld(vp.width, vp.height);
    fog.cover({ minX: tl.x - 2, minY: tl.y - 2, maxX: br.x + 2, maxY: br.y + 2 }, (br.x - tl.x) / Math.max(1, vp.width));
    if (!prefersReducedMotion()) fog.advance(ticker.deltaMS / 1000);
  };

  const ticker = engine.ticker();
  ticker.add(tick);
  const unsubscribe = subscribeFogScene(rebuild);

  return () => {
    ticker.remove(tick);
    unsubscribe();
    delete (window as Window & { __fogProbe?: typeof fogProbe }).__fogProbe;
    // The engine may already be gone (GameRenderer unmounting first).
    try {
      const lit = composite();
      if (lit) lit.alpha = GRADE_STRENGTH;
      // Before the fog, which owns the two textures the compositor borrows.
      tiers.destroy();
      fog.destroy();
      if (!layer.destroyed) layer.destroy({ children: true });
    } catch {
      /* engine torn down first */
    }
  };
}

/** Call from an effect; the returned function is the effect's cleanup. */
export const mountPlayerFogWhenReady = (pollMs?: number): (() => void) => mountWhenEngineReady(mountPlayerFog, pollMs);
