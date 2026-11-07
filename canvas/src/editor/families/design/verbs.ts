// The action row of the Design cards: the Select family's verbs, each shown only when it can
// act on what is picked, without More (the Design cards keep no canvas menu button), and
// Node mode for one floor or one wall.

import { GitCommitHorizontal } from 'lucide-react';
import { resolveSelection } from '@dnd/core/src/store/selectionResolve';
import { applyOutlineEdit, resolveOutline } from '@dnd/core/src/engine/shapeNodeEdit';
import type { MapBuilderStore } from '@/store/types';
import { bindingOf } from '@/editor/registry/binding';
import type { Verb } from '@/editor/registry/types';
import { editNodeMode } from '@/editor/registry/shared';
import { moreVerb, SELECTION_VERBS as SELECT_VERBS } from '@/editor/families/select/verbs';

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
  active: (state) => bindingOf(editNodeMode).read(state) === true,
  run: (store) => {
    const b = bindingOf(editNodeMode);
    b.write(store, !b.read(store.getState()));
  },
};

/** How many nodes the open floor outline has, or null when none is open. */
export function openOutlineNodes(state: { tools: { shapeNodeEditId: string | null } }): number | null {
  const id = state.tools.shapeNodeEditId;
  return id ? (resolveOutline(id)?.outline.length ?? null) : null;
}

export const SELECTION_VERBS: readonly Verb[] = SELECT_VERBS.filter((v) => v !== moreVerb);

/** Node mode first, then the selection verbs. */
export const EDITABLE_VERBS: readonly Verb[] = [nodeModeVerb, ...SELECTION_VERBS];

/**
 * The floor card's verbs: Delete removes the picked node while the outline is open, and is
 * disabled with no node picked or at three nodes, the fewest a floor keeps.
 */
export const FLOOR_VERBS: readonly Verb[] = EDITABLE_VERBS.map((v) =>
  v.id !== 'delete'
    ? v
    : {
        ...v,
        disabled: (state) => {
          const nodes = openOutlineNodes(state);
          return nodes !== null && (state.tools.selectedVertex === null || nodes <= 3);
        },
        run: (store) => {
          const { tools } = store.getState();
          if (!tools.shapeNodeEditId) return v.run(store);
          const nodes = openOutlineNodes(store.getState());
          if (tools.selectedVertex === null || nodes === null || nodes <= 3) return;
          applyOutlineEdit({ kind: 'delete', index: tools.selectedVertex }, 'Delete vertex');
          store.getState().selectVertex(null);
        },
      },
);
