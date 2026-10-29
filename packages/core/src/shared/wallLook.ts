import type { DungeonLayer, DungeonStyle, ShapeChild } from '../store/types';
import type { Room, RoomArea, RoomLook, WallSegment, WallType } from './types';
import { WALL_TYPE_OCCLUSION } from './occlusion';
import { roomIndexOf } from './roomIndex';

/*
 * How a wall looks: which texture set its stones come from, how they are tinted and how
 * thick the band is. One resolution for the renderer, node editing and the preset command,
 * so a pin written by one is read the same way by the others.
 */

export interface WallLook {
  /** Texture set of the stones. Empty or absent means no stones. */
  setId: string | undefined;
  tint: string;
  width: number;
}

/**
 * What the renderers fall back to for a style key a layer may leave out. A preset that
 * pins drawn work writes these rather than `undefined`, which loses to nothing in a
 * spread, is dropped by JSON on save and so cannot hold anything.
 *
 * An empty texture set id means "no set", the same as the key being absent.
 */
export const STYLE_KEY_DEFAULTS: Readonly<Partial<DungeonStyle>> = {
  floorBleed: 0,
  wallTextureSetId: '',
  defaultTextureId: '',
};

/**
 * The `RoomLook` key a layer style key answers to, for the keys a level's look can
 * supply. The layer's own value wins; one it leaves unset falls through to its level.
 */
export const STYLE_TO_LOOK_KEY: Readonly<Partial<Record<keyof DungeonStyle, keyof RoomLook>>> = {
  defaultTextureId: 'floorTextureId',
  defaultTextureTint: 'floorTint',
  wallTextureSetId: 'wallTextureSetId',
  wallTextureTint: 'wallTextureTint',
  wallWidth: 'wallWidth',
};

/**
 * The value a style key paints with: the layer's; else, when the layer leaves it
 * unset, its level's look (pass the layer's `Level.look`); else the renderer's fallback.
 */
export function styleValueOrDefault<K extends keyof DungeonStyle>(
  style: DungeonStyle,
  key: K,
  levelLook?: RoomLook,
): DungeonStyle[K] {
  const v = style[key];
  if (v !== undefined) return v;
  const lookKey = STYLE_TO_LOOK_KEY[key];
  const fromLevel = lookKey && levelLook ? levelLook[lookKey] : undefined;
  return (fromLevel !== undefined ? fromLevel : STYLE_KEY_DEFAULTS[key]) as DungeonStyle[K];
}

/*
 * How a level's look meets a layer's style (the rule `lookScope.ts` resolves for the cards):
 *
 * - Keys a layer can leave unset — the floor texture (`defaultTextureId`), the floor tint
 *   (`defaultTextureTint`) and the wall set (`wallTextureSetId`) — take the layer's value
 *   when it has one (`undefined` is unset; `''` is a pin of "none"), else the level's.
 * - The wall tint and width are always present on a layer style, so a level could never
 *   be reached through them: there an explicit level pin wins over the layer's value (and
 *   over a floor's outline pin, which is the layer's value frozen by a preset).
 * - A room or area pin wins over both; that part is `edgeStyles`.
 * - A level floor texture paints the floors that have no texture of their own, on layers
 *   with no `defaultTextureId` (see `levelFloorTextureId`).
 */

/** The level's wall tint and width, the keys it pins over the layer's. Null when it pins neither. */
function levelWallPins(level: RoomLook | undefined): Partial<DungeonStyle> | null {
  if (!level) return null;
  let out: Partial<DungeonStyle> | null = null;
  if (level.wallTextureTint !== undefined) (out ??= {}).wallTextureTint = level.wallTextureTint;
  if (level.wallWidth !== undefined) (out ??= {}).wallWidth = level.wallWidth;
  return out;
}

const levelStyleMemo = new WeakMap<DungeonStyle, { level: RoomLook | undefined; out: DungeonStyle }>();

/**
 * The style a layer draws its walls with once its level's look is folded in: the
 * level's wall set where the layer leaves its own unset, the level's wall tint and
 * width where the level pins them. The layer's own style object when the level
 * changes nothing, and the same object for the same pair, so memo keys downstream
 * hold.
 */
export function levelStyle(style: DungeonStyle, level: RoomLook | undefined): DungeonStyle {
  if (!level) return style;
  const hit = levelStyleMemo.get(style);
  if (hit && hit.level === level) return hit.out;
  let out = style;
  const pins = levelWallPins(level);
  const set = style.wallTextureSetId === undefined ? level.wallTextureSetId : undefined;
  if (pins || set !== undefined) {
    out = { ...style, ...pins };
    if (set !== undefined) out.wallTextureSetId = set;
  }
  levelStyleMemo.set(style, { level, out });
  return out;
}

/**
 * The texture a floor with none of its own paints with: the level's floor texture,
 * on a layer that names no `defaultTextureId`. Undefined otherwise (the floor
 * paints its colour, as it always has).
 */
export function levelFloorTextureId(style: DungeonStyle, level: RoomLook | undefined): string | undefined {
  if (style.defaultTextureId !== undefined) return undefined;
  return level?.floorTextureId || undefined;
}

/** A standalone wall's band width: its own pin when it has one, else the layer's. */
export function wallWidthOf(wall: Pick<WallSegment, 'width'>, layerWidth: number): number {
  return typeof wall.width === 'number' && wall.width > 0 ? wall.width : layerWidth;
}

/** A standalone wall's look: each of its pins, else the layer's value. */
export function standaloneWallLook(wall: WallSegment, style: DungeonStyle): WallLook {
  return {
    setId: wall.textureSetId !== undefined ? wall.textureSetId || undefined : style.wallTextureSetId || undefined,
    tint: wall.textureTint ?? style.wallTextureTint,
    width: wallWidthOf(wall, style.wallWidth),
  };
}

/** The wall keys of a style, as a look. */
export function styleWallLook(style: DungeonStyle): WallLook {
  return { setId: style.wallTextureSetId || undefined, tint: style.wallTextureTint, width: style.wallWidth };
}

/**
 * The style keys a ring of the outline is drawn with: the stones' set, tint and width, and
 * the colour of the grid lines over the floor inside it.
 */
const OUTLINE_KEYS = ['wallTextureSetId', 'wallTextureTint', 'wallWidth', 'wallColor'] as const;

function outlinePins(shape: ShapeChild): Partial<DungeonStyle> | null {
  const o = shape.styleOverrides as Partial<DungeonStyle> | undefined;
  if (!o) return null;
  let out: Partial<DungeonStyle> | null = null;
  for (const k of OUTLINE_KEYS) {
    if (o[k] === undefined) continue;
    out ??= {};
    (out as Record<string, unknown>)[k] = o[k];
  }
  return out;
}

const samePins = (a: Partial<DungeonStyle> | null, b: Partial<DungeonStyle> | null): boolean =>
  OUTLINE_KEYS.every((k) => (a?.[k] ?? null) === (b?.[k] ?? null));

/** Most vertices a ring is sampled at when working out which floor it belongs to. */
const RING_SAMPLES = 24;
const ON_EDGE = 1e-4;

function onOrInside(x: number, y: number, poly: readonly [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    // On the edge counts: a union's corners sit on the shapes' own boundaries.
    const dx = xj - xi;
    const dy = yj - yi;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - xi) * dx + (y - yi) * dy) / len2)) : 0;
    if (Math.hypot(x - (xi + dx * t), y - (yi + dy * t)) < ON_EDGE) return true;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function bbox(poly: readonly [number, number][]): [number, number, number, number] {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of poly) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

/**
 * The floor a ring of the merged outline belongs to: the shape most of the ring's vertices
 * sit on or inside, the earliest drawn on a tie. Null when none does.
 */
export function ringOwner(ring: readonly [number, number][], shapes: readonly ShapeChild[]): ShapeChild | null {
  if (ring.length === 0) return null;
  const [rx0, ry0, rx1, ry1] = bbox(ring);
  const step = Math.max(1, Math.floor(ring.length / RING_SAMPLES));
  let best: ShapeChild | null = null;
  let bestHits = 0;
  for (const shape of shapes) {
    const outer = shape.contours[0];
    if (!outer || outer.length < 3) continue;
    const [sx0, sy0, sx1, sy1] = bbox(outer);
    if (sx1 < rx0 - ON_EDGE || sx0 > rx1 + ON_EDGE || sy1 < ry0 - ON_EDGE || sy0 > ry1 + ON_EDGE) continue;
    let hits = 0;
    for (let i = 0; i < ring.length; i += step) if (onOrInside(ring[i][0], ring[i][1], outer)) hits++;
    if (hits > bestHits) {
      best = shape;
      bestHits = hits;
    }
  }
  return best;
}

const ringMemo = new Map<string, { keys: readonly unknown[]; out: DungeonStyle[] }>();

/**
 * The style each ring of `layer.mergedFloor` draws with: the layer's, with the owning
 * floor's outline pins (stone set, tint and width, grid line colour) on top. A preset pins
 * those on the floors already drawn, so their outline keeps its look while the layer moves on.
 * `level` is the look of the layer's level, folded in by `levelStyle`'s rule; every caller
 * that draws or lays out the stones passes it, so they all agree.
 *
 * Without any outline pin on the layer, or with every floor pinned alike, no ring needs
 * placing and nothing is measured.
 */
export function ringStyles(layer: DungeonLayer, level?: RoomLook): DungeonStyle[] {
  const rings = layer.mergedFloor ?? [];
  const hit = ringMemo.get(layer.id);
  const keys = [rings, layer.children, layer.style, level] as const;
  if (hit && hit.keys.every((k, i) => k === keys[i])) return hit.out;

  const base = levelStyle(layer.style, level);
  // The level's tint and width beat a floor's outline pin too: that pin is only the
  // layer's own value, frozen onto drawn floors by a preset.
  const levelPins = levelWallPins(level);
  const pinned = (p: Partial<DungeonStyle>): DungeonStyle => ({ ...base, ...p, ...levelPins });
  const shapes = layer.children.filter((c): c is ShapeChild => c.childType === 'shape' && c.visible !== false);
  const pins = shapes.map(outlinePins);
  let out: DungeonStyle[];
  if (pins.every((p) => p === null)) {
    out = rings.map(() => base);
  } else if (pins.every((p) => samePins(p, pins[0]))) {
    const style = pinned(pins[0] ?? {});
    out = rings.map(() => style);
  } else {
    out = rings.map((ring) => {
      const owner = ringOwner(ring, shapes);
      const p = owner ? pins[shapes.indexOf(owner)] : null;
      return p ? pinned(p) : base;
    });
  }
  ringMemo.set(layer.id, { keys, out });
  return out;
}

/** The look ring `ring` of a layer's outline is drawn with (pass the layer's level look). */
export function ringLook(layer: DungeonLayer, ring: number, level?: RoomLook): WallLook {
  return styleWallLook(ringStyles(layer, level)[ring] ?? levelStyle(layer.style, level));
}

/* ── Per-edge styles: rooms and areas that pin a wall look ─────────────────
 *
 * A room (or the area it sits in) may pin the wall keys of its look. Walls stay the
 * layer's — a room never owns one — so the pin is read edge by edge: an edge of the
 * floor outline draws with the look of the room on its floor side. Where no room or
 * area pins a wall key, which is nearly every map, every ring answers null and the
 * renderers take the per-ring path exactly as before.
 */

/** The wall keys of a room's look, and the style keys they draw with (the same names). */
const ROOM_WALL_KEYS = ['wallTextureSetId', 'wallTextureTint', 'wallWidth'] as const;

/** How far inside the floor an edge's midpoint is probed for its room, in cells. */
export const EDGE_ROOM_NUDGE = 0.05;

const hasWallPin = (look: RoomLook | undefined): boolean =>
  !!look && ROOM_WALL_KEYS.some((k) => look[k] !== undefined);

/** Whether any room on the layer, or any area of it, pins a wall key. */
export function roomsPinWalls(layer: Pick<DungeonLayer, 'rooms' | 'areas'>): boolean {
  return (layer.rooms ?? []).some((r) => hasWallPin(r.look)) || (layer.areas ?? []).some((a) => hasWallPin(a.look));
}

/** The wall keys a room's own look or its area's pins, nearest first; null when neither pins any. */
export function roomWallPins(room: Room, areas: readonly RoomArea[] | undefined): Partial<DungeonStyle> | null {
  const area = room.areaId ? areas?.find((a) => a.id === room.areaId) : undefined;
  let out: Partial<DungeonStyle> | null = null;
  for (const k of ROOM_WALL_KEYS) {
    const v = room.look?.[k] ?? area?.look?.[k];
    if (v === undefined) continue;
    out ??= {};
    (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/**
 * The room whose floor an outline edge `a`→`b` bounds: the room at the edge's midpoint
 * nudged a hair to either side (the other side is off the floor, so at most one answers).
 */
export function edgeRoom(
  rooms: readonly Room[] | undefined,
  a: readonly [number, number],
  b: readonly [number, number],
): Room | null {
  if (!rooms?.length) return null;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return null;
  const nx = (-dy / len) * EDGE_ROOM_NUDGE;
  const ny = (dx / len) * EDGE_ROOM_NUDGE;
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const index = roomIndexOf(rooms);
  const room = index.roomAt(mx + nx, my + ny) ?? index.roomAt(mx - nx, my - ny);
  return room && !room.orphaned ? room : null;
}

const edgeMemo = new Map<string, { keys: readonly unknown[]; out: (DungeonStyle[] | null)[] }>();

/**
 * The style each edge of each ring of `layer.mergedFloor` draws with: for ring `i`, null
 * when every edge takes the ring's style (`ringStyles(layer)[i]`), else one style per edge
 * (edge `e` runs from vertex `e` to vertex `e + 1`, wrapping). An edge whose room or area
 * pins a wall key takes the ring's style with those keys on top. Edges that resolve alike
 * share one style object, so a renderer can batch runs by identity.
 */
export function edgeStyles(layer: DungeonLayer, level?: RoomLook): (DungeonStyle[] | null)[] {
  const rings = layer.mergedFloor ?? [];
  const keys = [rings, layer.children, layer.style, layer.rooms, layer.areas, level] as const;
  const hit = edgeMemo.get(layer.id);
  if (hit && hit.keys.every((k, i) => k === keys[i])) return hit.out;

  let out: (DungeonStyle[] | null)[];
  if (!roomsPinWalls(layer)) {
    out = rings.map(() => null);
  } else {
    const base = ringStyles(layer, level);
    const pinsOf = new Map<string, Partial<DungeonStyle> | null>();
    out = rings.map((ring, i) => {
      const n = ring.length;
      if (n < 2) return null;
      const ringStyle = base[i] ?? levelStyle(layer.style, level);
      // One merged style per distinct pin set on this ring, so equal edges are identical.
      const merged = new Map<Partial<DungeonStyle>, DungeonStyle>();
      let styles: DungeonStyle[] | null = null;
      for (let e = 0; e < n; e++) {
        const room = edgeRoom(layer.rooms, ring[e], ring[(e + 1) % n]);
        if (!room) continue;
        let pins = pinsOf.get(room.id);
        if (pins === undefined) pinsOf.set(room.id, (pins = roomWallPins(room, layer.areas)));
        if (!pins) continue;
        let style = merged.get(pins);
        if (!style) merged.set(pins, (style = { ...ringStyle, ...pins }));
        styles ??= new Array<DungeonStyle>(n).fill(ringStyle);
        styles[e] = style;
      }
      return styles;
    });
  }
  edgeMemo.set(layer.id, { keys, out });
  return out;
}

/* ── Wall types ───────────────────────────────────────── */

/**
 * The three kinds of wall the engine tells apart. Lighting and sight read only whether a
 * wall blocks light, so of the five stored types, normal and ethereal behave alike, as do
 * terrain and invisible. Window stands alone: drawn as a wall, but light passes through.
 */
export type WallTypeGroup = 'solid' | 'window' | 'open';

export function wallTypeGroup(type: WallType): WallTypeGroup {
  if (type === 'window') return 'window';
  return WALL_TYPE_OCCLUSION[type]?.blocksLight === false ? 'open' : 'solid';
}

/** The stored type each group writes for a newly drawn wall. */
export const GROUP_WALL_TYPE: Record<WallTypeGroup, WallType> = {
  solid: 'normal',
  window: 'window',
  open: 'invisible',
};
