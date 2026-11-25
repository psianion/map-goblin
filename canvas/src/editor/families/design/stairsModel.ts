// The stair kits the installed packs ship, as the Door tool's Kit column and the stairs card show
// them, and the writes that change picked stairs.

import { useStore } from '@/store/store';
import type { MapBuilderStore, StairSpan } from '@/store/types';
import { UpdateChildCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import { stairsPick } from '@dnd/core/src/store/selectionResolve';
import { packStairKits, stairKitFor, STONE_STAIRS, type StairKit } from '@dnd/core/src/assets/stairKits';
import { resizeStairs } from '@dnd/core/src/shared/stairPlace';
import type { Swatch } from '@/editor/SwatchPicker';

/** The Kit value for the packs' default kit: a span that names none. */
export const DEFAULT_STAIRS = 'default';

/** A kit's picture: its one-cell, one-cell-run piece where it has one. */
const artOf = (kit: StairKit | null): string | undefined => (kit ? (kit.pieces.find((p) => p.wide === 1 && p.run === 1) ?? kit.pieces[0])?.entryId : undefined);

/**
 * The stair kit tiles: the default kit (the overlay), Stone (the stone kit of the cliff's colour,
 * `cliffArt`), then every other kit. None with no kit installed.
 */
export function stairKitSwatches(cliffArt: string | undefined): Swatch[] {
  const kits = packStairKits();
  if (kits.length === 0) return [];
  const fallback = stairKitFor(undefined, undefined);
  const stone = stairKitFor(STONE_STAIRS, cliffArt);
  return [
    { value: DEFAULT_STAIRS, label: fallback!.label, art: artOf(fallback) },
    ...(stone ? [{ value: STONE_STAIRS, label: 'Stone', title: `Stone in the cliff's colour (${stone.label})`, art: artOf(stone) }] : []),
    ...kits.filter((k) => k !== fallback).map((k) => ({ value: k.id, label: k.label, art: artOf(k) })),
  ];
}

/** The picked flight of stairs, if one is. */
export const pickedStairs = (s: Pick<MapBuilderStore, 'layers' | 'selection'>) => (s.selection.selectedIds.length === 1 ? stairsPick(s, s.selection.selectedIds[0]) : null);

/** Writes `change` to the stairs `ids` name, one undo step; a change that is null leaves them. */
export function editStairs(label: string, ids: readonly string[], change: (span: StairSpan, plateauEdgeArt: string | undefined) => StairSpan | null): void {
  const pick = ids.length === 1 ? stairsPick(useStore.getState(), ids[0]) : null;
  if (!pick) return;
  const next = change(pick.span, pick.plateau.edgeArt);
  if (!next) return;
  const stairs = (pick.plateau.stairs ?? []).map((s) => (s.id === pick.span.id ? next : s));
  undoManager.execute(new UpdateChildCommand(label, pick.layer.id, pick.plateau.id, { stairs: pick.plateau.stairs }, { stairs }));
}

/** A kit picked for stairs: the default clears it; Stone is taken as the stone kit of the cliff's colour. */
export function stairKitValue(value: string, cliffArt: string | undefined): string | undefined {
  if (value === DEFAULT_STAIRS) return undefined;
  return value === STONE_STAIRS ? stairKitFor(STONE_STAIRS, cliffArt)?.id : value;
}

/** The picked stairs' kit, or with none picked the kit the next stairs are laid with. */
export function pickStairKit(value: string): void {
  const s = useStore.getState() as MapBuilderStore;
  const pick = pickedStairs(s);
  if (!pick) {
    s.updateToolSettings({ stairKit: value === DEFAULT_STAIRS ? undefined : value });
    return;
  }
  editStairs('Stairs kit', s.selection.selectedIds, (span, art) => {
    const kit = stairKitValue(value, art);
    const next: StairSpan = { ...span };
    if (kit) next.kit = kit;
    else delete next.kit;
    return next;
  });
}

/** The picked stairs made `width` cells wide, where the edge and the stairs beside them allow. */
export function resizePickedStairs(ids: readonly string[], width: number): void {
  const pick = ids.length === 1 ? stairsPick(useStore.getState(), ids[0]) : null;
  if (!pick) return;
  editStairs('Stairs width', ids, (span) => resizeStairs(pick.plateau, span, width));
}

/** The picked stairs taken off their edge. */
export function deletePickedStairs(ids: readonly string[]): void {
  const pick = ids.length === 1 ? stairsPick(useStore.getState(), ids[0]) : null;
  if (!pick) return;
  const left = (pick.plateau.stairs ?? []).filter((s) => s.id !== pick.span.id);
  undoManager.execute(new UpdateChildCommand('Delete stairs', pick.layer.id, pick.plateau.id, { stairs: pick.plateau.stairs }, { stairs: left.length > 0 ? left : undefined }));
  useStore.getState().setSelectedIds([]);
}
