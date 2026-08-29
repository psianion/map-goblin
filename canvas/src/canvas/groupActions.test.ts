import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import { expandIdsForGroups } from '@/store/selectors';
import type { DungeonLayer, LightChild } from '@/store/types';
import {
  canGroupSelection,
  groupSelection,
  mergeSelection,
  selectionGroup,
  ungroupSelection,
} from './groupActions';

function layer(): DungeonLayer {
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon');
  if (!l) throw new Error('default state has no dungeon layer');
  return l;
}

function light(id: string): LightChild {
  return {
    id,
    name: id,
    childType: 'light',
    visible: true,
    color: '#ffdd88',
    radius: 6,
    featherRadius: 0,
    intensity: 0.4,
    falloff: 'quadratic',
    position: { x: 0, y: 0 },
  };
}

/** Seed n lights on the default dungeon layer and select them all. */
function seed(n: number): string[] {
  const ids = Array.from({ length: n }, (_, i) => `c${i}`);
  for (const id of ids) useStore.getState().addChild(layer().id, light(id));
  useStore.getState().setSelectedIds(ids);
  return ids;
}

beforeEach(() => {
  vi.clearAllMocks();
  undoManager.clear();
  useStore.getState().resetToDefault();
});

describe('canGroupSelection', () => {
  it('needs two or more children', () => {
    seed(1);
    expect(canGroupSelection()).toBe(false);
    seed(2);
    expect(canGroupSelection()).toBe(true);
  });

  it('refuses a selection spanning two dungeon layers', () => {
    const first = layer();
    useStore.getState().addChild(first.id, light('a'));
    useStore.getState().addLayer({ ...structuredClone(first), id: 'layer-2', children: [] });
    useStore.getState().addChild('layer-2', light('b'));
    useStore.getState().setSelectedIds(['a', 'b']);
    expect(canGroupSelection()).toBe(false);
  });

  it('refuses a locked layer', () => {
    seed(2);
    useStore.getState().updateLayer(layer().id, { locked: true });
    expect(canGroupSelection()).toBe(false);
  });
});

describe('group naming counter', () => {
  it('counts per base name and skips gaps by taking the highest suffix', () => {
    const ids = seed(4);
    useStore.getState().setSelectedIds(ids.slice(0, 2));
    groupSelection();
    useStore.getState().setSelectedIds(ids.slice(2, 4));
    mergeSelection();
    expect(layer().groups?.map((g) => g.name)).toEqual(['Group 1', 'Merged 1']);

    // A hand-typed "Group 7" pushes the next plain group to 8, without
    // disturbing the Merged counter.
    useStore.getState().setSelectedIds(ids.slice(0, 2));
    ungroupSelection();
    const groups = layer().groups ?? [];
    useStore.getState().updateLayer(layer().id, {
      groups: [...groups, { id: 'g7', name: 'Group 7' }],
    });
    useStore.getState().setSelectedIds(ids.slice(0, 2));
    groupSelection();
    expect(layer().groups?.map((g) => g.name)).toContain('Group 8');
  });

  it('groups only when the command is producible and undoes cleanly', () => {
    seed(3);
    groupSelection();
    const groupId = layer().groups?.[0]?.id;
    expect(groupId).toBeTruthy();
    expect(layer().children.filter((c) => c.groupId === groupId)).toHaveLength(3);
    undoManager.undo();
    expect(layer().children.every((c) => !c.groupId)).toBe(true);
  });
});

describe('selectionGroup / ungroupSelection', () => {
  it('reports the shared group and dissolves it', () => {
    seed(2);
    mergeSelection();
    expect(selectionGroup()?.group.merged).toBe(true);
    ungroupSelection();
    expect(selectionGroup()).toBeNull();
    expect(layer().children.every((c) => !c.groupId)).toBe(true);
  });

  it('is null when the selection straddles two groups', () => {
    const ids = seed(4);
    useStore.getState().setSelectedIds(ids.slice(0, 2));
    groupSelection();
    useStore.getState().setSelectedIds(ids.slice(2, 4));
    groupSelection();
    useStore.getState().setSelectedIds([ids[0], ids[2]]);
    expect(selectionGroup()).toBeNull();
  });
});

// The canvas click/marquee paths in SelectTool are thin wrappers over this —
// clicks expand every group, the marquee only merged ones.
describe('expansion contract used by SelectTool', () => {
  it('expands plain groups on click but not under the marquee', () => {
    const ids = seed(3);
    useStore.getState().setSelectedIds(ids.slice(0, 2));
    groupSelection();
    const state = useStore.getState();
    expect(expandIdsForGroups(state, [ids[0]])).toEqual([ids[0], ids[1]]);
    expect(expandIdsForGroups(state, [ids[0]], { mergedOnly: true })).toEqual([ids[0]]);
  });

  it('expands merged groups with or without the bypass', () => {
    const ids = seed(3);
    useStore.getState().setSelectedIds(ids.slice(0, 2));
    mergeSelection();
    const state = useStore.getState();
    expect(expandIdsForGroups(state, [ids[0]], { mergedOnly: true })).toEqual([ids[0], ids[1]]);
  });
});
