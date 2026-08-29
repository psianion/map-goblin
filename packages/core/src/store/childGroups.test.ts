import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './store';
import {
  createDeleteGroupCommand,
  createDissolveGroupCommand,
  createDuplicateGroupCommand,
  createGroupChildrenCommand,
  createRemoveFromGroupCommand,
  createRenameGroupCommand,
} from './commands';
import { childGroupOf, expandIdsForGroups, groupMembers } from './selectors';
import { undoManager } from './undoManager';
import type { AssetChild, LightChild } from '../shared/types';
import type { DungeonLayer } from './types';

function asset(id: string, name = id): AssetChild {
  return {
    id,
    name,
    childType: 'asset',
    visible: true,
    objectType: 'asset',
    assetId: 'crate',
    position: { x: 1, y: 1 },
    rotation: 0,
    scale: 1,
    width: 1,
    height: 1,
    tint: '#ffffff',
    flipX: false,
    flipY: false,
  };
}

/** Seeds `ids` as assets on the first dungeon layer and hands back its id. */
function seed(ids: string[]): string {
  const layer = useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
  for (const id of ids) useStore.getState().addChild(layer.id, asset(id));
  return layer.id;
}

function dungeon(layerId: string): DungeonLayer {
  return useStore.getState().layers.find((l) => l.id === layerId) as DungeonLayer;
}

function group(layerId: string, ids: string[], name = 'Group', merged = false): string {
  const cmd = createGroupChildrenCommand(useStore.getState().layers, layerId, ids, name, merged)!;
  undoManager.execute(cmd);
  return dungeon(layerId).groups![dungeon(layerId).groups!.length - 1].id;
}

describe('child groups', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
    undoManager.clear();
  });

  it('groups children and restores order, groupIds and meta on undo', () => {
    const layerId = seed(['a', 'b', 'c', 'd']);
    const before = dungeon(layerId).children.map((c) => c.id);

    const groupId = group(layerId, ['a', 'c'], 'Torches');

    const after = dungeon(layerId);
    expect(after.children.map((c) => c.id)).toEqual(['b', 'a', 'c', 'd']);
    expect(groupMembers(after, groupId).map((c) => c.id)).toEqual(['a', 'c']);
    expect(after.groups).toEqual([{ id: groupId, name: 'Torches', merged: false }]);

    undoManager.undo();
    const undone = dungeon(layerId);
    expect(undone.children.map((c) => c.id)).toEqual(before);
    expect(undone.children.every((c) => c.groupId === undefined)).toBe(true);
    expect(undone.groups).toBeUndefined();

    undoManager.redo();
    expect(dungeon(layerId).children.map((c) => c.id)).toEqual(['b', 'a', 'c', 'd']);
    expect(dungeon(layerId).groups?.[0].id).toBe(groupId);
  });

  it('places the block at the topmost member and keeps members contiguous', () => {
    const layerId = seed(['a', 'b', 'c', 'd', 'e']);
    group(layerId, ['a', 'd']);
    expect(dungeon(layerId).children.map((c) => c.id)).toEqual(['b', 'c', 'a', 'd', 'e']);
  });

  it('extends the one existing group instead of minting a new one', () => {
    const layerId = seed(['a', 'b', 'c']);
    const first = group(layerId, ['a', 'b'], 'Goblin Camp', true);

    const cmd = createGroupChildrenCommand(
      useStore.getState().layers,
      layerId,
      ['a', 'b', 'c'],
      'Group 2',
    )!;
    undoManager.execute(cmd);

    const layer = dungeon(layerId);
    expect(layer.groups).toEqual([{ id: first, name: 'Goblin Camp', merged: true }]);
    expect(groupMembers(layer, first).map((c) => c.id)).toEqual(['a', 'b', 'c']);

    undoManager.undo();
    const back = dungeon(layerId);
    expect(back.groups).toEqual([{ id: first, name: 'Goblin Camp', merged: true }]);
    expect(groupMembers(back, first).map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('extends from a partial selection and pulls the unselected members along', () => {
    const layerId = seed(['a', 'b', 'c']);
    const first = group(layerId, ['a', 'b'], 'Goblin Camp');
    // Only 'b' of the group is selected; 'a' still ends up in the block.
    undoManager.execute(
      createGroupChildrenCommand(useStore.getState().layers, layerId, ['b', 'c'], 'Group 2')!,
    );
    const layer = dungeon(layerId);
    expect(layer.groups!.map((g) => g.name)).toEqual(['Goblin Camp']);
    expect(groupMembers(layer, first).map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('grouping members of two groups steals them into a new one and prunes the empty meta', () => {
    const layerId = seed(['a', 'b', 'c', 'd']);
    const first = group(layerId, ['a', 'b'], 'One');
    const second = group(layerId, ['c', 'd'], 'Two');
    const third = group(layerId, ['a', 'b', 'c', 'd'], 'Three');

    const layer = dungeon(layerId);
    expect(layer.groups!.map((g) => g.id)).toEqual([third]);
    expect(groupMembers(layer, first)).toEqual([]);
    expect(groupMembers(layer, second)).toEqual([]);
    expect(groupMembers(layer, third).map((c) => c.id)).toEqual(['a', 'b', 'c', 'd']);

    undoManager.undo();
    expect(dungeon(layerId).groups!.map((g) => g.id)).toEqual([first, second]);
  });

  it('returns null when there is nothing to group', () => {
    const layerId = seed(['a']);
    expect(createGroupChildrenCommand(useStore.getState().layers, layerId, [], 'x')).toBeNull();
    expect(createGroupChildrenCommand(useStore.getState().layers, 'nope', ['a'], 'x')).toBeNull();
  });

  it('dissolve clears membership and meta, undo puts both back', () => {
    const layerId = seed(['a', 'b']);
    const groupId = group(layerId, ['a', 'b'], 'Camp', true);

    undoManager.execute(createDissolveGroupCommand(useStore.getState().layers, layerId, groupId)!);
    expect(dungeon(layerId).groups).toBeUndefined();
    expect(dungeon(layerId).children.every((c) => c.groupId === undefined)).toBe(true);

    undoManager.undo();
    expect(dungeon(layerId).groups).toEqual([{ id: groupId, name: 'Camp', merged: true }]);
    expect(groupMembers(dungeon(layerId), groupId).map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('removeFromGroup drops the named children and prunes meta when the group empties', () => {
    const layerId = seed(['a', 'b', 'c']);
    const groupId = group(layerId, ['a', 'b', 'c']);

    undoManager.execute(createRemoveFromGroupCommand(useStore.getState().layers, layerId, ['a'])!);
    expect(groupMembers(dungeon(layerId), groupId).map((c) => c.id)).toEqual(['b', 'c']);
    expect(dungeon(layerId).groups).toHaveLength(1);

    undoManager.execute(createRemoveFromGroupCommand(useStore.getState().layers, layerId, ['b', 'c'])!);
    expect(dungeon(layerId).groups).toBeUndefined();

    undoManager.undo();
    expect(dungeon(layerId).groups).toHaveLength(1);
  });

  it('rename rewrites only the name', () => {
    const layerId = seed(['a']);
    const groupId = group(layerId, ['a'], 'Old');
    undoManager.execute(createRenameGroupCommand(useStore.getState().layers, layerId, groupId, 'New')!);
    expect(dungeon(layerId).groups![0].name).toBe('New');
    expect(groupMembers(dungeon(layerId), groupId)).toHaveLength(1);
    undoManager.undo();
    expect(dungeon(layerId).groups![0].name).toBe('Old');
  });

  it('delete removes every member plus attached lights, and undo restores indices', () => {
    const layerId = seed(['a', 'b', 'c']);
    const light: LightChild = {
      id: 'light-1',
      name: 'Light',
      childType: 'light',
      visible: true,
      color: '#ffcc66',
      radius: 4,
      featherRadius: 2,
      intensity: 0.8,
      falloff: 'linear',
      position: { x: 1, y: 1 },
      attachedTo: 'b',
    };
    useStore.getState().addChild(layerId, light);
    const groupId = group(layerId, ['a', 'b']);
    const orderBefore = dungeon(layerId).children.map((c) => c.id);

    undoManager.execute(createDeleteGroupCommand(useStore.getState().layers, layerId, groupId)!);
    expect(dungeon(layerId).children.map((c) => c.id)).toEqual(['c']);
    expect(dungeon(layerId).groups).toBeUndefined();

    undoManager.undo();
    expect(dungeon(layerId).children.map((c) => c.id)).toEqual(orderBefore);
    expect(groupMembers(dungeon(layerId), groupId).map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('duplicate clones members with fresh ids under a new group', () => {
    const layerId = seed(['a', 'b']);
    const groupId = group(layerId, ['a', 'b'], 'Camp', true);

    undoManager.execute(createDuplicateGroupCommand(useStore.getState().layers, layerId, groupId)!);
    const layer = dungeon(layerId);
    const newGroup = layer.groups!.find((g) => g.id !== groupId)!;
    const clones = groupMembers(layer, newGroup.id);

    expect(layer.children).toHaveLength(4);
    expect(newGroup).toMatchObject({ name: 'Camp (copy)', merged: true });
    expect(clones.map((c) => c.name)).toEqual(['a (copy)', 'b (copy)']);
    expect(clones.some((c) => c.id === 'a' || c.id === 'b')).toBe(false);
    expect(new Set(clones.map((c) => c.id)).size).toBe(2);
    expect((clones[0] as AssetChild).position).toEqual({ x: 2, y: 2 });

    undoManager.undo();
    expect(dungeon(layerId).children).toHaveLength(2);
    expect(dungeon(layerId).groups!.map((g) => g.id)).toEqual([groupId]);
  });
});

describe('expandIdsForGroups', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
    undoManager.clear();
  });

  it('expands plain groups by default and only merged ones under mergedOnly', () => {
    const layerId = seed(['a', 'b', 'c', 'd', 'e']);
    group(layerId, ['a', 'b'], 'Plain');
    group(layerId, ['c', 'd'], 'Merged', true);
    const state = useStore.getState();

    expect(expandIdsForGroups(state, ['a'])).toEqual(['a', 'b']);
    expect(expandIdsForGroups(state, ['a'], { mergedOnly: true })).toEqual(['a']);
    expect(expandIdsForGroups(state, ['c'], { mergedOnly: true })).toEqual(['c', 'd']);
    expect(expandIdsForGroups(state, ['e', 'a', 'b'])).toEqual(['e', 'a', 'b']);
    expect(expandIdsForGroups(state, ['unknown'])).toEqual(['unknown']);
  });

  it('childGroupOf answers null for an ungrouped child', () => {
    const layerId = seed(['a', 'b']);
    const groupId = group(layerId, ['a'], 'Solo');
    expect(childGroupOf(dungeon(layerId), 'a')?.id).toBe(groupId);
    expect(childGroupOf(dungeon(layerId), 'b')).toBeNull();
  });
});

describe('normalizeChildGroups', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
    undoManager.clear();
  });

  it('drops dangling groupIds and member-less meta, and is idempotent', () => {
    const layerId = seed(['a', 'b']);
    useStore.getState().updateChild(layerId, 'a', { groupId: 'ghost' });
    useStore.getState().updateLayer(layerId, {
      groups: [{ id: 'empty', name: 'Empty' }],
    } as Partial<DungeonLayer>);

    useStore.getState().normalizeChildGroups();
    expect(dungeon(layerId).children.find((c) => c.id === 'a')!.groupId).toBeUndefined();
    expect(dungeon(layerId).groups).toBeUndefined();

    useStore.getState().normalizeChildGroups();
    expect(dungeon(layerId).groups).toBeUndefined();
  });

  it('keeps a well-formed group untouched', () => {
    const layerId = seed(['a', 'b']);
    const groupId = group(layerId, ['a', 'b'], 'Keep');
    useStore.getState().normalizeChildGroups();
    expect(dungeon(layerId).groups!.map((g) => g.id)).toEqual([groupId]);
    expect(groupMembers(dungeon(layerId), groupId)).toHaveLength(2);
  });
});

describe('group serialization round-trip', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
    undoManager.clear();
  });

  it('survives getSerializableState → loadFromFile with no version bump', () => {
    const layerId = seed(['a', 'b', 'c']);
    const groupId = group(layerId, ['a', 'c'], 'Camp', true);

    const doc = JSON.parse(JSON.stringify(useStore.getState().getSerializableState()));
    useStore.getState().resetToDefault();
    useStore.getState().loadFromFile(doc);

    const layer = useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
    expect(layer.groups).toEqual([{ id: groupId, name: 'Camp', merged: true }]);
    expect(groupMembers(layer, groupId).map((c) => c.id)).toEqual(['a', 'c']);
  });
});
