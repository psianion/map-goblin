// What a newly drawn floor takes from the Floor panel's defaults: its opacity, and an edge
// band when one was picked there (unset, the floor follows its layer's band), the dock's
// height when it is not 0, and its walls. Walls are chosen, never automatic: with Walls on
// None (the default) the floor is a ground piece, with no wall, no room and no part in the
// floor union; with a wall set picked it is a walled floor with that set pinned on it.

import type { Command, ShapeChild } from '../../store/types';
import { useStore } from '../../store/store';
import { AddChildCommand, CompositeCommand } from '../../store/commands';
import { undoManager } from '../../store/undoManager';
import { defaultSoftOf } from '../../assets/materialKit';
import { floorPieces } from '../../shared/floorPieces';
import { pieceRings } from '../../shared/pieces';
import { cutToFrame } from '../mapFrame';

type FloorLook = Pick<ShapeChild, 'opacity' | 'edgeBand' | 'height' | 'ground' | 'soft' | 'styleOverrides'>;

/** `textureId` is the floor's own: a ground piece of an outdoor texture takes that texture's soft edge. */
export function newFloorLook(textureId?: string): FloorLook {
  const s = useStore.getState().tools.settings;
  const out: FloorLook = {};
  if (s.floorOpacity !== undefined && s.floorOpacity < 1) out.opacity = s.floorOpacity;
  if (s.floorHeight) out.height = s.floorHeight;
  if (s.floorWalls) {
    // Walled, the set pinned on the floor's own outline. An edge band is a wall's dressing.
    out.styleOverrides = { wallTextureSetId: s.floorWalls };
    if (s.floorEdgeBand !== undefined) out.edgeBand = s.floorEdgeBand;
  } else {
    out.ground = true;
    const soft = defaultSoftOf(textureId);
    if (soft) out.soft = soft;
  }
  return out;
}

/**
 * A drawn floor as it lands on a sized map: itself when it lies on the map (or the map
 * grows), else the parts of it inside the frame, one floor per part, its curves flattened
 * by the cut. None when it was drawn wholly off the map.
 */
export function floorsOnMap(child: ShapeChild): ShapeChild[] {
  const rings = pieceRings(child);
  const cut = cutToFrame(rings);
  if (cut === rings) return [child];
  return floorPieces(cut).map((contours, i) => ({
    ...child,
    id: i === 0 ? child.id : crypto.randomUUID(),
    contours,
    tangents: undefined,
    transform: undefined,
  }));
}

/** Adds a floor a tool drew, with the Floor panel's defaults, cut to a sized map's frame: one undo step. */
export function commitNewFloor(label: string, layerId: string, child: ShapeChild): void {
  const look = newFloorLook(child.textureId);
  const commands: Command[] = floorsOnMap(child).map((piece) => new AddChildCommand(label, layerId, { ...piece, ...look }));
  if (commands.length === 0) return;
  undoManager.execute(commands.length === 1 ? commands[0] : new CompositeCommand(label, commands));
}
