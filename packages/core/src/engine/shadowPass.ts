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

import { BlurFilter, Container, Graphics, Sprite } from 'pixi.js';
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
import { timeBucket, type MapEnvironment, type SunVector } from '../shared/world';
import { cliffSunAt, type SkyFrame } from '../shared/sky';
import { edgeRuns, groundReliefs, hasGroundHeight, hasPlateaus, layerPlateaus, unionShapes } from '../shared/plateaus';
import { frameRing, isGroundPiece } from '../shared/pieces';
import { baseGroundFrame } from './mapFrame';
import {
  BLUR_WEIGHTS_5,
  SUN_SHADOW_ALPHA,
  blurStrengthFor,
  leeSweeps,
  sunShadowLength,
} from '../shared/plateauShade';
import { shadeCliffs } from './plateauRenderer';
import { worldFrame, type WorldFrame } from './worldOverride';

/** The look under whichever sun this surface is standing — the Table's, or the Editor's own. */
function shadowLookNow(): ShadowLook | null {
  const state = useStore.getState();
  const frame = worldFrame(state.mapSettings, state.ui.previewClock, state.ui.previewSky, state.ui.previewWeather);
  return shadowLook(frame.sun, frame.penumbraScale);
}

// ─── Per-layer state ──────────────────────────────────────

interface LayerShadows {
  graphics: Graphics;
  /** The cliffs' lee shadows: one part per band and side, each softened by `blur` (see drawCliffShadows). */
  cliff: Container;
  blur: BlurFilter;
  signature: string;
  /** Identity of the ground the shadows were last clipped against — floor union, terrain bounds. */
  groundRef: unknown;
  terrainRef: unknown;
  /** The children and patches a floor's or patch's height shadow was drawn from; null while none has a height. */
  reliefRef: readonly unknown[] | null;
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

  // The cliffs' shadows lie in a holder of their own, one blurred part per band and side: a
  // soft lee shadow whose far edge fades out across CLIFF_SHADOW_FADE, never a hard band.
  const cliff = new Container();
  cliff.label = 'cliffShadowHolder';
  const blur = new BlurFilter({ strength: 1, quality: CLIFF_BLUR_PASSES, kernelSize: CLIFF_BLUR_KERNEL });
  blur.resolution = 1;
  entry.sublayers.shadows.addChild(cliff);

  const state: LayerShadows = {
    graphics,
    cliff,
    blur,
    signature: '',
    groundRef: undefined,
    terrainRef: undefined,
    reliefRef: null,
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
  // Ground pieces are ground to cast onto, and so is the base ground, over the map's frame.
  for (const c of layer.children) {
    if (isGroundPiece(c) && !c.keptToFloors && c.visible !== false) ground.push(...unionShapes([c]).filter((r) => r.length >= 3));
  }
  const base = baseGroundFrame(layer);
  if (base) ground.push(frameRing(base));
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
  const map = useStore.getState().mapSettings;
  const orientation = map.orientation ?? 0;
  // Whether anything is casting is free to ask; what it looks like costs an OKLCH mix, so it
  // is asked for once, on the first layer that turns out to need redrawing, and never on an
  // idle frame.
  const casting = frame.sun.kind !== null && frame.sun.intensity > 0;
  // Cliffs cast under every sky (cliffCaster): outdoors the same sun as the walls' when those
  // cast, else that sun forced on for cliffs alone; with no sun at all, a fixed one.
  const { sun: cliffSun, strength: cliffStrength } = cliffCaster(frame, map);
  const cliffsCast = cliffSun.kind !== null && cliffSun.intensity > 0;
  let look: ShadowLook | null | undefined;
  let cliffLook: ShadowLook | null | undefined;

  const live = new Set(layers.map((l) => l.id));
  for (const [id, state] of byLayer) {
    if (live.has(id)) continue;
    if (!state.graphics.destroyed) state.graphics.destroy();
    if (!state.cliff.destroyed) state.cliff.destroy({ children: true });
    byLayer.delete(id);
    propInputs.delete(id);
  }

  for (const layer of layers) {
    // Nothing casting and nothing drawn before is the state every flat indoor map lives in: no
    // container, no geometry, no cost — the pass simply is not there.
    const castsHere = casting || (cliffsCast && castsRelief(layer));
    const state = castsHere || byLayer.has(layer.id) ? shadowsOf(layer.id) : null;
    if (!state) continue;
    // The blur is in screen pixels: kept at CLIFF_SHADOW_FADE cells at whatever the zoom is.
    const m = state.cliff.worldTransform;
    state.blur.strength = cliffBlurStrength(Math.hypot(m.a, m.b) || 1);

    // The ground is part of what is drawn, so it is part of what the memo is keyed on — and it
    // arrives on its own schedule. A freshly loaded map has `mergedFloor: null` until
    // `subscribeToStore` computes the union, which it only does for a layer whose scene-graph
    // entry already exists — so the ground lands a notification *later* than the first frame
    // that wants it, moving no shape key, no wall epoch and no clock with it.
    const terrain = useStore.getState().mapSettings.terrain?.bounds ?? null;
    const signature = shadowSignature(layer.id, wallEpoch, step, orientation, castsHere, { ...frame, sun: cliffSun });
    // A piece's height moves no wall and no union: while any has one, its shadow is redrawn
    // when the layer's children change. Ground pieces are ground to cast onto: with any, the
    // children are part of the key too, and so is the frame the base ground lies on.
    const raised = hasGroundHeight(layer);
    const grounded = layer.children.some((c) => isGroundPiece(c));
    const relief = raised || grounded ? [layer.children, useStore.getState().mapSettings.fixedSize ?? null] : null;
    if (
      signature === state.signature &&
      layer.mergedFloor === state.groundRef &&
      terrain === state.terrainRef &&
      sameRelief(relief, state.reliefRef)
    ) {
      continue;
    }
    state.signature = signature;
    state.groundRef = layer.mergedFloor;
    state.terrainRef = terrain;
    state.reliefRef = relief;
    if (look === undefined) look = shadowLook(frame.sun, frame.penumbraScale);
    if (cliffLook === undefined) cliffLook = shadowLook(cliffSun, frame.penumbraScale);
    drawWallShadows(state.graphics, layer, look);
    drawCliffShadows(state.cliff, state.blur, layer, cliffLook, cliffStrength);
    shadeCliffs(layer.id, cliffLook);
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
  const segments = extractWallSegments([layer], 'light', { props: false, cliffs: false });
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

/**
 * The cliffs' shadows (plan §4.3): every raised edge but a slope casts, `sunShadowLength` of
 * its drop long. A plateau's falls outward onto whatever ground is lower than it; a pit's falls
 * inward from its rim onto the pit's own floor. Each band and side is its own part: the fill
 * (reaching back behind the edge) blurred, then cut by a mask of where it lands, so the shadow
 * starts on the edge itself at full strength and only its far end and sides fade, over
 * CLIFF_SHADOW_FADE. The masks are new Graphics every redraw, never one redrawn in place.
 */
function drawCliffShadows(holder: Container, blur: BlurFilter, layer: DungeonLayer, look: ShadowLook | null, strength: number): void {
  for (const part of holder.removeChildren()) part.destroy({ children: true });
  if (look === null || look.length <= 0 || look.alpha <= 0 || !castsRelief(layer)) return;
  const ground = groundOf(layer);
  for (const { fill, clip } of [...cliffShadowParts(layer, look, ground), ...reliefShadowParts(layer, look, ground)]) {
    if (fill.length === 0 || clip.length === 0) continue;
    const g = new Graphics();
    g.label = 'cliffShadows';
    fillRings(g, fill, { color: 0x000000, alpha: CLIFF_SHADOW_ALPHA * strength });
    const soft = new Container();
    soft.filters = [blur];
    soft.addChild(g);
    const mask = new Graphics();
    mask.label = 'cliffShadowMask';
    fillRings(mask, clip, { color: 0xffffff });
    const part = new Container();
    part.label = 'cliffShadowPart';
    part.addChild(soft, mask);
    part.mask = mask;
    holder.addChild(part);
  }
}

function sameRelief(a: readonly unknown[] | null, b: readonly unknown[] | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Whether anything on the layer throws a relief shadow: a plateau, or a floor or patch with a height. */
function castsRelief(layer: DungeonLayer): boolean {
  return hasPlateaus(layer) || hasGroundHeight(layer);
}

/** Fill rings with their holes cut: Clipper's outers wind positive, its holes negative. */
function fillRings(g: Graphics, rings: Polygon[], style: { color: number; alpha?: number }): void {
  const area = (r: Polygon): number => {
    let a = 0;
    for (let i = 0; i < r.length; i++) a += r[i][0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * r[i][1];
    return a / 2;
  };
  const inside = ([x, y]: [number, number], poly: Polygon): boolean => {
    let hit = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  };
  for (const r of rings) {
    if (r.length < 3 || area(r) <= 0) continue;
    g.poly(r.flat()).fill(style);
    const holes = rings.filter((h) => h.length >= 3 && area(h) < 0 && inside(h[0], r));
    if (holes.length === 0) continue;
    for (const h of holes) g.poly(h.flat());
    g.cut();
  }
}

/** How dark a cliff's lee shadow is: black at this opacity. */
export const CLIFF_SHADOW_ALPHA = SUN_SHADOW_ALPHA;

/**
 * The sun cliffs cast by when the sky gives them none (an indoor map, natural light off, a
 * moonless night): fixed at the top left of the screen, 35° up. Azimuth 225 here (0 is
 * screen-right, y down) is the north-west, 315° on a compass.
 */
export const FIXED_CLIFF_SUN: SunVector = { azimuth: 225, altitude: 35, intensity: 1, kind: 'sun' };
/** How dark a cliff's shadow under that fixed sun is, against an outdoor one. */
export const FIXED_CLIFF_STRENGTH = 0.7;

/**
 * The sun a cliff casts by under `frame`, and its shadow's strength against the outdoor one: the
 * map's sun or moon while it lights the map, else the fixed one, so every plateau always throws
 * its one shadow.
 */
export function cliffCaster(frame: SkyFrame, map: MapEnvironment): { sun: SunVector; strength: number } {
  const sun = cliffSunAt(frame, map);
  return sun.kind === null || sun.intensity <= 0 ? { sun: FIXED_CLIFF_SUN, strength: FIXED_CLIFF_STRENGTH } : { sun, strength: 1 };
}
/** How far a cliff shadow's edge takes to fade, cells: from 90 % of its darkness to 10 %. */
export const CLIFF_SHADOW_FADE = 0.4;
/** The blur's passes and kernel taps (Pixi's BlurFilter `quality` and `kernelSize`). */
export const CLIFF_BLUR_PASSES = 3;
export const CLIFF_BLUR_KERNEL = 5;
export { BLUR_WEIGHTS_5 };

/** The BlurFilter strength that fades a cliff shadow's edge over CLIFF_SHADOW_FADE cells at `pxPerCell` px a cell. */
export function cliffBlurStrength(pxPerCell: number): number {
  return blurStrengthFor(CLIFF_SHADOW_FADE, pxPerCell);
}

/**
 * The cliffs' shadows, per band and side: `fill`, each turned-away stretch of edge swept
 * `sunShadowLength` of its drop along the light and reaching SUN_SHADOW_BACK behind the
 * edge, and `clip`, where it may land: for a plateau the `ground` and the lower bands
 * outside it, for a pit its own floor, never a band as high as the caster or higher. Pure
 * geometry, for the pass and its tests.
 */
export function cliffShadowParts(layer: DungeonLayer, look: ShadowLook, ground: Polygon[]): { fill: Polygon[]; clip: Polygon[] }[] {
  const out: { fill: Polygon[]; clip: Polygon[] }[] = [];
  const { bands } = layerPlateaus(layer);
  const everywhere = [...ground, ...bands.flatMap((b) => b.rings)];
  for (const band of bands) {
    const runs = edgeRuns(band).filter((r) => r.edge !== 'slope' && r.drop !== 0);
    for (const pit of [false, true]) {
      const casting = runs.filter((r) => (r.drop < 0) === pit);
      if (casting.length === 0) continue;
      const sweeps = casting.flatMap((r) => leeSweeps(r.points, r.closed, !pit, look, sunShadowLength(r.drop)));
      if (sweeps.length === 0) continue;
      const onto = pit ? band.rings : everywhere;
      const above = bands
        .filter((b) => (pit ? b.height > band.height : b.height >= band.height))
        .flatMap((b) => b.rings);
      const clip = clipper2Engine.difference(clipper2Engine.union(onto, []), above);
      out.push({ fill: clipper2Engine.union(sweeps, []), clip });
    }
  }
  return out;
}

/**
 * The shadows of floors and patches with a height, one part each, as a plateau's: a raised
 * one's, off its turned-away edges onto the ground outside it (`sunShadowLength` of its height
 * long); a sunk one's inside its own edge, from the rim the light comes over.
 */
export function reliefShadowParts(layer: DungeonLayer, look: ShadowLook, ground: Polygon[]): { fill: Polygon[]; clip: Polygon[] }[] {
  const reliefs = groundReliefs(layer);
  if (reliefs.length === 0) return [];
  const everywhere = [...ground, ...layerPlateaus(layer).bands.flatMap((b) => b.rings)];
  return reliefs.flatMap(({ height, rings }) => {
    const raised = height > 0;
    // The rings run with the outside on the left: a raised one's low side, a sunk one's high side.
    const sweeps = rings.flatMap((r) => leeSweeps(r, true, raised, look, sunShadowLength(height)));
    if (sweeps.length === 0) return [];
    const region = clipper2Engine.union(rings, []);
    const clip = raised ? clipper2Engine.difference(clipper2Engine.union(everywhere, []), region) : region;
    return [{ fill: clipper2Engine.union(sweeps, []), clip }];
  });
}

/** The cliffs' shadow polygons as they show: each part's fill cut to where it lands. */
export function cliffShadowGeometry(layer: DungeonLayer, look: ShadowLook, ground: Polygon[]): Polygon[] {
  return cliffShadowParts(layer, look, ground).flatMap(({ fill, clip }) => clipper2Engine.intersection(fill, clip));
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

  // "Casts shadow" off (the prop card's Behaviour switch) drops the prop's silhouette.
  const casters = props.filter((p) => p.obj.castsShadow !== false);
  const wanted = new Set(casters.map((p) => p.obj.id));
  for (const [id, held] of state.props) {
    if (wanted.has(id)) continue;
    if (!held.sprite.destroyed) held.sprite.destroy();
    state.props.delete(id);
  }

  for (const { sprite, obj } of casters) {
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
  const cast = propShadow(look, height, obj.standHeight);
  shadow.visible = true;
  // The foot of the prop, not its centre — asset sprites are anchored through the middle.
  shadow.position.set(obj.position.x, obj.position.y + (obj.height * obj.scale) / 2);
  shadow.scale.set((obj.width * obj.scale) / (shadow.texture.width || 1), cast.scaleY);
  shadow.skew.x = cast.skewX;
  shadow.alpha = cast.alpha;
  shadow.tint = parseInt(cast.color.replace('#', ''), 16);
}
