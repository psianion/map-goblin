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
import type { Polygon } from '../types/geometry';
import { clipper2Engine } from '../geometry/Clipper2Engine';
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
  signature: string;
  /** Identity of the ground the shadows were last clipped against — floor union, terrain bounds. */
  groundRef: unknown;
  terrainRef: unknown;
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

  const state: LayerShadows = {
    graphics,
    signature: '',
    groundRef: undefined,
    terrainRef: undefined,
    props: new Map(),
  };
  byLayer.set(layerId, state);
  return state;
}

/**
 * Where there is ground to cast onto: this layer's floor union, plus whatever terrain the map
 * has painted (as its own rectangle — the splatmap has no vector shape, and this is the
 * rectangle the export bounds already agree on).
 *
 * Empty is a real answer, not a gap: a wall standing in the void has no ground under its
 * shadow, and clipping it away entirely is correct.
 */
function groundOf(layer: DungeonLayer): Polygon[] {
  const ground: Polygon[] = [];
  for (const ring of layer.mergedFloor ?? []) if (ring.length >= 3) ground.push(ring);
  const b = useStore.getState().mapSettings.terrain?.bounds;
  if (b) ground.push([[b.minX, b.minY], [b.maxX, b.minY], [b.maxX, b.maxY], [b.minX, b.maxY]]);
  return ground;
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
    byLayer.delete(id);
    propInputs.delete(id);
  }

  for (const layer of layers) {
    // Nothing casting and nothing drawn before is the state every indoor map lives in: no
    // container, no geometry, no cost — the pass simply is not there.
    const state = casting || byLayer.has(layer.id) ? shadowsOf(layer.id) : null;
    if (!state) continue;

    // The ground is part of what is drawn, so it is part of what the memo is keyed on — and it
    // arrives on its own schedule. A freshly loaded map has `mergedFloor: null` until
    // `subscribeToStore` computes the union, which it only does for a layer whose scene-graph
    // entry already exists — so the ground lands a notification *later* than the first frame
    // that wants it, moving no shape key, no wall epoch and no clock with it.
    const terrain = useStore.getState().mapSettings.terrain?.bounds ?? null;
    const signature = shadowSignature(layer.id, wallEpoch, step, orientation, casting);
    if (
      signature === state.signature &&
      layer.mergedFloor === state.groundRef &&
      terrain === state.terrainRef
    ) {
      continue;
    }
    state.signature = signature;
    state.groundRef = layer.mergedFloor;
    state.terrainRef = terrain;
    if (look === undefined) look = shadowLook(frame.sun);
    drawWallShadows(state.graphics, layer, look);
    drawPropShadows(layer.id, look);
  }
}

/**
 * One layer's wall shadows, as {@link SHADOW_STEPS} nested passes over the whole wall set,
 * each one cut to the ground it falls on.
 *
 * Clipped as *geometry*, with the Clipper2 pass this codebase already unions floors with —
 * not with a PixiJS mask. Two gate walks died on the mask: a stencil is collected into the
 * render group's instruction set when that group is built, so redrawing the mask's own
 * `Graphics` in place (which is what "the floor union just arrived" looks like) never reaches
 * the GPU, and the stencil keeps whatever it was baked with — for this map, empty. Measured
 * live: 306,538 pixels of shadow with the mask off, 440 with it on. Clipping the quads means
 * what is in the geometry is what is on the screen, with nothing between them.
 *
 * Steps outside, segments inside, one fill per step: within a fill the quads merge (non-zero
 * winding), so two walls meeting at a corner cast one shadow rather than a darker wedge where
 * they overlap — and across the steps the fills stack into the soft ramp. Four fills for a
 * whole keep.
 *
 * ponytail: four Clipper2 intersections per rebuild (a rebuild being a wall edit, a five-minute
 * clock bucket or an orientation nudge — never a frame). If a scrub over a big map ever feels
 * it, cut `SHADOW_STEPS` before anything cleverer.
 */
function drawWallShadows(g: Graphics, layer: DungeonLayer, look: ShadowLook | null): void {
  g.clear();
  if (look === null || look.length <= 0 || look.alpha <= 0) return;
  // Per layer, off the same extractor the lights sweep — a layer's walls cast a layer's
  // shadows, and an open door drops its segment here exactly as it drops it there.
  const segments = extractWallSegments([layer]);
  const ground = groundOf(layer);
  if (segments.length === 0 || ground.length === 0) return;
  const color = parseInt(look.color.replace('#', ''), 16);
  const alpha = bandAlpha(look);
  for (let step = SHADOW_STEPS; step >= 1; step--) {
    const quads: Polygon[] = [];
    for (const s of segments) {
      const band = shadowBand(s.x1, s.y1, s.x2, s.y2, look, step);
      const ring: Polygon = [];
      for (let i = 0; i < band.length; i += 2) ring.push([band[i]!, band[i + 1]!]);
      quads.push(ring);
    }
    for (const poly of clipper2Engine.intersection(quads, ground)) g.poly(poly.flat());
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
