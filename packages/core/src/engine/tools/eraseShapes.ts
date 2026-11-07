// Carve out: boolean-subtract a set of polygons from every floor they touch.
//
// One implementation behind the floor tools' Carve out mode and Alt while drawing.
// Curved rings flatten before the boolean (Clipper2 only speaks polygons) and the result
// IS flattened geometry, so any tangents the shape carried are cleared with it rather
// than left pointing at vertices that no longer exist; the caller says so. A floor the
// carve splits becomes one floor per piece, each with a new id; a floor it covers is
// deleted. Walls, rooms and doors are not the floor's children and are left alone.

import type { Command, DungeonLayer, ShapeChild } from '../../store/types';
import { AddChildCommand, CompositeCommand, RemoveChildCommand, UpdateChildCommand } from '../../store/commands';
import { undoManager } from '../../store/undoManager';
import { clipper2Engine } from '../../geometry/Clipper2Engine';
import { flattenRing, ringHasCurves } from '../../shared/bezier';
import { applyShapeTransform } from '../../shared/plateaus';
import { notify } from '../../shared/notify';

type Polygon = [number, number][];

function signedArea(r: Polygon): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  return a / 2;
}

function inside([x, y]: [number, number], ring: Polygon): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/**
 * Clipper's output as floors: each outer ring with the holes inside it. Outer rings wind
 * like the largest ring; a hole goes to the smallest outer ring around it.
 */
export function floorPieces(rings: Polygon[]): Polygon[][] {
  const sorted = rings.filter((r) => r.length >= 3).sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
  if (sorted.length === 0) return [];
  const sign = Math.sign(signedArea(sorted[0]));
  const outers = sorted.filter((r) => Math.sign(signedArea(r)) === sign);
  const pieces = outers.map((o) => [o]);
  for (const hole of sorted.filter((r) => Math.sign(signedArea(r)) !== sign)) {
    let owner = 0;
    for (let i = outers.length - 1; i >= 0; i--) {
      if (inside(hole[0], outers[i])) {
        owner = i;
        break;
      }
    }
    pieces[owner].push(hole);
  }
  return pieces;
}

/** A shape's rings as the floor draws them: flattened, and with its transform baked in. */
function drawnRings(shape: ShapeChild): Polygon[] {
  return shape.contours.map((r, i) => {
    const flat = flattenRing(r, shape.tangents?.[i]);
    return shape.transform ? applyShapeTransform(flat, shape.transform) : flat;
  });
}

export interface Carve {
  commands: Command[];
  /** A carved floor had curved edges, now flat. */
  flattened: boolean;
}

/**
 * Commands that subtract `carvePolys` from every unlocked floor on `layer` they overlap.
 * Empty when nothing was touched; the caller wraps and executes.
 */
export function carveCommands(layer: DungeonLayer, layerId: string, carvePolys: Polygon[]): Carve {
  const commands: Command[] = [];
  let flattened = false;
  // Where the next floor sits once the commands before it have run: a delete takes one
  // place out of the order, a split adds the extra pieces.
  let shift = 0;
  layer.children.forEach((c, i) => {
    const index = i + shift;
    if (c.childType !== 'shape' || c.locked) return;
    const shape = c as ShapeChild;
    const [outer, ...holes] = drawnRings(shape);
    if (!outer || !carvePolys.some((poly) => clipper2Engine.intersection([outer], [poly]).length > 0)) return;
    const pieces = floorPieces(clipper2Engine.difference([outer], [...holes, ...carvePolys]));
    if (shape.tangents?.some((t) => ringHasCurves(t))) flattened = true;
    if (pieces.length === 0) {
      commands.push(new RemoveChildCommand('Carve out', layerId, shape.id));
      shift -= 1;
    } else if (pieces.length === 1) {
      commands.push(
        new UpdateChildCommand(
          'Carve out',
          layerId,
          shape.id,
          { contours: shape.contours, tangents: shape.tangents, transform: shape.transform } as Partial<ShapeChild>,
          { contours: pieces[0], tangents: undefined, transform: undefined } as Partial<ShapeChild>,
        ),
      );
    } else {
      // A split: the floor gives way to one floor per piece, each new, in its place in the order.
      commands.push(new RemoveChildCommand('Carve out', layerId, shape.id));
      pieces.forEach((contours, k) => {
        const piece: ShapeChild = { ...shape, id: crypto.randomUUID(), contours, tangents: undefined, transform: undefined };
        commands.push(new AddChildCommand('Carve out', layerId, piece, index + k));
      });
      shift += pieces.length - 1;
    }
  });
  return { commands, flattened };
}

/** Carve `carvePolys` out of the floors on `layer` as one undo step. Whether anything was carved. */
export function carveFloors(layer: DungeonLayer, layerId: string, carvePolys: Polygon[]): boolean {
  const { commands, flattened } = carveCommands(layer, layerId, carvePolys);
  if (commands.length === 0) return false;
  undoManager.execute(commands.length === 1 ? commands[0] : new CompositeCommand('Carve out', commands));
  if (flattened) notify.subtle('Curved edges were flattened to carve');
  return true;
}
