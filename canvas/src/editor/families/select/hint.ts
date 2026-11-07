// The Select tool's status line: with nothing picked, that, and what a box will grab when
// Pick only is on; with a pick, what it is and the keys that act on it.

import { resolveSelection, selectionTitle } from '@dnd/core/src/store/selectionResolve';
import type { MapBuilderStore } from '@/store/types';
import type { EditorState, HintLine } from '@/editor/registry/types';
import { PICK_CHIPS, pickOnlyBinding } from './pickOnly';
import { mergePlan } from './merge';

const t = (text: string) => ({ text });
const k = (text: string) => ({ text, key: true });

export function selectHint(state: EditorState): HintLine {
  const s = state as MapBuilderStore;
  const ids = s.selection.selectedIds;
  if (ids.length === 0) {
    const chips = pickOnlyBinding.read(state);
    const names = PICK_CHIPS.filter((c) => chips.includes(c.id)).map((c) => c.label.toLowerCase());
    return { label: 'Select', segments: [t('Nothing picked'), ...(names.length ? [t(`· a box picks ${names.join(', ')}`)] : [])] };
  }
  const sel = resolveSelection(s, ids);
  const title = selectionTitle(sel.kinds) || 'Selection';
  const members = sel.children.length + sel.walls.length;
  if (members > 0 && sel.locked.length === members && sel.rooms.length === 0) {
    return { label: title, segments: [t(`${title} · locked, Unlock in the card`)] };
  }
  const editable = ids.length === 1 && (sel.walls.length === 1 || sel.children[0]?.child.childType === 'shape');
  // Two walls: whether Merge can join them, and why not when it cannot.
  const merge = mergePlan(state);
  const pair = merge ? [t(`${'refusal' in merge ? merge.refusal : 'touching at one point'} ·`)] : [];
  return {
    label: title,
    segments: [t(`${title} ·`), ...pair, ...(editable ? [k('N'), t('nodes ·')] : []), k('Del'), t('delete')],
  };
}
