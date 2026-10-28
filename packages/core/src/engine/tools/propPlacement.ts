// Placement maths for the Props tool: where a stamp lands on the grid, the oriented
// boxes props are compared by, which part of a layer counts as floor, and what an
// erase brush touches. No Pixi objects and no store writes live here.

import type { Point } from '../../types/geometry';
import type { AssetChild, DungeonLayer } from '../../store/types';
import { getCatalogEntry, GRID_CELL_PX } from '../../assets/packCatalog';
import { resolveTexture } from '../../assets/textureLoader';
import { isCaveBandAsset } from '../../assets/caveWallKit';
import { roomIndexOf } from '../../shared/roomIndex';
import { pointInRing, roomFace } from '../../shared/roomUtils';

/** An oriented box: centre, half extents along its own axes, rotation in radians. */
export interface Obb {
  cx: number;
  cy: number;
  hw: number;
  hh: number;
  rot: number;
}

/** Within this of a multiple of 90° a footprint snaps by its edges (0.5°). */
const RIGHT_ANGLE_TOL = (0.5 * Math.PI) / 180;

/**
 * Natural size in grid cells for any asset id. Catalog entries carry
 * naturalWidth/Height; imported images have no entry, so the size comes from the
 * resolved texture's pixels. Null while that texture is not loaded.
 */
export function naturalSizeOf(assetId: string): { w: number; h: number } | null {
  const entry = getCatalogEntry(assetId);
  if (entry) return { w: entry.naturalWidth / GRID_CELL_PX, h: entry.naturalHeight / GRID_CELL_PX };
  const tex = resolveTexture(assetId);
  if (tex.width <= 1) return null;
  return { w: tex.width / GRID_CELL_PX, h: tex.height / GRID_CELL_PX };
}

/**
 * Where a footprint of `w × h` cells lands for a cursor. Near a right angle the
 * footprint's top-left snaps to the 1/division grid, so a 2×1 covers two whole
 * cells and a 1×1 sits in one; at any other angle the centre snaps. Snap off
 * returns the cursor. Callers fold Ctrl into `snapEnabled` (Ctrl inverts snap).
 */
export function footprintSnap(
  cursor: Point,
  w: number,
  h: number,
  rotation: number,
  snapEnabled: boolean,
  snapDivision: number,
): Point {
  if (!snapEnabled) return cursor;
  const step = 1 / snapDivision;
  const snap = (v: number): number => Math.round(v / step) * step;
  const quarters = rotation / (Math.PI / 2);
  const k = Math.round(quarters);
  if (Math.abs(quarters - k) * (Math.PI / 2) > RIGHT_ANGLE_TOL) {
    return { x: snap(cursor.x), y: snap(cursor.y) };
  }
  const odd = Math.abs(k) % 2 === 1;
  const W = odd ? h : w;
  const H = odd ? w : h;
  return { x: snap(cursor.x - W / 2) + W / 2, y: snap(cursor.y - H / 2) + H / 2 };
}

/** A placed child's oriented box, at its rendered size (`width·scale`). */
export function obbOfChild(c: AssetChild): Obb {
  return {
    cx: c.position.x,
    cy: c.position.y,
    hw: (c.width * c.scale) / 2,
    hh: (c.height * c.scale) / 2,
    rot: c.rotation,
  };
}

/** The four corners of a box, in order around it. */
export function obbCorners(o: Obb): Point[] {
  const c = Math.cos(o.rot);
  const s = Math.sin(o.rot);
  const ux = c * o.hw;
  const uy = s * o.hw;
  const vx = -s * o.hh;
  const vy = c * o.hh;
  return [
    { x: o.cx - ux - vx, y: o.cy - uy - vy },
    { x: o.cx + ux - vx, y: o.cy + uy - vy },
    { x: o.cx + ux + vx, y: o.cy + uy + vy },
    { x: o.cx - ux + vx, y: o.cy - uy + vy },
  ];
}

/** World-axis bounds of a box: [x0, y0, x1, y1]. */
export function obbBounds(o: Obb): [number, number, number, number] {
  const c = Math.abs(Math.cos(o.rot));
  const s = Math.abs(Math.sin(o.rot));
  const ex = c * o.hw + s * o.hh;
  const ey = s * o.hw + c * o.hh;
  return [o.cx - ex, o.cy - ey, o.cx + ex, o.cy + ey];
}

/** The same box with its half extents multiplied by `k`, centre kept. */
export function shrinkObb(o: Obb, k: number): Obb {
  return { ...o, hw: o.hw * k, hh: o.hh * k };
}

/** Separating-axis test: true when the two boxes overlap (touching edges do not). */
export function obbOverlap(a: Obb, b: Obb): boolean {
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  for (const rot of [a.rot, b.rot]) {
    for (const [ax, ay] of [
      [Math.cos(rot), Math.sin(rot)],
      [-Math.sin(rot), Math.cos(rot)],
    ]) {
      const ra = projectedRadius(a, ax, ay);
      const rb = projectedRadius(b, ax, ay);
      if (Math.abs(dx * ax + dy * ay) >= ra + rb) return false;
    }
  }
  return true;
}

function projectedRadius(o: Obb, ax: number, ay: number): number {
  const c = Math.cos(o.rot);
  const s = Math.sin(o.rot);
  return o.hw * Math.abs(c * ax + s * ay) + o.hh * Math.abs(-s * ax + c * ay);
}

/** True when the box meets the circle: the circle's centre, taken into the box's frame, clamped to it. */
export function obbMeetsCircle(o: Obb, cx: number, cy: number, r: number): boolean {
  const c = Math.cos(o.rot);
  const s = Math.sin(o.rot);
  const dx = cx - o.cx;
  const dy = cy - o.cy;
  const lx = c * dx + s * dy;
  const ly = -s * dx + c * dy;
  const qx = lx - Math.max(-o.hw, Math.min(o.hw, lx));
  const qy = ly - Math.max(-o.hh, Math.min(o.hh, ly));
  return qx * qx + qy * qy <= r * r;
}

/**
 * Boxes bucketed by the 1-cell grid squares their bounds touch, so an overlap or
 * count query looks at the few boxes near it instead of every prop on the layer.
 */
export class ObbHash {
  private items: Obb[] = [];
  private marks: number[] = [];
  private mark = 0;
  private buckets = new Map<number, number[]>();

  get size(): number {
    return this.items.length;
  }

  insert(o: Obb): void {
    const idx = this.items.length;
    this.items.push(o);
    this.marks.push(0);
    const [x0, y0, x1, y1] = obbBounds(o);
    for (let col = Math.floor(x0); col <= Math.floor(x1); col++) {
      for (let row = Math.floor(y0); row <= Math.floor(y1); row++) {
        const k = cellKey(col, row);
        let list = this.buckets.get(k);
        if (!list) this.buckets.set(k, (list = []));
        list.push(idx);
      }
    }
  }

  /** Every box whose cells meet the bounds, once each. Stops when `visit` returns true. */
  some(x0: number, y0: number, x1: number, y1: number, visit: (o: Obb) => boolean): boolean {
    const mark = ++this.mark;
    for (let col = Math.floor(x0); col <= Math.floor(x1); col++) {
      for (let row = Math.floor(y0); row <= Math.floor(y1); row++) {
        const list = this.buckets.get(cellKey(col, row));
        if (!list) continue;
        for (const idx of list) {
          if (this.marks[idx] === mark) continue;
          this.marks[idx] = mark;
          if (visit(this.items[idx])) return true;
        }
      }
    }
    return false;
  }

  /** True when `o` overlaps any stored box, both shrunk by `k` about their centres. */
  overlaps(o: Obb, k = 1): boolean {
    const a = shrinkObb(o, k);
    const [x0, y0, x1, y1] = obbBounds(o);
    return this.some(x0, y0, x1, y1, (other) => obbOverlap(a, shrinkObb(other, k)));
  }

  /** How many stored boxes have their centre inside the circle. */
  centresIn(cx: number, cy: number, r: number): number {
    let n = 0;
    const r2 = r * r;
    this.some(cx - r, cy - r, cx + r, cy + r, (o) => {
      const dx = o.cx - cx;
      const dy = o.cy - cy;
      if (dx * dx + dy * dy <= r2) n++;
      return false;
    });
    return n;
  }
}

/** Bucket key for a cell; cells are integers well inside ±2^20 on any real map. */
const cellKey = (col: number, row: number): number => (col + 0x100000) * 0x200000 + (row + 0x100000);

/** True when a box stands entirely on the layer's floor. */
export type FloorTest = (o: Obb) => boolean;

/**
 * What "on the floor" means for this layer. With rooms that have faces, the centre
 * and the four corners must all be in the same room (faces stop at walls and
 * thresholds, so nothing straddles one); with no rooms, all five must be inside
 * the merged floor (outer rings minus holes). A layer with neither has no floor
 * to test against: null.
 */
export function floorTest(layer: DungeonLayer): FloorTest | null {
  const rooms = layer.rooms ?? [];
  if (rooms.some((r) => roomFace(r).length >= 3)) {
    const index = roomIndexOf(layer.rooms);
    return (o) => {
      const room = index.roomAt(o.cx, o.cy);
      if (!room) return false;
      return obbCorners(o).every((p) => index.roomAt(p.x, p.y) === room);
    };
  }
  const rings = (layer.mergedFloor ?? []).filter((r) => r.length >= 3);
  if (rings.length === 0) return null;
  const inside = (x: number, y: number): boolean => {
    let hit = false;
    for (const ring of rings) if (pointInRing(x, y, ring)) hit = !hit;
    return hit;
  };
  return (o) => inside(o.cx, o.cy) && obbCorners(o).every((p) => inside(p.x, p.y));
}

/**
 * The props an erase brush at `center` with radius `r` removes: visible, placed
 * pack art (never an imported image or the cave band's rock), not locked, whose
 * oriented box meets the circle.
 */
export function eraseHits(layer: DungeonLayer, center: Point, r: number): string[] {
  const out: string[] = [];
  for (const c of layer.children) {
    if (c.childType !== 'asset' || !c.visible) continue;
    const a = c as AssetChild;
    if (a.objectType !== 'asset' || a.locked || isCaveBandAsset(a.assetId)) continue;
    if (obbMeetsCircle(obbOfChild(a), center.x, center.y, r)) out.push(a.id);
  }
  return out;
}
