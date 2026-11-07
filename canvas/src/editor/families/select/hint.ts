// The Select tool's status line: with nothing picked, that, and what a box will grab when
// Pick only is on; with a pick, what it is and the keys that act on it.

import { resolveSelection, selectionTitle } from '@dnd/core/src/store/selectionResolve';
import type { MapBuilderStore } from '@/store/types';
import type { EditorState, HintLine } from '@/editor/registry/types';
import { PICK_CHIPS, pickOnlyBinding } from './pickOnly';
import { mergePlan } from './merge';
import { isFreestanding } from '@dnd/core/src/shared/freestandingDoor';
import type { DoorChild } from '@/store/types';
import { compareLayerIds } from '@/store/selectors';
import { levelLabel } from '@/editor/surfaces/model';

const t = (text: string) => ({ text });
const k = (text: string) => ({ text, key: true });

/** "· comparing with L1 Ground at 40%" while the compare pass draws another level. */
function compareSegment(s: MapBuilderStore): { text: string }[] {
  if (compareLayerIds(s).length === 0 || !s.ui.compare) return [];
  const { levelId, opacity } = s.ui.compare;
  const i = s.levels.findIndex((l) => l.id === levelId);
  return [t(`· comparing with ${levelLabel(i, s.levels.length, s.levels[i].name)} at ${Math.round(opacity * 100)}%`)];
}

export function selectHint(state: EditorState): HintLine {
  const s = state as MapBuilderStore;
  const ids = s.selection.selectedIds;
  if (ids.length === 0) {
    const chips = pickOnlyBinding.read(state);
    const names = PICK_CHIPS.filter((c) => chips.includes(c.id)).map((c) => c.label.toLowerCase());
    return {
      label: 'Select',
      segments: [t('Nothing picked'), ...(names.length ? [t(`· a box picks ${names.join(', ')}`)] : []), ...compareSegment(s)],
    };
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
  const only = ids.length === 1 ? sel.children[0] : undefined;
  const free = only?.child.childType === 'door' && isFreestanding(only.layer, only.child as DoorChild) ? [t('freestanding ·')] : [];
  const below = only?.child.childType === 'asset' && only.child.belowWater ? [t('below water ·')] : [];
  return {
    label: title,
    segments: [t(`${title} ·`), ...pair, ...free, ...below, ...(editable ? [k('N'), t('nodes ·')] : []), k('Del'), t('delete')],
  };
}
