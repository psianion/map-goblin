// Boolean-erase a set of polygons out of every shape they touch.
//
// One implementation behind all four drawing tools' erase modes. Curved rings
// flatten before the boolean — Clipper2 only speaks polygons — and the result
// IS flattened geometry, so any tangents the shape carried are cleared with
// it rather than left pointing at vertices that no longer exist.

import type { Command, DungeonLayer, ShapeChild } from '../../store/types';
import { RemoveChildCommand, UpdateChildCommand } from '../../store/commands';
import { clipper2Engine } from '../../geometry/Clipper2Engine';
import { flattenRing } from '../../shared/bezier';

type Polygon = [number, number][];

/**
 * Commands that subtract `erasePolys` from every shape on `layer` they
 * overlap. Empty when nothing was touched; the caller wraps and executes.
 */
export function eraseShapeCommands(
  layer: DungeonLayer,
  layerId: string,
  erasePolys: Polygon[],
): Command[] {
  const commands: Command[] = [];
  for (const c of layer.children) {
    if (c.childType !== 'shape') continue;
    const shape = c as ShapeChild;
    const outerRing = flattenRing(shape.contours[0], shape.tangents?.[0]);
    let overlaps = false;
    for (const poly of erasePolys) {
      if (clipper2Engine.intersection([outerRing], [poly]).length > 0) {
        overlaps = true;
        break;
      }
    }
    if (!overlaps) continue;
    const existingHoles = shape.contours
      .slice(1)
      .map((r, k) => flattenRing(r, shape.tangents?.[k + 1]));
    const remaining = clipper2Engine.difference([outerRing], [...existingHoles, ...erasePolys]);
    if (remaining.length === 0) {
      commands.push(new RemoveChildCommand('Erase', layerId, shape.id));
    } else {
      commands.push(
        new UpdateChildCommand(
          'Erase',
          layerId,
          shape.id,
          { contours: shape.contours, tangents: shape.tangents } as Partial<ShapeChild>,
          { contours: remaining, tangents: undefined } as Partial<ShapeChild>,
        ),
      );
    }
  }
  return commands;
}
