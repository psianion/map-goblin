// The cave mouths a kit ships, as the Door tool's Kit column (Opening style) and the cave mouth and
// door cards show them, and the writes that change a picked mouth: one in a plateau's cliff, or an
// Opening on a wall whose rock has mouth pieces.

import { useStore } from '@/store/store';
import type { CliffEntrance, DoorChild, DungeonLayer, MapBuilderStore, PlateauChild } from '@/store/types';
import { UpdateChildCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import { entrancePick } from '@dnd/core/src/store/selectionResolve';
import { resizeEntrance } from '@dnd/core/src/shared/stairPlace';
import { cliffArt } from '@dnd/core/src/engine/plateauKit';
import { entranceVariants, entranceWidths, withMouth } from '@dnd/core/src/engine/plateauRenderer';
import { entranceWidth, withEntrance } from '@dnd/core/src/engine/tools/DoorTool';
import { nearestMouthWidth, wallMouthWidths } from '@dnd/core/src/assets/caveWallKit';
import { doorwayEditCommand } from '@dnd/core/src/store/doorwayCommands';
import { doorHost } from './doorModel';
import type { Swatch } from '@/editor/SwatchPicker';

/** What the dock reads a mouth from. */
type DockState = Pick<MapBuilderStore, 'layers' | 'selection' | 'tools'>;

/** The picked cave mouth, if one is. */
export const pickedEntrance = (s: Pick<MapBuilderStore, 'layers' | 'selection'>) => (s.selection.selectedIds.length === 1 ? entrancePick(s, s.selection.selectedIds[0]) : null);

/** The picked Opening on a wall whose rock has mouth pieces, with that rock's set, if one is. */
export function pickedMouthDoor(s: DockState): { door: DoorChild; layer: DungeonLayer; setId: string } | null {
  if (s.selection.selectedIds.length !== 1) return null;
  // A door's host is read from the layers alone.
  const host = doorHost(s as MapBuilderStore, s.selection.selectedIds[0]);
  if (!host?.door.bare || wallMouthWidths(host.wallSetId).length === 0) return null;
  return { door: host.door, layer: host.layer, setId: host.wallSetId! };
}

/** The tiles of a kit's mouths `width` cells wide (a cliff's art, or a wall's set), each by its place among them: its picture, plain inside. */
export function entranceSwatches(edgeArt: string | undefined, width: number): Swatch[] {
  const art = cliffArt(edgeArt);
  return entranceVariants(edgeArt, width).map((p, k) => ({ value: String(k), label: `Mouth ${k + 1}`, art: art.get(p.key)?.id }));
}

/** Whether the Door tool's style is Opening. */
const openingStyle = (s: Pick<MapBuilderStore, 'tools'>): boolean => s.tools.settings.doorBare === true && s.tools.settings.doorStyle === 'archway' && !s.tools.settings.doorStairs;

/**
 * The mouth the dock speaks for: the picked one (a cliff's mouth, or an Opening on a wall with mouth
 * pieces), else the next one, on the edge the Opening style last hovered whose rock lays mouth pieces,
 * at the width it would be made. Null where no mouth piece will be laid.
 */
export function dockMouth(s: DockState): { kit: string; width: number } | null {
  const pick = pickedEntrance(s);
  if (pick) return pick.plateau.edgeArt ? { kit: pick.plateau.edgeArt, width: Math.round(pick.span.to - pick.span.from) } : null;
  const door = pickedMouthDoor(s);
  if (door) return { kit: door.setId, width: door.door.width };
  const kit = openingStyle(s) ? s.selection.hoverMouthKit : undefined;
  if (!kit) return null;
  return { kit, width: nearestMouthWidth(entranceWidths(kit), s.tools.settings.doorWidth || 1) };
}

/** The Kit tiles: the picked mouth's kit at its width, else the next mouth's, on the edge last hovered. None where no mouth piece is laid. */
export function entranceKitSwatches(s: DockState): Swatch[] {
  const pick = pickedEntrance(s);
  if (pick) return entranceSwatches(pick.plateau.edgeArt, pick.span.to - pick.span.from);
  const mouth = dockMouth(s);
  return mouth ? entranceSwatches(mouth.kit, mouth.width) : [];
}

/** Which tile is on: the picked mouth's piece, else the next mouth's. */
export function entranceKitValue(s: DockState): string {
  const pick = pickedEntrance(s);
  if (pick) {
    const k = entranceVariants(pick.plateau.edgeArt, pick.span.to - pick.span.from).findIndex((p) => p.key === pick.span.piece);
    return String(Math.max(0, k));
  }
  const door = pickedMouthDoor(s);
  if (door) return String(Math.max(0, entranceVariants(door.setId, door.door.width).findIndex((p) => p.key === door.door.piece)));
  return String(s.tools.settings.entranceVariant ?? 0);
}

/** Writes `change` to the picked mouth, its hollow worked out again, one undo step; a change that is null leaves it. */
function editEntrance(label: string, ids: readonly string[], change: (span: CliffEntrance, plateau: PlateauChild) => CliffEntrance | null): void {
  const pick = ids.length === 1 ? entrancePick(useStore.getState(), ids[0]) : null;
  if (!pick) return;
  const next = change(pick.span, pick.plateau);
  if (!next) return;
  const span = withMouth(pick.layer, pick.plateau, next);
  undoManager.execute(new UpdateChildCommand(label, pick.layer.id, pick.plateau.id, { entrances: pick.plateau.entrances }, { entrances: withEntrance(pick.plateau, span) }));
}

/** A tile picked: the picked mouth's piece (a cliff's, or an Opening's), or with none picked the piece the next mouths take. */
export function pickEntranceKit(value: string): void {
  const s = useStore.getState() as MapBuilderStore;
  const k = Math.max(0, Number(value) || 0);
  const door = pickedMouthDoor(s);
  if (door) {
    const piece = entranceVariants(door.setId, door.door.width)[k];
    if (piece && piece.key !== door.door.piece) undoManager.execute(new UpdateChildCommand('Cave mouth kit', door.layer.id, door.door.id, { piece: door.door.piece }, { piece: piece.key }));
    return;
  }
  if (!pickedEntrance(s)) {
    s.updateToolSettings({ entranceVariant: k > 0 ? k : undefined });
    return;
  }
  editEntrance('Cave mouth kit', s.selection.selectedIds, (span, plateau) => {
    const piece = entranceVariants(plateau.edgeArt, span.to - span.from)[k];
    return piece ? { ...span, piece: piece.key } : null;
  });
}

/**
 * The picked Opening on a wall with mouth pieces made the width of the rock's nearest `width` cells, one
 * undo step, as the door card's Width writes a door's; its piece kept where the kit has it that wide.
 * False when no such Opening is picked.
 */
export function resizePickedMouthDoor(ids: readonly string[], width: number): boolean {
  const s = useStore.getState() as MapBuilderStore;
  const door = ids.length === 1 ? pickedMouthDoor(s) : null;
  if (!door || door.door.id !== ids[0]) return false;
  const w = nearestMouthWidth(wallMouthWidths(door.setId), width);
  if (w === door.door.width) return true;
  const keeps = entranceVariants(door.setId, w).some((p) => p.key === door.door.piece);
  const cmd = doorwayEditCommand('Door width', door.layer, door.door.id, keeps ? {} : { piece: door.door.piece }, keeps ? {} : { piece: undefined }, { width: w });
  if (cmd) undoManager.execute(cmd);
  return true;
}

/** The picked mouth made the kit's width nearest `width` cells, where the edge and its neighbours allow; its piece kept where the kit has it that wide. */
export function resizePickedEntrance(ids: readonly string[], width: number): void {
  editEntrance('Cave mouth width', ids, (span, plateau) => {
    const w = entranceWidth(plateau, width);
    if (w === Math.round(span.to - span.from)) return null;
    const next = resizeEntrance(plateau, span, w);
    if (!next || Math.round(next.to - next.from) !== w) return null;
    const keeps = entranceVariants(plateau.edgeArt, w).some((p) => p.key === span.piece);
    if (!keeps) delete next.piece;
    return next;
  });
}

/** The picked mouth taken out of its cliff, closing it again. */
export function deletePickedEntrance(ids: readonly string[]): void {
  const pick = ids.length === 1 ? entrancePick(useStore.getState(), ids[0]) : null;
  if (!pick) return;
  undoManager.execute(new UpdateChildCommand('Delete cave mouth', pick.layer.id, pick.plateau.id, { entrances: pick.plateau.entrances }, { entrances: withEntrance(pick.plateau, null, pick.span.id) }));
  useStore.getState().setSelectedIds([]);
}
