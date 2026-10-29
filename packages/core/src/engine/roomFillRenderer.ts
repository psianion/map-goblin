import { Container, Graphics, TilingSprite } from 'pixi.js';
import type { DungeonLayer, Level, MapSettings } from '../store/types';
import type { Polygon } from '../types/geometry';
import { useStore } from '../store/store';
import { unitTexture } from '../assets/textureLoader';
import { hasLiveTexture } from '../assets/packCatalog';
import { lookSource, levelOf, roomChain, roomHasLook, roomLooks, type LookSource } from '../shared/lookScope';
import { roomFace } from '../shared/roomUtils';
import { DEFAULT_TEXTURE_SCALE } from '../shared/types';
import { clipper2Engine } from '../geometry/Clipper2Engine';
import { armLateTextureRebuild } from './floorWallRenderer';

/*
 * Floor looks pinned on rooms and areas (and a floor tint pinned on a level), painted
 * over a layer's floor. The floors themselves stay per-shape: a room whose look pins
 * a floor texture gets that texture over its face; one that pins only a tint gets the
 * tint multiplied over whatever floor is there, so its stones of texture keep showing
 * through in the new colour. Faces never overlap, so per-face is all there is to it.
 *
 * Everything lives in one container per floor sublayer, kept across the floor's full
 * rebuilds and redrawn on its own key: the rooms, the areas, the layer style and the
 * level look. A rename or an anchor nudge moves the rooms array and costs a key check
 * and a redraw of a handful of polygons, never a re-bake of the floor.
 */

/** 200 texture pixels to one grid cell, the floor bake's own scale. */
const PX_PER_GRID_CELL = 200;

interface FillSlot {
  node: Container;
  keys: readonly unknown[] | null;
}

const slots = new WeakMap<Container, FillSlot>();

function slotOf(floor: Container): FillSlot {
  let slot = slots.get(floor);
  if (!slot) {
    const node = new Container();
    node.label = 'roomFills';
    slot = { node, keys: null };
    slots.set(floor, slot);
  }
  return slot;
}

/** Take the fills out of `floor` before it is emptied, so the rebuild does not destroy them. */
export function detachRoomFills(floor: Container): void {
  const slot = slots.get(floor);
  if (slot && slot.node.parent === floor) floor.removeChild(slot.node);
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

function signedArea(poly: Polygon): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  return a / 2;
}

/** The fill keys: what the drawn fills are a function of. */
function fillKeys(state: { mapSettings: MapSettings; levels?: readonly Level[] }, layer: DungeonLayer): readonly unknown[] {
  return [layer.rooms, layer.areas, layer.style, layer.mergedFloor, levelOf(state.levels ?? [], layer).look];
}

/**
 * Put the room fills back into `floor` (at the top of it — call after the floor's own
 * fills and transitions) and redraw them if what they are drawn from moved.
 */
export function drawRoomFills(floor: Container, layer: DungeonLayer, opts: { force?: boolean } = {}): void {
  const state = useStore.getState();
  const slot = slotOf(floor);
  if (slot.node.parent !== floor) floor.addChild(slot.node);
  const keys = fillKeys(state, layer);
  if (!opts.force && slot.keys && slot.keys.length === keys.length && slot.keys.every((k, i) => k === keys[i])) return;
  slot.keys = keys;

  for (const child of slot.node.removeChildren()) child.destroy({ children: true });
  const fills = roomFloorFills(state, layer);

  const level = levelTintPolygons(state, layer, fills);
  if (level) {
    const g = new Graphics();
    // Outers filled, holes cut: Clipper hands holes back wound the other way.
    const outers = level.polygons.filter((p) => p.length >= 3 && signedArea(p) >= 0);
    const holes = level.polygons.filter((p) => p.length >= 3 && signedArea(p) < 0);
    for (const p of outers) tracePoly(g, p);
    g.fill({ color: level.color });
    if (holes.length > 0) {
      for (const p of holes) tracePoly(g, p);
      g.cut();
    }
    g.blendMode = 'multiply';
    slot.node.addChild(g);
  }

  if (fills.size === 0) return;
  const tints = new Graphics();
  tints.blendMode = 'multiply';
  let anyTint = false;
  for (const room of layer.rooms ?? []) {
    const fill = fills.get(room.id);
    if (!fill) continue;
    const face = roomFace(room);
    if (face.length < 3) continue;
    if (fill.kind === 'texture') {
      if (texturedFace(slot.node, face, fill.textureId, fill.tint)) continue;
      // Not loaded yet: the next floor rebuild (armed for when it lands) redraws these.
      slot.keys = null;
      armLateTextureRebuild(layer.id, fill.textureId);
    }
    if (fill.kind === 'tint') {
      tracePoly(tints, face);
      tints.fill({ color: fill.color });
      anyTint = true;
      continue;
    }
    // A solid floor, or a texture not loaded yet standing in with its tint.
    const color = fill.kind === 'solid' ? fill.color : parseColor(fill.tint, parseColor(layer.style.floorColor, 0x808080));
    const g = new Graphics();
    tracePoly(g, face);
    g.fill({ color });
    slot.node.addChild(g);
  }
  if (anyTint) slot.node.addChild(tints);
  else tints.destroy();
}
