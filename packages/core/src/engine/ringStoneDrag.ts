// Dragging stones on a floor-derived wall.
//
// The gesture looks like a wall-node drag and is picked like one, but it is not
// stored as one: a ring's stones stand on the floor outline, so moving them is
// a move of the floor. The drag is planned once on press (`planRingDrag`) and
// then driven through the outline editor, which already knows how to preview a
// contour change live, collapse the shapes that formed it, and land the whole
// gesture as a single undo entry.
//
// Nothing is written to `floorWallEdits` here. Rotation, resize, piece choice
// and removal still live there, keyed by `t`, and survive the relay this drag
// causes — which is the whole reason they are keyed that way.

import { useStore } from '../store/store';
import type { DungeonLayer } from '../store/types';
import { planRingDrag, type DraggedStone } from './ringDragPlan';
import {
  beginGroupOutlineDrag,
  updateOutlineDrag,
  endOutlineDrag,
  cancelOutlineDrag,
  resolveRingOutline,
  editedRing,
} from './shapeNodeEdit';
import { currentWallNodes } from './wallNodeOverlay';
import { buildPieceSpecs } from './wallNodeRenderer';
import { pieceWorldLength } from './wallLayout';
import type { WallCategory } from '../assets/textureManifest';

let dragging = false;
let dx = 0;
let dy = 0;

export function isDraggingRingStone(): boolean {
  return dragging;
}

/**
 * Start a stone drag on ring `ring` of `layer`, for the stones at `ts`.
 * Returns false when the ring has no editable floor behind it, in which case
 * the caller should treat the press as picking nothing.
 */
export function beginRingStoneDrag(layer: DungeonLayer, ring: number, ts: number[]): boolean {
  const target = resolveRingOutline(layer, ring);
  if (!target) return false;

  const setId = layer.style.wallTextureSetId as WallCategory | undefined;
  if (!setId) return false;
  const specs = new Map(buildPieceSpecs(setId).map((s) => [s.id, s]));
  const wallWidth = layer.style.wallWidth;

  const stones: DraggedStone[] = [];
  for (const node of currentWallNodes()) {
    if (!ts.some((t) => Math.abs(t - node.t) < 1e-9)) continue;
    const spec = specs.get(node.pieceId);
    if (!spec) continue;
    stones.push({
      x: node.x,
      y: node.y,
      halfLength: (pieceWorldLength(spec, wallWidth) * node.scale * node.sizeScale) / 2,
    });
  }

  const plan = planRingDrag(editedRing(target), stones);
  if (!plan) return false;
  if (!beginGroupOutlineDrag(target, plan.outline, plan.indices, ring)) return false;

  dragging = true;
  dx = 0;
  dy = 0;
  return true;
}

/** Live preview. Takes the frame's own delta; the total is accumulated here. */
export function updateRingStoneDrag(stepX: number, stepY: number): void {
  if (!dragging) return;
  dx += stepX;
  dy += stepY;
  updateOutlineDrag({ x: 0, y: 0 }, { x: dx, y: dy });
}

export function endRingStoneDrag(): void {
  if (!dragging) return;
  dragging = false;
  endOutlineDrag();
  reselect();
}

export function cancelRingStoneDrag(): void {
  if (!dragging) return;
  dragging = false;
  cancelOutlineDrag();
}

/**
 * Put the selection back on the stones the relay produced.
 *
 * The ring is longer or shorter than it was, so every `t` has shifted and the
 * stored selection points between stones. Snapping each to its nearest neighbour
 * keeps the keys acting on something after the drag.
 */
function reselect(): void {
  const state = useStore.getState();
  const wanted = state.tools.selectedNodeTs;
  if (wanted.length === 0) return;
  const nodes = currentWallNodes();
  if (nodes.length === 0) return;
  const near = (t: number): number =>
    nodes.reduce((best, n) => (Math.abs(n.t - t) < Math.abs(best - t) ? n.t : best), nodes[0].t);
  const settled = [...new Set(wanted.map(near))];
  state.selectNode(settled[0]);
  for (const t of settled.slice(1)) state.toggleNodeSelection(t);
}
