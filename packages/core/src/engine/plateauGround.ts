// The void rule in the editor: what ground is under a plateau ring on a layer. The layer's
// merged floor answers at once; painted terrain is read back off the GPU for the ring's box
// only when the floor alone does not carry the ring.

import type { Command, DungeonLayer, PlateauChild } from '../store/types';
import type { Polygon } from '../types/geometry';
import { useStore } from '../store/store';
import { computeMergedFloor } from './mergedFloor';
import { getTerrainRenderer } from './terrain/TerrainRenderer';
import {
  GROUND_MESSAGE,
  groundShare,
  groundVerdict,
  inRingsTest,
  PLATEAU_GROUND_SHARE,
  PLATEAU_MIN_AREA,
  ringArea,
  SMALL_MESSAGE,
  type GroundVerdict,
} from '../shared/plateauGround';
import { shapeRing } from '../shared/plateaus';
import { notify } from '../shared/notify';
import { undoManager } from '../store/undoManager';

function boxOf(ring: Polygon): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

/** The painted-terrain test over `ring`'s box, or null when nothing painted reaches it. */
async function paintedUnder(ring: Polygon): Promise<((x: number, y: number) => boolean) | null> {
  const terrain = useStore.getState().mapSettings.terrain;
  const painted = terrain?.bounds;
  if (!painted || terrain.visible === false) return null;
  const b = boxOf(ring);
  if (b.maxX < painted.minX || b.minX > painted.maxX || b.maxY < painted.minY || b.minY > painted.maxY) return null;
  return (await getTerrainRenderer()?.paintedSampler(b)) ?? null;
}

/**
 * After a move or transform landed as `cmd`: every plateau among `ids` must still stand on
 * ground, or the step is taken back with the toast. Resolves to whether it stood.
 */
export async function keepPlateausOnGround(cmd: Command, ids: readonly string[]): Promise<boolean> {
  const moved: { layer: DungeonLayer; plateau: PlateauChild }[] = [];
  for (const l of useStore.getState().layers) {
    if (l.type !== 'dungeon') continue;
    for (const c of l.children) if (c.childType === 'plateau' && ids.includes(c.id)) moved.push({ layer: l, plateau: c });
  }
  if (moved.length === 0) return true;
  for (const { layer, plateau } of moved) {
    const verdict = await plateauGround(layer, shapeRing(plateau, 0));
    if (verdict === 'ok') continue;
    undoManager.retract(cmd);
    notify.warning(verdict === 'small' ? SMALL_MESSAGE : GROUND_MESSAGE);
    return false;
  }
  return true;
}

/** Whether `ring` may stand as a plateau on `layer`: over its floor or painted terrain, and a cell at least. */
export async function plateauGround(layer: DungeonLayer, ring: Polygon): Promise<GroundVerdict> {
  if (ringArea(ring) < PLATEAU_MIN_AREA) return 'small';
  const inFloor = inRingsTest(layer.mergedFloor ?? computeMergedFloor(layer) ?? []);
  if (groundShare(ring, inFloor) >= PLATEAU_GROUND_SHARE) return 'ok';
  const painted = await paintedUnder(ring);
  if (!painted) return 'void';
  return groundVerdict(ring, (x, y) => inFloor(x, y) || painted(x, y));
}
