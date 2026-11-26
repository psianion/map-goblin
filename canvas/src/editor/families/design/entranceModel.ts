// The cave mouths a cliff kit ships, as the Door tool's Kit column (Opening style) and the cave
// mouth card show them, and the writes that change a picked mouth.

import { useStore } from '@/store/store';
import type { CliffEntrance, DungeonLayer, MapBuilderStore, PlateauChild } from '@/store/types';
import { UpdateChildCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import { entrancePick } from '@dnd/core/src/store/selectionResolve';
import { resizeEntrance } from '@dnd/core/src/shared/stairPlace';
import { cliffArt } from '@dnd/core/src/engine/plateauKit';
import { entranceVariants, entranceWidths, withMouth } from '@dnd/core/src/engine/plateauRenderer';
import { entranceWidth, withEntrance } from '@dnd/core/src/engine/tools/DoorTool';
import type { Swatch } from '@/editor/SwatchPicker';

/** The picked cave mouth, if one is. */
export const pickedEntrance = (s: Pick<MapBuilderStore, 'layers' | 'selection'>) => (s.selection.selectedIds.length === 1 ? entrancePick(s, s.selection.selectedIds[0]) : null);

/** The tiles of a cliff kit's mouths `width` cells wide, each by its place among them: its picture, plain inside. */
export function entranceSwatches(edgeArt: string | undefined, width: number): Swatch[] {
  const art = cliffArt(edgeArt);
  return entranceVariants(edgeArt, width).map((p, k) => ({ value: String(k), label: `Mouth ${k + 1}`, art: art.get(p.key)?.id }));
}

/** The first cliff on the active layer whose kit has cave mouths: what the Kit column shows with none picked. */
function activeCliff(s: Pick<MapBuilderStore, 'layers' | 'ui'>): PlateauChild | null {
  const layer = s.layers.find((l): l is DungeonLayer => l.id === s.ui.activeLayerId && l.type === 'dungeon');
  return layer?.children.find((c): c is PlateauChild => c.childType === 'plateau' && c.edge === 'cliff' && entranceWidths(c.edgeArt).length > 0) ?? null;
}

/** The Kit tiles: the picked mouth's kit at its width, else the next mouth's on the active layer's cliff at the dock's width. */
export function entranceKitSwatches(s: Pick<MapBuilderStore, 'layers' | 'ui' | 'selection' | 'tools'>): Swatch[] {
  const pick = pickedEntrance(s);
  if (pick) return entranceSwatches(pick.plateau.edgeArt, pick.span.to - pick.span.from);
  const cliff = activeCliff(s);
  return cliff ? entranceSwatches(cliff.edgeArt, entranceWidth(cliff, s.tools.settings.doorWidth || 1)) : [];
}

/** Which tile is on: the picked mouth's piece, else the next mouth's. */
export function entranceKitValue(s: Pick<MapBuilderStore, 'layers' | 'selection' | 'tools'>): string {
  const pick = pickedEntrance(s);
  if (!pick) return String(s.tools.settings.entranceVariant ?? 0);
  const k = entranceVariants(pick.plateau.edgeArt, pick.span.to - pick.span.from).findIndex((p) => p.key === pick.span.piece);
  return String(Math.max(0, k));
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

/** A tile picked: the picked mouth's piece, or with none picked the piece the next mouths take. */
export function pickEntranceKit(value: string): void {
  const s = useStore.getState() as MapBuilderStore;
  const k = Math.max(0, Number(value) || 0);
  if (!pickedEntrance(s)) {
    s.updateToolSettings({ entranceVariant: k > 0 ? k : undefined });
    return;
  }
  editEntrance('Cave mouth kit', s.selection.selectedIds, (span, plateau) => {
    const piece = entranceVariants(plateau.edgeArt, span.to - span.from)[k];
    return piece ? { ...span, piece: piece.key } : null;
  });
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
