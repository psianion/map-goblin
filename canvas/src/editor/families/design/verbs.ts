// The action row of the Design cards: the Select family's verbs, each shown only when it can
// act on what is picked, without More (the Design cards keep no canvas menu button), and
// Node mode for one floor or one wall.

import { GitCommitHorizontal } from 'lucide-react';
import { resolveSelection } from '@dnd/core/src/store/selectionResolve';
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
  run: (store) => {
    const b = bindingOf(editNodeMode);
    b.write(store, !b.read(store.getState()));
  },
};

export const SELECTION_VERBS: readonly Verb[] = SELECT_VERBS.filter((v) => v !== moreVerb);

/** Node mode first, then the selection verbs. */
export const EDITABLE_VERBS: readonly Verb[] = [nodeModeVerb, ...SELECTION_VERBS];
