// The void rule in the editor: what ground is under a plateau ring on a layer. The layer's
// merged floor answers at once; painted terrain is read back off the GPU for the ring's box
// only when the floor alone does not carry the ring.

import type { Command, DungeonLayer, PlateauChild, ShapeChild } from '../store/types';
import type { Polygon } from '../types/geometry';
import { useStore } from '../store/store';
import { computeMergedFloor } from './mergedFloor';
import { getTerrainRenderer } from './terrain/TerrainRenderer';
import {
  GROUND_MESSAGE,
  groundShare,
  inRingsTest,
  PLATEAU_GROUND_SHARE,
  PLATEAU_MIN_AREA,
  ringArea,
  SMALL_MESSAGE,
  type GroundVerdict,
} from '../shared/plateauGround';
import { shapeRing } from '../shared/plateaus';
import { inFrame, isGroundPiece, pieceCovers } from '../shared/pieces';
import { baseGroundFrame, cutToFrame, toolFrame } from './mapFrame';
import { floorPieces } from '../shared/floorPieces';
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

/**
 * Whether `ring` may stand as a plateau on `layer`: over its floor or painted terrain, and a
 * cell at least. On a sized map only the part inside the frame is judged: a plateau may run
 * past the edge, where nothing of it is drawn.
 */
export async function plateauGround(layer: DungeonLayer, ring: Polygon): Promise<GroundVerdict> {
  const parts = toolFrame() ? floorPieces(cutToFrame([ring])).map(([outer]) => outer) : [ring];
  const area = parts.reduce((a, r) => a + ringArea(r), 0);
  if (area < PLATEAU_MIN_AREA) return 'small';
  // The share over ground of all the parts, each weighed by its area.
  const share = (onGround: (x: number, y: number) => boolean) => parts.reduce((a, r) => a + groundShare(r, onGround) * ringArea(r), 0) / area;
  const onFloor = inRingsTest(layer.mergedFloor ?? computeMergedFloor(layer) ?? []);
  // Ground pieces are ground to stand on, as a floor is, and so is the base ground,
  // everywhere inside the map's frame.
  const ground = layer.children.filter((c) => isGroundPiece(c) && !c.keptToFloors && c.visible !== false) as ShapeChild[];
  const base = baseGroundFrame(layer);
  const inFloor = (x: number, y: number): boolean =>
    onFloor(x, y) || (base !== null && inFrame(base, x, y)) || ground.some((p) => pieceCovers(p, x, y));
  if (share(inFloor) >= PLATEAU_GROUND_SHARE) return 'ok';
  const painted = await paintedUnder(ring);
  if (!painted) return 'void';
  return share((x, y) => inFloor(x, y) || painted(x, y)) >= PLATEAU_GROUND_SHARE ? 'ok' : 'void';
}
