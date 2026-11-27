import { Container, Graphics, TilingSprite } from 'pixi.js';
import type { DungeonLayer, Level, MapSettings, ShapeChild } from '../store/types';
import type { Room } from '../shared/types';
import type { Polygon } from '../types/geometry';
import { useStore } from '../store/store';
import { unitTexture } from '../assets/textureLoader';
import { hasLiveTexture } from '../assets/packCatalog';
import { lookSource, levelOf, roomChain, roomHasLook, roomLooks, type LookSource } from '../shared/lookScope';
import { roomFace } from '../shared/roomUtils';
import { roomIndexOf } from '../shared/roomIndex';
import { pieceRings } from '../shared/pieces';
import { wallWidthOf, levelFloorTextureId } from '../shared/wallLook';
import { DEFAULT_TEXTURE_SCALE } from '../shared/types';
import { clipper2Engine } from '../geometry/Clipper2Engine';
import { resolveStyle } from './styleResolver';
import { armLateTextureRebuild, floorColorOf, paintTiled, type TiledLook } from './floorWallRenderer';
import { distanceToLines, fallOff, fieldOf, insideOf, insideRings, keptRamp, rampGrid, type Ramp } from './rampMask';
import { paintRamp } from './softPiece';

/*
 * Floor looks on rooms and areas (and a floor tint pinned on a level), painted over a layer's
 * floors. The floors themselves are per piece, in their drawing order; a room's fill is what
 * makes the room read as one floor.
 *
 * Sharp (the layer's `showEdgeTransitions` off): a room whose look pins a floor texture gets
 * that texture over its face, hard-edged; one that pins only a tint gets the tint multiplied
 * over whatever floor is there.
 *
 * Blend (on, the default): every room has one floor, its pinned floor or else the floor its pin
 * stands on. A room whose face another floor of another look runs into, or that pins a floor of
 * its own, is painted that floor over its whole face, so a neighbour's overhang takes the
 * room's floor. Where the fill meets a different floor (the next room at a door or a divide,
 * plain floor) it runs half the layer's blend width past the face and fades through a true
 * ramp one blend width wide; along the floor's own outline it stays hard, under the wall. A
 * room whose face lies on one floor and pins none gets no fill at all.
 *
 * A room on painted (ground) floor paints its pinned floor over that ground, in both modes.
 *
 * Everything lives in two containers per floor sublayer kept across the floor's full rebuilds:
 * the walled rooms' inside the walled floors' clip, the ground rooms' over the pieces. Both
 * are redrawn on their own key, so a rename or an anchor nudge costs a key check, never a
 * re-bake of the floor.
 */

/** 200 texture pixels to one grid cell, the floor bake's own scale. */
const PX_PER_GRID_CELL = 200;
/** How far past a face's edge the floor on the other side is read, cells. */
const PROBE = 0.3;
/** How far past the region a seam's ramp grid reaches, cells. */
const RAMP_PAD = 0.1;

interface FillSlot {
  node: Container;
  keys: readonly unknown[] | null;
}

const slots = new WeakMap<Container, FillSlot>();
const groundSlots = new WeakMap<Container, FillSlot>();

function slotIn(map: WeakMap<Container, FillSlot>, host: Container, label: string): FillSlot {
  let slot = map.get(host);
  if (!slot || slot.node.destroyed) {
    const node = new Container();
    node.label = label;
    slot = { node, keys: null };
    map.set(host, slot);
  }
  return slot;
}

/** Take the fills out of `floor` before it is emptied, so the rebuild does not destroy them. */
export function detachRoomFills(floor: Container): void {
  for (const map of [slots, groundSlots]) {
    const slot = map.get(floor);
    if (slot && slot.node.parent === floor) floor.removeChild(slot.node);
  }
}

const pinned = (s: LookSource): boolean => s === 'room' || s === 'area';

function parseColor(hex: string | undefined, fallback: number): number {
  if (!hex) return fallback;
  const n = parseInt(hex.replace('#', ''), 16);
  return Number.isNaN(n) ? fallback : n;
}

function mulColor(a: number, b: number): number {
  const r = Math.round((((a >> 16) & 0xff) * ((b >> 16) & 0xff)) / 255);
  const g = Math.round((((a >> 8) & 0xff) * ((b >> 8) & 0xff)) / 255);
  const bl = Math.round(((a & 0xff) * (b & 0xff)) / 255);
  return (r << 16) | (g << 8) | bl;
}

/** What one face is painted with, or null for a face that pins nothing about its floor. */
export type FaceFill =
  | { kind: 'texture'; textureId: string; tint: string }
  | { kind: 'solid'; color: number }
  | { kind: 'tint'; color: number };

/**
 * The fill for each room on `layer` whose floor look is pinned on the room or its area,
 * by room id. Rooms that inherit their floor from the layer or level are absent.
 */
export function roomFloorFills(
  state: { mapSettings: MapSettings; levels?: readonly Level[] },
  layer: DungeonLayer,
): Map<string, FaceFill> {
  const out = new Map<string, FaceFill>();
  const rooms = layer.rooms ?? [];
  if (rooms.length === 0) return out;
  const looks = roomLooks(state, layer);
  for (const room of rooms) {
    if (!roomHasLook(layer, room)) continue;
    const chain = roomChain(state, layer, room);
    const texPinned = pinned(lookSource(chain, 'floorTextureId'));
    const tintPinned = pinned(lookSource(chain, 'floorTint'));
    if (!texPinned && !tintPinned) continue;
    const look = looks.get(room.id);
    if (!look) continue;
    if (texPinned) {
      out.set(
        room.id,
        look.floorTextureId
          ? { kind: 'texture', textureId: look.floorTextureId, tint: look.floorTint }
          : // Pinned to no texture: the plain floor colour, in the room's tint.
            { kind: 'solid', color: mulColor(parseColor(layer.style.floorColor, 0x808080), parseColor(look.floorTint, 0xffffff)) },
      );
    } else {
      out.set(room.id, { kind: 'tint', color: parseColor(look.floorTint, 0xffffff) });
    }
  }
  return out;
}

/* ── Which rooms get a fill, and how ───────────────────────────────────── */

/** A floor piece as the fills read it: where it is, and the look it paints with. */
interface Floor {
  shape: ShapeChild;
  rings: Polygon[];
  box: [number, number, number, number];
  /** Its look as one string: two floors that paint alike have the same key. */
  key: string;
  /** Its texture when it paints one, else its colour. */
  textureId: string | undefined;
  color: number;
  tint: number;
}

/** One room's fill as planned: its face, what it is painted with and which of its edges blend. */
export interface RoomFill {
  room: Room;
  face: Polygon;
  fill: FaceFill;
  /** How a texture is laid: the floor's own scale, turn and offset where the fill is that floor's. */
  look: Pick<TiledLook, 'scale' | 'rotation' | 'offsetX' | 'offsetY'> | null;
  /** On painted ground rather than walled floor. */
  ground: boolean;
  /** Blend: the face's edges with another floor beyond them, each a line; null in Sharp. */
  seams: Polygon[] | null;
  /** Blend: the edges with the same floor (or no floor) beyond them, where the fill stays full out past the cut. */
  hard: Polygon[];
  /** Blend: the edges another room's fill, drawn later, fades in over: the fill runs on full beneath it. */
  under: Polygon[];
}

function boxOf(rings: readonly Polygon[]): [number, number, number, number] {
  const b: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const r of rings) for (const [x, y] of r) [b[0], b[1], b[2], b[3]] = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)];
  return b;
}

const overlaps = (a: readonly number[], b: readonly number[]): boolean => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

function ringArea(poly: Polygon): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  return a / 2;
}

/** `ring` wound positive, as Clipper winds an outer ring: grown, it grows. */
const positive = (ring: Polygon): Polygon => (ringArea(ring) >= 0 ? ring : [...ring].reverse());

const ringsOf = new WeakMap<ShapeChild, Polygon[]>();
function shapeRings(shape: ShapeChild): Polygon[] {
  let hit = ringsOf.get(shape);
  if (!hit) ringsOf.set(shape, (hit = pieceRings(shape).filter((r) => r.length >= 3)));
  return hit;
}

/** The layer's visible floor pieces, in drawing order, each with its look. */
function floorsOf(state: { levels?: readonly Level[] }, layer: DungeonLayer): Floor[] {
  const fallback = levelFloorTextureId(layer.style, levelOf(state.levels ?? [], layer).look);
  const out: Floor[] = [];
  for (const c of layer.children) {
    if (c.childType !== 'shape' || c.visible === false || (c.contours[0]?.length ?? 0) < 3) continue;
    const rings = shapeRings(c);
    if (rings.length === 0) continue;
    const id = c.textureId || fallback;
    const live = !!id && hasLiveTexture(id);
    const tint = live ? parseColor(c.textureTint, 0xffffff) : 0xffffff;
    const color = floorColorOf(resolveStyle(layer.style, c.styleOverrides as Partial<DungeonLayer['style']> | undefined));
    out.push({ shape: c, rings, box: boxOf(rings), key: live ? `t:${id}:${tint}` : `c:${color}`, textureId: live ? id : undefined, color, tint });
  }
  return out;
}

/** The topmost of `floors` at `p`, among those `keep` lets through. */
function floorAt(floors: readonly Floor[], p: [number, number], keep: (f: Floor) => boolean = () => true): Floor | null {
  for (let i = floors.length - 1; i >= 0; i--) {
    const f = floors[i];
    if (!keep(f) || p[0] < f.box[0] || p[0] > f.box[2] || p[1] < f.box[1] || p[1] > f.box[3]) continue;
    if (insideRings(f.rings, p)) return f;
  }
  return null;
}

/** A point of the face to read it by: the room's pin when it lies in the face, else its centroid. */
function pointOf(room: Room, face: Polygon): [number, number] {
  if (room.anchor && insideRings([face], room.anchor)) return room.anchor;
  if (room.centroid && insideRings([face], room.centroid)) return room.centroid;
  return room.anchor ?? face[0];
}

/**
 * How far a fill reaches past its face where nothing fades it, cells: past the widest cut a wall
 * or door makes round a face, so the strip a cut leaves is the room's floor too.
 */
export function faceReach(layer: DungeonLayer): number {
  let half = Math.max(0.15, (layer.style.wallWidth ?? 0.5) / 2);
  for (const w of layer.standaloneWalls) half = Math.max(half, wallWidthOf(w, layer.style.wallWidth) / 2);
  return half + 0.05;
}

/**
 * Where the layer's rooms lie: each face grown over the cuts round it, as one region. The flat
 * wash between differently textured floors stays off it. Empty for a layer with no room.
 */
export function roomCover(layer: DungeonLayer): Polygon[] {
  const faces = (layer.rooms ?? []).map((r) => roomFace(r)).filter((f) => f.length >= 3).map(positive);
  if (faces.length === 0) return [];
  return clipper2Engine.inflate(faces, faceReach(layer));
}

/** The layer's floor edges choice: Blend (true) or Sharp. */
export const blendsFloors = (layer: Pick<DungeonLayer, 'style'>): boolean => layer.style.showEdgeTransitions !== false;

/** Fills built since the module loaded: the guard on how many a rebuild asks for. */
let built = 0;
export const roomFillsBuilt = (): number => built;

const planMemo = new Map<string, { keys: readonly unknown[]; plan: RoomFill[] }>();

/**
 * The room fills `layer` needs, in the rooms' order (smallest last, so where two faces meet
 * the room a point lookup answers is drawn over). Rooms that need none are absent: in Blend a
 * room is filled when it pins a floor look or when a floor of another look runs into its face;
 * in Sharp only when it pins one.
 */
export function roomFillPlan(state: { mapSettings: MapSettings; levels?: readonly Level[] }, layer: DungeonLayer): RoomFill[] {
  const keys = fillKeys(state, layer);
  const hit = planMemo.get(layer.id);
  if (hit && hit.keys.length === keys.length && hit.keys.every((k, i) => k === keys[i])) return hit.plan;
  const plan = planFills(state, layer);
  planMemo.set(layer.id, { keys, plan });
  return plan;
}

function planFills(state: { mapSettings: MapSettings; levels?: readonly Level[] }, layer: DungeonLayer): RoomFill[] {
  const rooms = (layer.rooms ?? []).filter((r) => roomFace(r).length >= 3);
  if (rooms.length === 0) return [];
  const blend = blendsFloors(layer);
  const pins = roomFloorFills(state, layer);
  if (!blend && pins.size === 0) return [];
  const floors = floorsOf(state, layer);
  const walledFloor = layer.mergedFloor ?? [];
  const walled = (f: Floor) => !f.shape.ground;
  const ground = (f: Floor) => !!f.shape.ground;

  // Each room's floor: where it is, the piece its pin stands on, and its look as a key.
  const info = new Map<string, { face: Polygon; onGround: boolean; base: Floor | null; key: string | null }>();
  for (const room of rooms) {
    const face = positive(roomFace(room));
    const at = pointOf(room, face);
    const onGround = !(walledFloor.length > 0 && insideRings(walledFloor, at));
    const base = floorAt(floors, at, onGround ? ground : walled);
    const pin = pins.get(room.id);
    let key: string | null = base?.key ?? null;
    if (pin?.kind === 'texture') key = `t:${pin.textureId}:${parseColor(pin.tint, 0xffffff)}`;
    else if (pin?.kind === 'solid') key = `c:${pin.color}`;
    else if (pin?.kind === 'tint') key = base ? `${base.key}*${pin.color}` : `*${pin.color}`;
    info.set(room.id, { face, onGround, base, key });
  }

  // Which rooms are filled, and with what.
  const chosen: Omit<RoomFill, 'seams' | 'hard' | 'under'>[] = [];
  for (const room of rooms) {
    const { face, onGround, base } = info.get(room.id)!;
    const pin = pins.get(room.id);
    // A ground room is painted only on painted floor, never on a picture or bare ground.
    if (onGround && (!pin || !base)) continue;
    if (!pin && (!blend || !base || room.orphaned)) continue;
    let fill: FaceFill;
    let look: RoomFill['look'] = null;
    const fromBase = (tint: number): FaceFill =>
      base!.textureId ? { kind: 'texture', textureId: base!.textureId, tint: `#${tint.toString(16).padStart(6, '0')}` } : { kind: 'solid', color: mulColor(base!.color, tint) };
    if (pin && pin.kind !== 'tint') {
      fill = pin;
    } else if (!blend) {
      // Sharp: a tint over whatever is there.
      fill = pin!;
    } else {
      const mixed = !onGround && base !== null && runsInto(floors, base, face);
      if (pin) {
        // A tint on one floor multiplies over it; over several, the room's floor takes the tint.
        fill = mixed ? fromBase(mulColor(base!.tint, pin.color)) : pin;
      } else {
        if (!mixed) continue;
        fill = fromBase(base!.tint);
      }
      if (fill.kind !== 'tint' && base) look = lookOf(base.shape);
    }
    chosen.push({ room, face, fill, look, ground: onGround });
  }
  // Drawn walled first, then ground, each in the rooms' order.
  chosen.sort((a, b) => Number(a.ground) - Number(b.ground));
  const order = new Map(chosen.map((c, i) => [c.room.id, i]));

  const index = blend ? roomIndexOf(rooms) : null;
  const reach = faceReach(layer);
  const ramps =blend && (layer.style.edgeTransitionWidth ?? 0) > 0;
  return chosen.map((c, i): RoomFill => {
    if (!ramps) return { ...c, seams: null, hard: [], under: [] };
    const { face, room } = c;
    const key = info.get(room.id)!.key;
    const seams: Polygon[] = [];
    const hard: Polygon[] = [];
    const under: Polygon[] = [];
    for (let e = 0; e < face.length; e++) {
      const a = face[e];
      const b = face[(e + 1) % face.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1e-6) continue;
      // Outward, for a ring wound positive.
      const nx = (b[1] - a[1]) / len;
      const ny = -(b[0] - a[0]) / len;
      const at = (d: number): [number, number] => [(a[0] + b[0]) / 2 + nx * d, (a[1] + b[1]) / 2 + ny * d];
      const p = at(PROBE);
      // The room beyond, near; else across the widest cut a wall or door makes between two faces.
      const across = at(2 * reach + 0.05);
      const there = index!.roomAt(p[0], p[1]) ?? index!.roomAt(across[0], across[1]);
      const other = there && there.id !== room.id ? there : null;
      const beyond = other ? info.get(other.id)!.key : there ? key : (floorAt(floors, p)?.key ?? null);
      const edge: Polygon = [a, b];
      if (beyond === null || beyond === key) hard.push(edge);
      // A filled room drawn later fades in over this one: this one runs on full beneath it.
      else if (other && (order.get(other.id) ?? -1) > i) under.push(edge);
      else seams.push(edge);
    }
    return { ...c, seams, hard, under };
  });
}

/** Whether a visible walled floor of another look than `base`'s covers part of `face`. */
function runsInto(floors: readonly Floor[], base: Floor, face: Polygon): boolean {
  const box = boxOf([face]);
  for (const f of floors) {
    if (f === base || f.shape.ground || f.key === base.key || !overlaps(f.box, box)) continue;
    const common = clipper2Engine.intersection([face], [f.rings[0]]);
    if (common.reduce((s, r) => s + Math.abs(ringArea(r)), 0) > 1e-3) return true;
  }
  return false;
}

function lookOf(shape: ShapeChild): RoomFill['look'] {
  return { scale: shape.textureScale || 1, rotation: shape.textureFillRotation, offsetX: shape.textureOffsetX ?? 0, offsetY: shape.textureOffsetY ?? 0 };
}

/** How far a fill runs on beneath a later room's fill fading in over it, cells: past that fade's far end. */
const underReach = (width: number, reach: number): number => 2 * reach + width;

/**
 * The ramp a Blend fill is painted through: full inside its face, fading out across each seam
 * from half the blend width `width` inside it to half outside; past an edge with the same floor
 * (or no floor) beyond it, full out to `reach`; past an edge another room's fill fades in over,
 * full on beneath that fade. Worked out texel by texel from each texel's distance to the
 * edges, eased: no steps.
 */
export function seamRamp(face: Polygon, f: Pick<RoomFill, 'seams' | 'hard' | 'under'>, width: number, reach: number): Ramp | null {
  const seams = f.seams ?? [];
  return keptRamp('roomSeam', [face, seams, f.under, width, reach], () => {
    const half = width / 2;
    const beneath = underReach(width, reach);
    const grow = Math.max(reach, half + 0.05, f.under.length > 0 ? beneath : 0);
    const clip = clipper2Engine.inflate([face], grow);
    const grid = rampGrid(clip, RAMP_PAD);
    if (!grid) return null;
    const far = grow + RAMP_PAD + 2 / grid.res;
    const lines = (edges: readonly Polygon[]): Float32Array | null =>
      edges.length > 0 ? distanceToLines(edges.map((pts) => ({ pts, closed: false })), grid, far).d : null;
    const inside = insideOf([face], grid);
    const seam = lines(seams);
    const hard = lines(f.hard);
    const under = lines(f.under);
    // 1 at half the width inside a seam, 0 at half outside it.
    const across = (s: number): number => fallOff(-s, -half, width);
    return {
      field: fieldOf(grid, (_x, _y, k) => {
        const ds = seam ? seam[k] : Infinity;
        if (inside[k]) return ds === Infinity ? 1 : across(ds);
        const dh = hard ? hard[k] : Infinity;
        const du = under ? under[k] : Infinity;
        if (du < ds && du <= dh) return du <= beneath ? 1 : 0;
        if (dh < ds) return dh <= reach ? 1 : 0;
        return ds === Infinity ? 0 : across(-ds);
      }),
      clip,
    };
  });
}

/* ── Drawing ───────────────────────────────────────────────────────────── */

function tracePoly(g: Graphics, poly: readonly [number, number][]): void {
  g.moveTo(poly[0][0], poly[0][1]);
  for (let i = 1; i < poly.length; i++) g.lineTo(poly[i][0], poly[i][1]);
  g.closePath();
}

function texturedFace(parent: Container, face: [number, number][], textureId: string, tint: string): boolean {
  if (!hasLiveTexture(textureId)) return false;
  const texture = unitTexture(textureId).texture;
  // The 1×1 stand-in for a pack texture still loading: fall back to its tint for now.
  if (texture.width <= 1) return false;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of face) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const tileScale = DEFAULT_TEXTURE_SCALE / PX_PER_GRID_CELL;
  const ts = new TilingSprite({ texture, width: maxX - minX, height: maxY - minY, tileScale: { x: tileScale, y: tileScale } });
  ts.position.set(minX, minY);
  // Anchored to the world origin, like the floor bake, so a room's texture lines up with its neighbours'.
  ts.tilePosition.set(-minX / tileScale, -minY / tileScale);
  const t = parseColor(tint, 0xffffff);
  if (t !== 0xffffff) ts.tint = t;
  const mask = new Graphics();
  tracePoly(mask, face);
  mask.fill({ color: 0xffffff });
  const holder = new Container();
  holder.addChild(ts, mask);
  holder.mask = mask;
  parent.addChild(holder);
  return true;
}

/**
 * The level's floor tint, where the layer leaves its own unset: multiplied over the
 * layer's floor, minus the faces whose room or area pins a floor of its own.
 */
function levelTintPolygons(
  state: { mapSettings: MapSettings; levels?: readonly Level[] },
  layer: DungeonLayer,
  fills: Map<string, FaceFill>,
): { color: number; polygons: Polygon[] } | null {
  const chain = roomChain(state, layer);
  if (lookSource(chain, 'floorTint') !== 'level') return null;
  const color = parseColor(levelOf(state.levels ?? [], layer).look?.floorTint, 0xffffff);
  if (color === 0xffffff) return null;
  const floor = layer.mergedFloor ?? [];
  if (floor.length === 0) return null;
  const own = (layer.rooms ?? []).filter((r) => fills.has(r.id)).map((r) => roomFace(r)).filter((f) => f.length >= 3);
  return { color, polygons: own.length > 0 ? clipper2Engine.difference(floor, own) : floor };
}

/** The fill keys: what the drawn fills are a function of. */
function fillKeys(state: { mapSettings: MapSettings; levels?: readonly Level[] }, layer: DungeonLayer): readonly unknown[] {
  return [layer.rooms, layer.areas, layer.style, layer.mergedFloor, layer.children, layer.standaloneWalls, levelOf(state.levels ?? [], layer).look];
}

const sameKeys = (a: readonly unknown[] | null, b: readonly unknown[]): boolean => !!a && a.length === b.length && a.every((k, i) => k === b[i]);

/** The colour a fill stands in with while its texture is not loaded (or for a plain floor). */
function standIn(fill: FaceFill, layer: DungeonLayer): number {
  if (fill.kind === 'solid' || fill.kind === 'tint') return fill.color;
  return parseColor(fill.tint, parseColor(layer.style.floorColor, 0x808080));
}

/**
 * One planned fill, into `parent` (a Sharp tint into `tints`, multiplied as one). Returns
 * whether it drew into `tints`, and whether its texture had not loaded yet.
 */
function drawFill(parent: Container, layer: DungeonLayer, f: RoomFill, tints: Graphics): { tinted: boolean; late: boolean } {
  built++;
  const { face, fill } = f;
  if (f.seams === null) {
    // Sharp: the face, hard-edged.
    if (fill.kind === 'tint') {
      tracePoly(tints, face);
      tints.fill({ color: fill.color });
      return { tinted: true, late: false };
    }
    let late = false;
    if (fill.kind === 'texture') {
      if (texturedFace(parent, face, fill.textureId, fill.tint)) return { tinted: false, late: false };
      // Not loaded yet: the next floor rebuild (armed for when it lands) redraws these.
      armLateTextureRebuild(layer.id, fill.textureId);
      late = true;
    }
    const g = new Graphics();
    tracePoly(g, face);
    g.fill({ color: standIn(fill, layer) });
    parent.addChild(g);
    return { tinted: false, late };
  }
  const reach = faceReach(layer);
  const texture = fill.kind === 'texture' && hasLiveTexture(fill.textureId) ? unitTexture(fill.textureId).texture : null;
  const loaded = !!texture && texture.width > 1;
  const late = fill.kind === 'texture' && !loaded;
  if (late) armLateTextureRebuild(layer.id, (fill as { textureId: string }).textureId);
  const look: TiledLook = { ...(f.look ?? { scale: DEFAULT_TEXTURE_SCALE }), tint: fill.kind === 'texture' ? tintOrNone(fill.tint) : undefined };
  // What a plain colour is drawn into: multiplied as a tint, else over the floor.
  const host = (): Container => {
    if (fill.kind !== 'tint') return parent;
    const holder = new Container();
    holder.blendMode = 'multiply';
    parent.addChild(holder);
    return holder;
  };
  if (f.seams.length === 0 && f.under.length === 0) {
    // Nothing beyond it to blend with: the face grown over the cuts round it.
    const grown = clipper2Engine.inflate([face], reach);
    if (loaded) paintTiled(parent, grown, texture!, { ...look, holes: true });
    else {
      const g = new Graphics();
      for (const r of grown) if (r.length >= 3) tracePoly(g, r);
      g.fill({ color: standIn(fill, layer) });
      host().addChild(g);
    }
    return { tinted: false, late };
  }
  const ramp = seamRamp(face, f, layer.style.edgeTransitionWidth, reach);
  if (!ramp) return { tinted: false, late };
  if (loaded) paintRamp(parent, ramp, { texture: texture!, look });
  else paintRamp(host(), ramp, { color: standIn(fill, layer) });
  return { tinted: false, late };
}

function tintOrNone(hex: string): number | undefined {
  const t = parseColor(hex, 0xffffff);
  return t === 0xffffff ? undefined : t;
}

/**
 * Put the walled rooms' fills back into `floor` (at the top of it — call after the floor's own
 * fills and transitions) and redraw them if what they are drawn from moved.
 */
export function drawRoomFills(floor: Container, layer: DungeonLayer, opts: { force?: boolean } = {}): void {
  const state = useStore.getState();
  const slot = slotIn(slots, floor, 'roomFills');
  if (slot.node.parent !== floor) floor.addChild(slot.node);
  const keys = fillKeys(state, layer);
  if (!opts.force && sameKeys(slot.keys, keys)) return;
  slot.keys = keys;

  for (const child of slot.node.removeChildren()) child.destroy({ children: true });

  const level = levelTintPolygons(state, layer, roomFloorFills(state, layer));
  if (level) {
    const g = new Graphics();
    // Outers filled, holes cut: Clipper hands holes back wound the other way.
    const outers = level.polygons.filter((p) => p.length >= 3 && ringArea(p) >= 0);
    const holes = level.polygons.filter((p) => p.length >= 3 && ringArea(p) < 0);
    for (const p of outers) tracePoly(g, p);
    g.fill({ color: level.color });
    if (holes.length > 0) {
      for (const p of holes) tracePoly(g, p);
      g.cut();
    }
    g.blendMode = 'multiply';
    slot.node.addChild(g);
  }
  if (paintFills(slot, layer, roomFillPlan(state, layer).filter((f) => !f.ground))) slot.keys = null;
}

/**
 * Put the fills of rooms on painted ground into `floor`, after its pieces, and redraw them if
 * what they are drawn from moved. Always leaves its container in place, so a look edit has
 * somewhere to draw.
 */
export function drawGroundRoomFills(floor: Container, layer: DungeonLayer, opts: { force?: boolean } = {}): void {
  const state = useStore.getState();
  const slot = slotIn(groundSlots, floor, 'groundRoomFills');
  if (slot.node.parent !== floor) floor.addChild(slot.node);
  const keys = fillKeys(state, layer);
  if (!opts.force && sameKeys(slot.keys, keys)) return;
  slot.keys = keys;
  for (const child of slot.node.removeChildren()) child.destroy({ children: true });
  if (paintFills(slot, layer, roomFillPlan(state, layer).filter((f) => f.ground))) slot.keys = null;
}

/** Whether `floor` holds the ground rooms' container (a rebuild put it there). */
export function hasGroundRoomFills(floor: Container): boolean {
  return groundSlots.get(floor)?.node.parent === floor;
}

/** Paints `plan` into `slot`; true when a texture was not loaded yet (the next rebuild redraws it). */
function paintFills(slot: FillSlot, layer: DungeonLayer, plan: readonly RoomFill[]): boolean {
  if (plan.length === 0) return false;
  const tints = new Graphics();
  tints.blendMode = 'multiply';
  let anyTint = false;
  let late = false;
  for (const f of plan) {
    const drawn = drawFill(slot.node, layer, f, tints);
    anyTint ||= drawn.tinted;
    late ||= drawn.late;
  }
  if (anyTint) slot.node.addChild(tints);
  else tints.destroy();
  return late;
}
