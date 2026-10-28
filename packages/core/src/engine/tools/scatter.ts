// Scatter painting, without Pixi or the store: a stroke is a context built once on
// pointerdown, and each dab of the brush asks it for the props that land there.

import type { Point } from '../../types/geometry';
import type { AssetChild, DungeonLayer, ScatterBrushSettings } from '../../store/types';
import { poissonDiskSample } from '../../geometry/poissonDisk';
import { mulberry32, hashPosition } from '../../geometry/seededRng';
import { familyMembers } from '../../assets/packCatalog';
import { floorTest, naturalSizeOf, obbOfChild, ObbHash, type FloorTest, type Obb } from './propPlacement';

/** Most props one dab may place. */
export const MAX_DAB = 60;

/** Overlap is judged on boxes shrunk to this: prop art has transparent margins. */
export const OVERLAP_SHRINK = 0.8;

/** One prop a dab accepted. `scale` is the multiplier the size was rolled with. */
export interface Placement {
  assetId: string;
  position: Point;
  rotation: number;
  scale: number;
  width: number;
  height: number;
  tint: string;
}

/** What a stroke has done so far, for the status bar. */
export interface StrokeStats {
  placed: number;
  skippedOverlap: number;
  skippedFloor: number;
  /** Stay on floors is on but the layer has no rooms and no floor: the test is off. */
  noFloor: boolean;
}

export interface ScatterCtx {
  layer: DungeonLayer;
  settings: ScatterBrushSettings;
  strokeNo: number;
  sizeOf(id: string): { w: number; h: number } | null;
  /** Ids of the asset's family, the asset itself included. */
  familyOf(id: string): string[];
  /** Every visible prop on the layer plus everything this stroke placed. */
  hash: ObbHash;
  floor: FloorTest | null;
  stats: StrokeStats;
}

/** Start a stroke on `layer`. `strokeNo` keeps two strokes from the same seed apart. */
export function beginStroke(layer: DungeonLayer, settings: ScatterBrushSettings, strokeNo: number): ScatterCtx {
  const hash = new ObbHash();
  for (const c of layer.children) {
    if (c.childType === 'asset' && c.visible) hash.insert(obbOfChild(c as AssetChild));
  }
  const floor = floorTest(layer);
  return {
    layer,
    settings,
    strokeNo,
    sizeOf: naturalSizeOf,
    familyOf: (id) => {
      const members = familyMembers(id).map((e) => e.id);
      return members.length > 0 ? members : [id];
    },
    hash,
    floor,
    stats: { placed: 0, skippedOverlap: 0, skippedFloor: 0, noFloor: settings.stayOnFloor && floor === null },
  };
}

/**
 * How many props a brush of radius `r` at `center` still wants: the density's
 * share of the circle, less the props whose centres are already in it, never
 * below 0 or above MAX_DAB.
 */
export function dabTarget(hash: ObbHash, density: number, center: Point, r: number): number {
  const want = Math.round(density * Math.PI * r * r) - hash.centresIn(center.x, center.y, r);
  return Math.max(0, Math.min(MAX_DAB, want));
}

/**
 * One dab of the brush. Returns the props it accepted and adds them to the
 * stroke's boxes, so later dabs see them. The same seed, stroke and dab number
 * always give the same props.
 */
export function scatterDab(ctx: ScatterCtx, center: Point, dabNo: number): Placement[] {
  const s = ctx.settings;
  const pool = s.assetIds;
  const r = s.brushRadius;
  const target = dabTarget(ctx.hash, s.density, center, r);
  if (target === 0 || pool.length === 0) return [];

  const rng = mulberry32(hashPosition(hashPosition(s.seed, ctx.strokeNo), dabNo));
  const candidates = poissonDiskSample(center, r, s.minSpacing, target * 3, rng);
  const out: Placement[] = [];
  const testFloor = s.stayOnFloor ? ctx.floor : null;

  for (const at of candidates) {
    if (out.length >= target) break;
    // Every roll happens whether or not the candidate lands, so one rejection
    // never shifts the rolls of the candidates after it.
    let assetId = pool[Math.floor(rng() * pool.length)];
    const variantRoll = rng();
    if (s.randomVariant) {
      const family = ctx.familyOf(assetId);
      assetId = family[Math.floor(variantRoll * family.length)];
    }
    const rotation = s.rotationRange[0] + rng() * (s.rotationRange[1] - s.rotationRange[0]);
    const scale = s.scaleRange[0] + rng() * (s.scaleRange[1] - s.scaleRange[0]);
    const tintRoll = rng();
    const tint = s.tints.length > 0 ? s.tints[Math.floor(tintRoll * s.tints.length)] : '#ffffff';

    const size = ctx.sizeOf(assetId);
    if (!size) continue;
    const width = size.w * scale;
    const height = size.h * scale;
    const obb: Obb = { cx: at.x, cy: at.y, hw: width / 2, hh: height / 2, rot: rotation };

    if (testFloor && !testFloor(obb)) {
      ctx.stats.skippedFloor++;
      continue;
    }
    if (s.avoidOverlap && ctx.hash.overlaps(obb, OVERLAP_SHRINK)) {
      ctx.stats.skippedOverlap++;
      continue;
    }
    ctx.hash.insert(obb);
    ctx.stats.placed++;
    out.push({ assetId, position: { x: at.x, y: at.y }, rotation, scale, width, height, tint });
  }
  return out;
}
