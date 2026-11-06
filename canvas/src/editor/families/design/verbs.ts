// The action row of the Design cards: the selection verbs the floating bar runs, each shown
// only when it can act on what is picked (cardActions decides, as on the v2 card), and Node
// mode for one floor or one wall.

import { Copy, EyeOff, FlipHorizontal2, FlipVertical2, GitCommitHorizontal, Lock, LockOpen, RotateCw, Trash2 } from 'lucide-react';
import { resolveSelection } from '@dnd/core/src/store/selectionResolve';
import type { MapBuilderStore } from '@/store/types';
import { runSelectionVerb, type SelectionVerb } from '@/shortcuts/defaultShortcuts';
import { bindingOf } from '@/editor/registry/binding';
import type { EditorState, Verb } from '@/editor/registry/types';
import { editNodeMode } from '@/editor/registry/shared';
import { cardActions } from '@/v2/editor/cardModels';

function offers(state: EditorState, verb: SelectionVerb): boolean {
  const s = state as MapBuilderStore;
  return cardActions(resolveSelection(s, s.selection.selectedIds)).includes(verb);
}

// No keycap at the corner: the chords (Shift H, Ctrl D) do not fit a 26 button, as the frame draws it.
const selection = (id: SelectionVerb, label: string, icon: Verb['icon'], extra: Partial<Verb> = {}): Verb => ({
  id,
  label,
  icon,
  when: (s) => offers(s, id),
  run: () => runSelectionVerb(id),
  ...extra,
});

/** One floor or one wall picked: its points open for editing, as Enter does. */
export const nodeModeVerb: Verb = {
  id: 'nodeMode',
  label: 'Node mode',
  icon: GitCommitHorizontal,
  key: 'N',
  when: (state) => {
    const s = state as MapBuilderStore;
    if (s.selection.selectedIds.length !== 1) return false;
    const picked = resolveSelection(s, s.selection.selectedIds);
    return picked.walls.length === 1 || picked.children.some(({ child }) => child.childType === 'shape');
  },
  run: (store) => {
    const b = bindingOf(editNodeMode);
    b.write(store, !b.read(store.getState()));
  },
};

export const SELECTION_VERBS: readonly Verb[] = [
  selection('flipH', 'Flip horizontal', FlipHorizontal2),
  selection('flipV', 'Flip vertical', FlipVertical2, { bar: false }),
  selection('rotate', 'Rotate 90°', RotateCw),
  selection('duplicate', 'Duplicate', Copy),
  selection('lock', 'Lock', Lock),
  selection('unlock', 'Unlock', LockOpen),
  selection('hide', 'Hide', EyeOff, { bar: false }),
  selection('delete', 'Delete', Trash2, { danger: true }),
];

/** Node mode first, then the selection verbs. */
export const EDITABLE_VERBS: readonly Verb[] = [nodeModeVerb, ...SELECTION_VERBS];
