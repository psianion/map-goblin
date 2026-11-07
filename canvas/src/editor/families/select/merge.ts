// Merge for two picked walls (plan 6.6): one wall from two that share an endpoint and have
// the same type and set. The first picked keeps its id; one undo step restores both.

import { Merge } from 'lucide-react';
import { selectWallById } from '@/store/selectors';
import { MergeWallsCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import type { MapBuilderStore, WallSegment } from '@/store/types';
import { joinRefusal, mergeWalls } from '@dnd/core/src/shared/wallJoin';
import type { EditorState, Verb } from '@/editor/registry/types';

type Plan = { layerId: string; merged: WallSegment; removed: string } | { refusal: string };

/** The two picked walls, in pick order, when exactly two walls and nothing else are picked. */
function pickedPair(state: EditorState) {
  const ids = state.selection.selectedIds;
  if (ids.length !== 2) return null;
  const a = selectWallById(state as MapBuilderStore, ids[0]);
  const b = selectWallById(state as MapBuilderStore, ids[1]);
  return a && b ? { a, b } : null;
}

/** What Merge would do with the pick, or why it cannot; null when the pick is not two walls. */
export function mergePlan(state: EditorState): Plan | null {
  const pair = pickedPair(state);
  if (!pair) return null;
  const { a, b } = pair;
  if (a.layer.id !== b.layer.id) return { refusal: 'on different layers' };
  const refusal = joinRefusal(a.wall, b.wall, a.layer.style);
  if (refusal) return { refusal };
  const merged = mergeWalls(a.wall, b.wall, a.layer.style);
  return merged ? { layerId: a.layer.id, merged, removed: b.wall.id } : { refusal: 'not touching at an end' };
}

export const mergeVerb: Verb = {
  id: 'merge',
  label: 'Merge into one wall',
  icon: Merge,
  multi: true,
  when: (s) => mergePlan(s) !== null,
  disabled: (s) => {
    const plan = mergePlan(s);
    return !plan || 'refusal' in plan;
  },
  run: (store) => {
    const plan = mergePlan(store.getState());
    if (!plan || 'refusal' in plan) return;
    undoManager.execute(new MergeWallsCommand('Merge walls', plan.layerId, plan.merged, [plan.removed]));
    store.getState().setSelectedIds([plan.merged.id]);
  },
};
