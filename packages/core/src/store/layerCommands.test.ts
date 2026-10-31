import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './store';
import { undoManager } from './undoManager';
import { createDungeonLayer } from './factories';
import type { AnyChild, DungeonLayer, Level, WallSegment } from './types';
import {
  DuplicateLayerCommand,
  LAST_LAYER_MESSAGE,
  RemoveLevelCascadeCommand,
  ReorderLevelCommand,
  layerContentBounds,
  layerDeleteBlock,
  layerMoveBlock,
  layerObjectCount,
} from './layerCommands';
import { CompositeCommand } from './commands';

const prop = (id: string, x: number, y: number, extra: Partial<AnyChild> = {}): AnyChild =>
  ({
    id,
    name: id,
    childType: 'asset',
    visible: true,
    assetId: 'test:crate',
    position: { x, y },
    rotation: 0,
    scale: 1,
    width: 1,
    height: 1,
    ...extra,
  }) as AnyChild;

const light = (id: string, attachedTo?: string): AnyChild =>
  ({
    id,
    name: id,
    childType: 'light',
    visible: true,
    color: '#ffffff',
    radius: 2,
    featherRadius: 1,
    intensity: 1,
    falloff: 'linear',
    position: { x: 3, y: 3 },
    ...(attachedTo ? { attachedTo } : {}),
  }) as AnyChild;

const door = (id: string, wallId: string): AnyChild =>
  ({
    id,
    name: id,
    childType: 'door',
    visible: true,
    wallId,
    position: [2, 0],
    angle: 0,
    width: 1,
    style: 'wooden',
    state: 'closed',
    isSecret: false,
    roomA: 'room-a',
    roomB: 'room-b',
  }) as unknown as AnyChild;

const wall = (id: string, points: [number, number][]): WallSegment =>
  ({ id, points, wallType: 'normal', direction: 'both', color: '#000000', roughness: 0 }) as WallSegment;

const dungeons = () => useStore.getState().layers.filter((l): l is DungeonLayer => l.type === 'dungeon');
const level1 = () => useStore.getState().levels[0];

/** The default map's one dungeon layer, filled with a little of everything. */
function seedRich(): DungeonLayer {
  const id = dungeons()[0].id;
  useStore.setState((s) => {
    const l = s.layers.find((x) => x.id === id) as DungeonLayer;
    l.name = 'Warren';
    l.standaloneWalls = [wall('w1', [[0, 0], [4, 0]])];
    l.groups = [{ id: 'g1', name: 'Crates' }];
    l.children = [
      prop('p1', 1, 1, { groupId: 'g1' }),
      prop('p2', 2, 1, { groupId: 'g1' }),
      light('l1', 'p1'),
      door('d1', 'w1'),
    ];
    l.areas = [{ id: 'a1', name: 'North' }];
    l.rooms = [{ id: 'r1', name: 'Hall', number: 1, anchor: [1, 1], areaId: 'a1', derivedFrom: 'r0' }];
  });
  return dungeons()[0];
}

describe('DuplicateLayerCommand', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
    undoManager.clear();
  });

  it('names the copy "<name> copy" and puts it directly above the source', () => {
    const src = seedRich();
    const top = createDungeonLayer('Top', level1().id);
    useStore.getState().addLayer(top);
    const cmd = new DuplicateLayerCommand(src.id);
    undoManager.execute(cmd);
    const ids = useStore.getState().layers.map((l) => l.id);
    expect(ids.indexOf(cmd.newId)).toBe(ids.indexOf(src.id) + 1);
    expect(ids.indexOf(top.id)).toBe(ids.indexOf(cmd.newId) + 1);
    const copy = useStore.getState().layers.find((l) => l.id === cmd.newId)!;
    expect(copy.name).toBe('Warren copy');
    expect(copy.levelId).toBe(src.levelId);
  });

  it('gives every child a new id and keeps the count', () => {
    const src = seedRich();
    const cmd = new DuplicateLayerCommand(src.id);
    undoManager.execute(cmd);
    const copy = dungeons().find((l) => l.id === cmd.newId)!;
    expect(copy.children).toHaveLength(src.children.length);
    const old = new Set(src.children.map((c) => c.id));
    expect(copy.children.every((c) => !old.has(c.id))).toBe(true);
  });

  it('rebinds a door to the copied wall and drops its derived rooms', () => {
    const src = seedRich();
    const cmd = new DuplicateLayerCommand(src.id);
    undoManager.execute(cmd);
    const copy = dungeons().find((l) => l.id === cmd.newId)!;
    const d = copy.children.find((c) => c.childType === 'door') as AnyChild & { wallId: string; roomA?: string };
    expect(copy.standaloneWalls[0].id).not.toBe('w1');
    expect(d.wallId).toBe(copy.standaloneWalls[0].id);
    expect(d.roomA ?? null).not.toBe('room-a');
  });

  it('remaps groups so the copied members share the copied group', () => {
    const src = seedRich();
    const cmd = new DuplicateLayerCommand(src.id);
    undoManager.execute(cmd);
    const copy = dungeons().find((l) => l.id === cmd.newId)!;
    const gid = copy.groups![0].id;
    expect(gid).not.toBe('g1');
    const members = copy.children.filter((c) => c.groupId === gid);
    expect(members).toHaveLength(2);
    expect(src.groups![0].id).toBe('g1');
  });

  it('re-attaches a light to the copied prop', () => {
    const src = seedRich();
    const cmd = new DuplicateLayerCommand(src.id);
    undoManager.execute(cmd);
    const copy = dungeons().find((l) => l.id === cmd.newId)!;
    const l = copy.children.find((c) => c.childType === 'light') as AnyChild & { attachedTo?: string };
    const p1copy = copy.children.find((c) => c.name === 'p1')!;
    expect(l.attachedTo).toBe(p1copy.id);
  });

  it('gives rooms new permanent ids, remaps their area, and drops lineage', () => {
    const src = seedRich();
    const cmd = new DuplicateLayerCommand(src.id);
    undoManager.execute(cmd);
    const copy = dungeons().find((l) => l.id === cmd.newId)!;
    const room = copy.rooms![0];
    expect(room.id).not.toBe('r1');
    expect(room.name).toBe('Hall');
    expect(room.areaId).toBe(copy.areas![0].id);
    expect(copy.areas![0].id).not.toBe('a1');
    expect(room.derivedFrom).toBeUndefined();
  });

  it('leaves the source untouched', () => {
    const src = seedRich();
    const ids = (l: DungeonLayer) => JSON.stringify([l.children.map((c) => [c.id, c.groupId]), l.standaloneWalls.map((w) => w.id), l.groups, l.rooms?.map((r) => r.id)]);
    const before = ids(src);
    undoManager.execute(new DuplicateLayerCommand(src.id));
    expect(ids(dungeons().find((l) => l.id === src.id)!)).toBe(before);
  });

  it('undo removes the copy and redo brings back the same one', () => {
    const src = seedRich();
    const cmd = new DuplicateLayerCommand(src.id);
    undoManager.execute(cmd);
    const copyChildIds = dungeons().find((l) => l.id === cmd.newId)!.children.map((c) => c.id);
    undoManager.undo();
    expect(useStore.getState().layers.some((l) => l.id === cmd.newId)).toBe(false);
    undoManager.redo();
    const again = dungeons().find((l) => l.id === cmd.newId)!;
    expect(again.children.map((c) => c.id)).toEqual(copyChildIds);
  });

  it('does nothing for the background', () => {
    const bg = useStore.getState().layers[0];
    const count = useStore.getState().layers.length;
    new DuplicateLayerCommand(bg.id).execute();
    expect(useStore.getState().layers).toHaveLength(count);
  });
});

describe('ReorderLevelCommand', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
    undoManager.clear();
  });

  it('moves a level in the order and undo puts it back', () => {
    const b: Level = { id: 'lv-b', name: 'B' };
    const c: Level = { id: 'lv-c', name: 'C' };
    useStore.getState().addLevel(b);
    useStore.getState().addLevel(c);
    const first = level1().id;
    undoManager.execute(new ReorderLevelCommand(2, 0));
    expect(useStore.getState().levels.map((l) => l.id)).toEqual(['lv-c', first, 'lv-b']);
    undoManager.undo();
    expect(useStore.getState().levels.map((l) => l.id)).toEqual([first, 'lv-b', 'lv-c']);
  });
});

describe('RemoveLevelCascadeCommand', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
    undoManager.clear();
  });

  function twoLevels() {
    const lv = { id: 'lv-2', name: 'Cellar' };
    useStore.getState().addLevel(lv);
    const a = createDungeonLayer('Cellar A', lv.id);
    const b = createDungeonLayer('Cellar B', lv.id);
    useStore.getState().addLayer(a);
    useStore.getState().addLayer(b);
    return { lv, a, b };
  }

  it('moves the level’s layers to the chosen level, then deletes it; undo restores both', () => {
    const { lv, a, b } = twoLevels();
    const ground = level1().id;
    undoManager.execute(new RemoveLevelCascadeCommand(lv.id, ground));
    const s = useStore.getState();
    expect(s.levels.map((l) => l.id)).toEqual([ground]);
    expect(s.layers.find((l) => l.id === a.id)!.levelId).toBe(ground);
    expect(s.layers.find((l) => l.id === b.id)!.levelId).toBe(ground);
    undoManager.undo();
    const u = useStore.getState();
    expect(u.levels.map((l) => l.id)).toEqual([ground, lv.id]);
    expect(u.layers.find((l) => l.id === a.id)!.levelId).toBe(lv.id);
  });

  it('deletes the layers with the level when no level is chosen; undo puts them back in place', () => {
    const { lv, a, b } = twoLevels();
    const order = useStore.getState().layers.map((l) => l.id);
    undoManager.execute(new RemoveLevelCascadeCommand(lv.id, null));
    const s = useStore.getState();
    expect(s.layers.some((l) => l.id === a.id || l.id === b.id)).toBe(false);
    expect(s.levels).toHaveLength(1);
    undoManager.undo();
    expect(useStore.getState().layers.map((l) => l.id)).toEqual(order);
    expect(useStore.getState().levels.map((l) => l.id)).toContain(lv.id);
  });

  it('refuses the last level', () => {
    const cmd = new RemoveLevelCascadeCommand(level1().id, null);
    cmd.execute();
    expect(cmd.refused).toBe(true);
    expect(useStore.getState().levels).toHaveLength(1);
    expect(dungeons()).toHaveLength(1);
  });
});

describe('layer guards', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
    undoManager.clear();
  });

  it('refuses deleting the last layer of a level, and allows it once there is another', () => {
    const only = dungeons()[0];
    expect(layerDeleteBlock(useStore.getState(), only.id)).toBe(LAST_LAYER_MESSAGE);
    useStore.getState().addLayer(createDungeonLayer('Second', level1().id));
    expect(layerDeleteBlock(useStore.getState(), only.id)).toBeNull();
  });

  it('refuses a locked layer and the background', () => {
    useStore.getState().addLayer(createDungeonLayer('Second', level1().id));
    const only = dungeons()[0];
    useStore.getState().updateLayer(only.id, { locked: true });
    expect(layerDeleteBlock(useStore.getState(), only.id)).toBe('Layer is locked');
    expect(layerDeleteBlock(useStore.getState(), useStore.getState().layers[0].id)).not.toBeNull();
  });

  it('refuses moving the last layer off its level', () => {
    useStore.getState().addLevel({ id: 'lv-2', name: 'Cellar' });
    const only = dungeons()[0];
    expect(layerMoveBlock(useStore.getState(), only.id)).toBe(LAST_LAYER_MESSAGE);
    useStore.getState().addLayer(createDungeonLayer('Second', level1().id));
    expect(layerMoveBlock(useStore.getState(), only.id)).toBeNull();
  });
});

describe('layerContentBounds and counts', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
  });

  it('is null for an empty layer and the background', () => {
    expect(layerContentBounds(dungeons()[0])).toBeNull();
    expect(layerContentBounds(useStore.getState().layers[0])).toBeNull();
  });

  it('unions children and drawn walls, hidden children included', () => {
    const layer = { ...createDungeonLayer('X'), standaloneWalls: [wall('w', [[10, 10], [14, 10]])], children: [prop('a', 1, 1, { visible: false })] };
    const b = layerContentBounds(layer)!;
    expect(b.minX).toBeLessThanOrEqual(1);
    expect(b.minY).toBeLessThanOrEqual(1);
    expect(b.maxX).toBeGreaterThanOrEqual(14);
    expect(b.maxY).toBeGreaterThanOrEqual(10);
  });

  it('counts children, drawn walls and rooms', () => {
    const src = seedRich();
    expect(layerObjectCount(src)).toBe(4 + 1 + 1);
  });

  it('a composite holding a layer step restores the active layer like the step', () => {
    const plain = new CompositeCommand('X', [{ label: 'x', execute: () => {}, undo: () => {} }]);
    expect(plain.restoresUi).toBe(false);
    const withLayer = new CompositeCommand('Y', [new ReorderLevelCommand(0, 0)]);
    expect(withLayer.restoresUi).toBe(true);
  });
});
