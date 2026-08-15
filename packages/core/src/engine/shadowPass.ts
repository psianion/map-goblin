// P3a — the directional shadow pass: what the sun and the moon actually draw.
//
// The maths is next door in `shared/shadows.ts` (pure, tested); this file is the PixiJS half
// and the two hooks that feed it.
//
// Where it draws: a per-layer `shadows` sublayer between the floor and the grid (sceneGraph),
// so a shadow lies on its own layer's ground, under that layer's walls, doors, props and
// tokens — and under the grid, which is drawn over the floor and must never be shaded.
//
// What it costs when nothing is happening: a string compare per dungeon layer. The geometry is
// rebuilt only when the wall set changes (`LightManager`'s epoch), the clock crosses a bucket
// (`timeBucket`) or the map's orientation moves — so a paused clock on an unedited map draws
// once and then costs nothing, which is the whole gate.

import { Graphics, Sprite } from 'pixi.js';
import type { DungeonLayer, AssetChild } from '../store/types';
import { getLayerEntry } from './sceneGraph';
import { extractWallSegments } from './lighting/raycaster';
import { useStore } from '../store/store';
import {
  SHADOW_STEPS,
  bandAlpha,
  propShadow,
  shadowBand,
  shadowLook,
  shadowSignature,
  type ShadowLook,
} from '../shared/shadows';
import { timeBucket } from '../shared/world';
import { worldFrame, type WorldFrame } from './worldOverride';

/** The look under whichever sun this surface is standing — the Table's, or the Editor's own. */
function shadowLookNow(): ShadowLook | null {
  const state = useStore.getState();
  return shadowLook(worldFrame(state.mapSettings, state.ui.previewClock).sun);
}

// ─── Per-layer state ──────────────────────────────────────

interface LayerShadows {
  graphics: Graphics;
  /** The clip: this layer's floor union, plus whatever terrain the map has painted. */
  mask: Graphics;
  /** Identity of the union the clip was cut from — the invalidation, straight off the store. */
  maskFloorRef: unknown;
  /** …and of the terrain's bounds, the other half. */
  maskTerrainRef: unknown;
  signature: string;
  /** Prop silhouettes, by asset child id. Synced by `syncPropShadows`, aimed by the sun here. */
  props: Map<string, { sprite: Sprite; obj: AssetChild }>;
}

const byLayer = new Map<string, LayerShadows>();

function shadowsOf(layerId: string): LayerShadows | null {
  const existing = byLayer.get(layerId);
  if (existing && !existing.graphics.destroyed) return existing;
  const entry = getLayerEntry(layerId);
  if (!entry?.sublayers) return null;

  const graphics = new Graphics();
  graphics.label = 'wallShadows';
  // Shadows darken the ground they fall on rather than painting over it — the one confident
  // direction the style guide asks for, in the floor's own colours.
  graphics.blendMode = 'multiply';
  entry.sublayers.shadows.addChild(graphics);

  // A `Graphics` rather than a container of things: PixiJS masks a Graphics through the
  // *stencil* buffer, which is binary coverage and leaves the blending underneath alone — and
  // this pass is a multiply, so it has to blend against the real frame. (A mask that is a
  // Sprite goes down the alpha path instead, which is a filter, and a filter would isolate the
  // subtree and swallow the multiply — as well as breaking the pass's no-filters rule.)
  const mask = new Graphics();
  mask.label = 'shadowClip';
  // A mask has to be in the scene to be transformed with it; Pixi draws it into the stencil
  // rather than onto the map. Hung on the sublayer only while something is casting (see
  // `updateShadows`) — every indoor map would otherwise pay for a stencil pass over nothing.
  entry.container.addChild(mask);

  const state: LayerShadows = {
    graphics,
    mask,
    maskFloorRef: undefined,
    maskTerrainRef: undefined,
    signature: '',
    props: new Map(),
  };
  byLayer.set(layerId, state);
  return state;
}

/**
 * Cut the clip to "wherever there is ground": this layer's floor union, plus whatever terrain
 * the map has painted.
 *
 * **Called every frame while casting, not on a draw-memo miss.** That is the whole of the bug
 * two gate walks chased: a freshly loaded map arrives with `mergedFloor: null` — the union is
 * computed at runtime by `subscribeToStore`, and only for a layer whose scene-graph entry
 * already exists, so it lands a notification *after* the entry the first shadow frame needs.
 * Cutting the clip only when the shadow *geometry* changed meant the one cut this map ever got
 * was taken against a null union, and `mergedFloor` is in nothing the draw memo keys on (the
 * union's arrival moves no shape key, so no wall epoch, no sun step, no orientation). The
 * stencil stayed empty for the life of the map and every shadow on it was clipped to nothing.
 *
 * It is free to leave unguarded: two identity compares, and the draws happen only when one of
 * them actually moved.
 *
 * Terrain arrives as its axis-aligned bounds rather than its splat alpha — a stencil is binary
 * coverage, so per-texel alpha was never reachable through this path. A painted region's own
 * rectangle is the honest approximation, and it is the rectangle the export bounds already
 * agree on.
 *
 * Neither half present is not a bug to paper over: a wall standing in the void has no ground to
 * cast onto, and an empty clip is exactly the right answer.
 */
function syncMask(state: LayerShadows, layer: DungeonLayer): void {
  const rings = layer.mergedFloor;
  const bounds = useStore.getState().mapSettings.terrain?.bounds ?? null;
  if (state.maskFloorRef === rings && state.maskTerrainRef === bounds) return;
  state.maskFloorRef = rings;
  state.maskTerrainRef = bounds;

  const g = state.mask;
  g.clear();
  let drew = false;
  // One fill for every ring: Clipper2 winds holes the other way, so a courtyard cut out of a
  // floor stays cut out of the shadow's clip too.
  if (rings) {
    for (const ring of rings) {
      if (ring.length < 3) continue;
      g.poly(ring.flat());
      drew = true;
    }
  }
  if (bounds) {
    g.rect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
    drew = true;
  }
  if (drew) g.fill(0xffffff);
}

// ─── The pass ─────────────────────────────────────────────

/**
 * Draw (or leave alone) every visible dungeon layer's shadows. Called once a frame from the
 * render loop, right after `LightManager.rebuildIfDirty` — so the wall set it extrudes is the
 * same one the lights were just swept against.
 *
 * `frame` is handed in rather than read here so the whole tick stands at one clock: the grade,
 * the lighting pass's time bucket and these shadows are the same hour by construction.
 */
export function updateShadows(
  layers: DungeonLayer[],
  wallEpoch: number,
  frame: WorldFrame,
): void {
  const step = timeBucket(frame.minutes);
  const orientation = useStore.getState().mapSettings.orientation ?? 0;
  // Whether anything is casting is free to ask; what it looks like costs an OKLCH mix, so it
  // is asked for once, on the first layer that turns out to need redrawing, and never on an
  // idle frame.
  const casting = frame.sun.kind !== null && frame.sun.intensity > 0;
  let look: ShadowLook | null | undefined;

  const live = new Set(layers.map((l) => l.id));
  for (const [id, state] of byLayer) {
    if (live.has(id)) continue;
    if (!state.graphics.destroyed) state.graphics.destroy();
    if (!state.mask.destroyed) state.mask.destroy();
    byLayer.delete(id);
    propInputs.delete(id);
  }

  for (const layer of layers) {
    // Nothing casting and nothing drawn before is the state every indoor map lives in: no
    // container, no mask, no cost — the pass simply is not there.
    const state = casting || byLayer.has(layer.id) ? shadowsOf(layer.id) : null;
    if (!state) continue;

    // The clip first, and outside the memo below: the ground a map stands on arrives on its own
    // schedule (see `syncMask`), and it moves nothing the drawing is keyed on.
    if (casting) syncMask(state, layer);

    const signature = shadowSignature(layer.id, wallEpoch, step, orientation, casting);
    if (signature === state.signature) continue;
    state.signature = signature;
    if (look === undefined) look = shadowLook(frame.sun);
    const sublayer = getLayerEntry(layer.id)?.sublayers?.shadows;
    if (sublayer) sublayer.mask = casting ? state.mask : null;
    drawWallShadows(state.graphics, layer, look);
    drawPropShadows(layer.id, look);
  }
}

/**
 * One layer's wall shadows, as {@link SHADOW_STEPS} nested passes over the whole wall set.
 *
 * Steps outside, segments inside, one fill per step: within a fill the quads merge (non-zero
 * winding), so two walls meeting at a corner cast one shadow rather than a darker wedge where
 * they overlap — and across the steps the fills stack into the soft ramp. Four draw calls for
 * a whole keep.
 */
function drawWallShadows(g: Graphics, layer: DungeonLayer, look: ShadowLook | null): void {
  g.clear();
  if (look === null || look.length <= 0 || look.alpha <= 0) return;
  // Per layer, off the same extractor the lights sweep — a layer's walls cast a layer's
  // shadows, and an open door drops its segment here exactly as it drops it there.
  const segments = extractWallSegments([layer]);
  if (segments.length === 0) return;
  const color = parseInt(look.color.replace('#', ''), 16);
  const alpha = bandAlpha(look);
  for (let step = SHADOW_STEPS; step >= 1; step--) {
    for (const s of segments) {
      g.poly(shadowBand(s.x1, s.y1, s.x2, s.y2, look, step));
    }
    g.fill({ color, alpha });
  }
}

// ─── Props ────────────────────────────────────────────────

/** What each layer's props are, last time the asset sync said. Plain refs, no Pixi of our own. */
const propInputs = new Map<string, readonly { sprite: Sprite; obj: AssetChild }[]>();

/**
 * Record one layer's props. Called from `subscribeToAssets`, which is the one place that knows
 * an asset child's texture and transform — and is the same loop on the Table as in the Editor,
 * so props cast on both without a second code path.
 */
export function syncPropShadows(
  layerId: string,
  props: readonly { sprite: Sprite; obj: AssetChild }[],
): void {
  propInputs.set(layerId, props);
  if (byLayer.has(layerId)) drawPropShadows(layerId, shadowLookNow());
}

/**
 * Mint / update / retire one layer's silhouettes against whatever the props currently are.
 *
 * Driven from two directions and idempotent under both: the asset sync when a prop is added,
 * moved or swapped, and {@link updateShadows} when the sun moves — including the moment it
 * first comes up over a map whose props were synced while the sky was empty.
 */
function drawPropShadows(layerId: string, look: ShadowLook | null): void {
  const state = byLayer.get(layerId);
  const parent = getLayerEntry(layerId)?.sublayers?.shadows;
  if (!state || !parent) return;
  const props = propInputs.get(layerId) ?? [];

  const wanted = new Set(props.map((p) => p.obj.id));
  for (const [id, held] of state.props) {
    if (wanted.has(id)) continue;
    if (!held.sprite.destroyed) held.sprite.destroy();
    state.props.delete(id);
  }

  for (const { sprite, obj } of props) {
    // The prop's own sprite is rebuilt out from under us on a layer rebuild; the next asset
    // sync brings a fresh list, and until it does there is nothing to copy a texture from.
    if (sprite.destroyed) continue;
    let held = state.props.get(obj.id);
    if (!held) {
      const shadow = new Sprite(sprite.texture);
      // Anchored at its foot: the shadow pivots where the prop stands, not through its middle.
      shadow.anchor.set(0.5, 1);
      shadow.label = 'prop-shadow-' + obj.id;
      shadow.blendMode = 'multiply';
      parent.addChild(shadow);
      held = { sprite: shadow, obj };
      state.props.set(obj.id, held);
    }
    held.obj = obj;
    held.sprite.texture = sprite.texture;
    aimPropShadow(held.sprite, obj, look);
  }
}

/** Lay one prop's silhouette down along the light — see `propShadow` for the transform. */
function aimPropShadow(shadow: Sprite, obj: AssetChild, look: ShadowLook | null): void {
  if (look === null || !obj.visible) {
    shadow.visible = false;
    return;
  }
  const height = shadow.texture.height;
  const cast = propShadow(look, height);
  shadow.visible = true;
  // The foot of the prop, not its centre — asset sprites are anchored through the middle.
  shadow.position.set(obj.position.x, obj.position.y + (obj.height * obj.scale) / 2);
  shadow.scale.set((obj.width * obj.scale) / (shadow.texture.width || 1), cast.scaleY);
  shadow.skew.x = cast.skewX;
  shadow.alpha = cast.alpha;
  shadow.tint = parseInt(cast.color.replace('#', ''), 16);
}
