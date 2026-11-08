import { useStore } from '@/store/store';
import { resolveSelection, type SelectionKind } from '@dnd/core/src/store/selectionResolve';

/** Narrows the pick to its members of one kind. */
export function selectOnly(kind: SelectionKind): void {
  const s = useStore.getState();
  const sel = resolveSelection(s, s.selection.selectedIds);
  const ids =
    kind === 'wall'
      ? sel.walls.map((w) => w.wall.id)
      : kind === 'room'
        ? sel.rooms.map((r) => r.room.id)
        : sel.children.filter((c) => c.child.childType === kind).map((c) => c.child.id);
  s.setSelectedIds(ids);
}
