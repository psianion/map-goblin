import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { setClipperModule } from '../geometry/Clipper2Engine';
import { useStore } from './store';
import { undoManager } from './undoManager';
import { refreshRooms } from './roomRefresh';
import { createDungeonLayer } from './factories';
import {
  AcceptRoomsCommand,
  AddAreaCommand,
  AddLayerCommand,
  AddLevelCommand,
  AddRoomCommand,
  AssignRoomsToAreaCommand,
  MergeRoomsCommand,
  MoveLayerToLevelCommand,
  RemoveAreaCommand,
  RemoveLevelCommand,
  RemoveRoomCommand,
  RemoveThresholdCommand,
  RenameAreaCommand,
  RenameLevelCommand,
  RenameRoomCommand,
  RenumberByReadingOrderCommand,
  ReorderRoomsCommand,
  SetAreaLookCommand,
  SetLevelLookCommand,
  SetRoomKeyCommand,
  SetRoomLookCommand,
  SetRoomNumberCommand,
  SetStartingRoomCommand,
  SplitRoomCommand,
  createDrawRoomCommand,
} from './commands';
import { emptyRoomKey } from '../shared/prep';
import type { DungeonLayer, RoomKey, ShapeChild } from './types';
import type { Room } from '../shared/types';

/** Same wasm hand-off as roomDetection.test.ts — jsdom can't fetch the .wasm. */
beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(
    createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'),
  );
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  const clipper: MainModule = await mod.default({ wasmBinary });
  setClipperModule(clipper);
}, 30_000);

const FLOOR: [number, number][][] = [[[0, 0], [20, 0], [20, 10], [0, 10]]];

function dungeon(): DungeonLayer {
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon');
  if (!l) throw new Error('no dungeon layer');
  return l;
}

const rooms = () => dungeon().rooms ?? [];
const ids = () => rooms().map((r) => r.id);
const keyOf = (roomId: string) => useStore.getState().prep?.rooms.find((k) => k.roomId === roomId);
const key = (roomId: string, patch: Partial<RoomKey> = {}): RoomKey => ({ ...emptyRoomKey(roomId), ...patch });

/** A 20x10 floor holding one room anchored on its left, faces refreshed. */
function seedHall(): string {
  const id = dungeon().id;
  useStore.getState().updateLayer(id, { mergedFloor: FLOOR } as Partial<DungeonLayer>);
  undoManager.execute(new AddRoomCommand(id, { id: 'hall', name: 'Hall', number: 1, anchor: [4, 5] }));
  undoManager.clear();
  return id;
}

beforeEach(() => {
  undoManager.clear();
  useStore.getState().resetToDefault();
});

describe('add / remove / rename', () => {
  it('adds a room, refreshes its face, and undoes it', () => {
    const id = seedHall();
    expect(rooms()[0].face).toBeDefined();
    undoManager.execute(new AddRoomCommand(id, { id: 'b', name: 'B', anchor: [15, 5] }));
    expect(ids()).toEqual(['hall', 'b']);
    undoManager.undo();
    expect(ids()).toEqual(['hall']);
  });

  it('refuses a duplicate id', () => {
    const id = seedHall();
    undoManager.execute(new AddRoomCommand(id, { id: 'hall', name: 'Dupe', anchor: [1, 1] }));
    expect(rooms()).toHaveLength(1);
    expect(rooms()[0].name).toBe('Hall');
  });

  it('removes a room with its key and its starting-room mark; undo restores all three', () => {
    const id = seedHall();
    undoManager.execute(new SetRoomKeyCommand('hall', key('hall', { readAloud: 'Dust.' })));
    undoManager.execute(new SetStartingRoomCommand('hall'));
    undoManager.execute(new RemoveRoomCommand(id, 'hall'));
    expect(rooms()).toHaveLength(0);
    expect(keyOf('hall')).toBeUndefined();
    expect(useStore.getState().mapSettings.startingRoomId).toBeUndefined();
    // The floor stays: a room is a place, not geometry.
    expect(dungeon().mergedFloor).toEqual(FLOOR);
    undoManager.undo();
    expect(ids()).toEqual(['hall']);
    expect(keyOf('hall')?.readAloud).toBe('Dust.');
    expect(useStore.getState().mapSettings.startingRoomId).toBe('hall');
  });

  it('renames on the room itself; undo puts the old name back', () => {
    const id = seedHall();
    undoManager.execute(new RenameRoomCommand(id, 'hall', 'Hall', 'Great Hall'));
    expect(rooms()[0].name).toBe('Great Hall');
    undoManager.undo();
    expect(rooms()[0].name).toBe('Hall');
  });

  it('accepts suggestions as one undo step, skipping ids already there', () => {
    const id = seedHall();
    const ghosts: Room[] = [
      { id: 'hall', name: 'Room 2', number: 2, anchor: [1, 1] },
      { id: 'g2', name: 'Room 2', number: 2, anchor: [15, 5], face: [[10, 0], [20, 0], [20, 10], [10, 10]] },
    ];
    undoManager.execute(new AcceptRoomsCommand(id, ghosts));
    expect(ids()).toEqual(['hall', 'g2']);
    undoManager.undo();
    expect(ids()).toEqual(['hall']);
  });
});

describe('numbers and order', () => {
  function seedThree(): string {
    const id = seedHall();
    undoManager.execute(new AddRoomCommand(id, { id: 'b', name: 'B', number: 2, anchor: [15, 2] }));
    undoManager.execute(new AddRoomCommand(id, { id: 'c', name: 'C', number: 3, anchor: [15, 8] }));
    undoManager.clear();
    return id;
  }

  it('sets and clears one number', () => {
    const id = seedThree();
    undoManager.execute(new SetRoomNumberCommand(id, 'b', 9));
    expect(rooms().find((r) => r.id === 'b')?.number).toBe(9);
    undoManager.execute(new SetRoomNumberCommand(id, 'b', undefined));
    expect(rooms().find((r) => r.id === 'b')).not.toHaveProperty('number');
    undoManager.undo();
    undoManager.undo();
    expect(rooms().find((r) => r.id === 'b')?.number).toBe(2);
  });

  it('reorder writes numbers 1..n in the given order', () => {
    const id = seedThree();
    undoManager.execute(new ReorderRoomsCommand(id, ['c', 'hall']));
    expect(rooms().map((r) => [r.id, r.number])).toEqual([['c', 1], ['hall', 2], ['b', 3]]);
    undoManager.undo();
    expect(rooms().map((r) => [r.id, r.number])).toEqual([['hall', 1], ['b', 2], ['c', 3]]);
  });

  it('renumbers by reading order', () => {
    const id = seedThree();
    // Three faces, so reading order goes by where each face sits.
    useStore.getState().setThresholds(id, [
      { id: 'v', points: [[10, 0], [10, 10]] },
      { id: 'h', points: [[10, 5], [20, 5]] },
    ]);
    refreshRooms();
    undoManager.execute(new ReorderRoomsCommand(id, ['c', 'b', 'hall']));
    undoManager.execute(new RenumberByReadingOrderCommand(id));
    // hall's face spans the full height, so its centroid row (5) reads after b's (2.5).
    expect(rooms().map((r) => [r.id, r.number])).toEqual([['b', 1], ['hall', 2], ['c', 3]]);
    undoManager.undo();
    expect(rooms().map((r) => [r.id, r.number])).toEqual([['c', 1], ['b', 2], ['hall', 3]]);
  });
});

describe('looks', () => {
  it('pins and resets keys of a room look; empty looks leave no key behind', () => {
    const id = seedHall();
    undoManager.execute(new SetRoomLookCommand(id, 'hall', { floorTint: '#aa0000', wallWidth: 1 }));
    expect(rooms()[0].look).toEqual({ floorTint: '#aa0000', wallWidth: 1 });
    undoManager.execute(new SetRoomLookCommand(id, 'hall', { floorTint: undefined, wallWidth: undefined }));
    expect(rooms()[0]).not.toHaveProperty('look');
    undoManager.undo();
    expect(rooms()[0].look).toEqual({ floorTint: '#aa0000', wallWidth: 1 });
  });

  it('a look edit keeps the derived face as it was', () => {
    const id = seedHall();
    const face = rooms()[0].face;
    undoManager.execute(new SetRoomLookCommand(id, 'hall', { floorTint: '#aa0000' }));
    expect(rooms()[0].face).toEqual(face);
  });
});

describe('split and merge', () => {
  const THRESHOLD = { id: 't', points: [[10, 0], [10, 10]] as [number, number][] };

  it('split keeps the id on the keeper, adds the other half with fog lineage, and undoes in one step', () => {
    const id = seedHall();
    const other: Room = { id: 'east', name: 'Hall, east', anchor: [15, 5] };
    undoManager.execute(new SplitRoomCommand(id, 'hall', THRESHOLD, other, 'copy'));
    expect(ids()).toEqual(['hall', 'east']);
    expect(rooms()[1].derivedFrom).toBe('hall');
    expect(dungeon().thresholds).toHaveLength(1);
    expect(rooms()[0].face).not.toEqual(rooms()[1].face);
    expect(rooms()[0].area).toBeLessThan(101);
    undoManager.undo();
    expect(ids()).toEqual(['hall']);
    expect(dungeon()).not.toHaveProperty('thresholds');
    expect(rooms()[0].area).toBeGreaterThan(190);
  });

  it('a split with fog copy publishes as the server reads it: lineage on the new half, no derived fields', () => {
    // What PublishDialog sends is `getSerializableState()`; the server's `takeLineage`
    // reads `derivedFrom` off it and derives every face again itself (rooms.test.ts there).
    const id = seedHall();
    undoManager.execute(new SplitRoomCommand(id, 'hall', THRESHOLD, { id: 'east', name: 'Hall, east', anchor: [15, 5] }, 'copy'));
    const doc = JSON.parse(JSON.stringify(useStore.getState().getSerializableState()));
    const layer = doc.layers.find((l: { id: string }) => l.id === id);
    expect(layer.rooms.map((r: Room) => r.id)).toEqual(['hall', 'east']);
    expect(layer.rooms[1]).toMatchObject({ id: 'east', anchor: [15, 5], derivedFrom: 'hall' });
    expect(layer.rooms[0]).not.toHaveProperty('derivedFrom');
    for (const room of layer.rooms) {
      for (const key of ['face', 'centroid', 'area', 'isPathway', 'orphaned', 'doors']) expect(room).not.toHaveProperty(key);
    }
    expect(layer.thresholds).toEqual([THRESHOLD]);
    expect(doc.mapSettings.roomsVersion).toBe(2);
    expect(doc.levels.length).toBeGreaterThan(0);
  });

  it("a new map's rooms come back from a save with their looks, areas and lineage", () => {
    // A new map never went through a loader. Unstamped, reopening it ran the room
    // migration again, which rebuilds rooms from id, name and anchor alone.
    const id = seedHall();
    undoManager.execute(new SplitRoomCommand(id, 'hall', THRESHOLD, { id: 'east', name: 'Hall, east', anchor: [15, 5] }, 'copy'));
    useStore.setState((s) => {
      const l = s.layers.find((x) => x.id === id) as DungeonLayer;
      l.areas = [{ id: 'wing', name: 'Wing', look: { wallTextureTint: '#00ff00' } }];
      l.rooms![0].areaId = 'wing';
      l.rooms![0].look = { floorTint: '#aa0000' };
    });
    const saved = JSON.parse(JSON.stringify(useStore.getState().getSerializableState()));
    useStore.getState().resetToDefault();
    useStore.getState().loadFromFile(saved);
    const back = rooms();
    expect(back.map((r) => r.id)).toEqual(['hall', 'east']);
    expect(back[0]).toMatchObject({ areaId: 'wing', look: { floorTint: '#aa0000' } });
    expect(back[1]).toMatchObject({ derivedFrom: 'hall' });
    expect(dungeon().areas).toEqual([{ id: 'wing', name: 'Wing', look: { wallTextureTint: '#00ff00' } }]);
  });

  it('split with a hidden other half records no lineage, and can move the keeper', () => {
    const id = seedHall();
    const other: Room = { id: 'west', name: 'Hall, west', anchor: [4, 5] };
    undoManager.execute(new SplitRoomCommand(id, 'hall', THRESHOLD, other, 'hidden', [15, 5]));
    const hall = rooms().find((r) => r.id === 'hall')!;
    expect(hall.anchor).toEqual([15, 5]);
    expect(rooms().find((r) => r.id === 'west')).not.toHaveProperty('derivedFrom');
  });

  it('merge drops the other room, removes the threshold between, records lineage and joins the keys', () => {
    const id = seedHall();
    undoManager.execute(new SplitRoomCommand(id, 'hall', THRESHOLD, { id: 'east', name: 'East', anchor: [15, 5] }, 'hidden'));
    undoManager.execute(new SetRoomKeyCommand('hall', key('hall', { readAloud: 'West half.', traps: [{ id: 'x', text: 'Pit' }] })));
    undoManager.execute(new SetRoomKeyCommand('east', key('east', { readAloud: 'East half.', treasure: '10 gp' })));
    undoManager.execute(new SetStartingRoomCommand('east'));

    undoManager.execute(new MergeRoomsCommand(id, 'hall', 'east'));
    expect(ids()).toEqual(['hall']);
    expect(dungeon()).not.toHaveProperty('thresholds');
    expect(rooms()[0].mergedFrom).toEqual(['east']);
    expect(rooms()[0].area).toBeGreaterThan(190);
    expect(keyOf('hall')).toMatchObject({ readAloud: 'West half.\n\nEast half.', treasure: '10 gp' });
    expect(keyOf('hall')?.traps).toHaveLength(1);
    expect(keyOf('east')).toBeUndefined();
    expect(useStore.getState().mapSettings.startingRoomId).toBe('hall');

    undoManager.undo();
    expect(ids()).toEqual(['hall', 'east']);
    expect(dungeon().thresholds).toHaveLength(1);
    expect(keyOf('hall')?.readAloud).toBe('West half.');
    expect(keyOf('east')?.readAloud).toBe('East half.');
    expect(useStore.getState().mapSettings.startingRoomId).toBe('east');
  });

  it('removes a threshold on its own', () => {
    const id = seedHall();
    undoManager.execute(new SplitRoomCommand(id, 'hall', THRESHOLD, { id: 'east', name: 'East', anchor: [15, 5] }, 'hidden'));
    undoManager.execute(new RemoveThresholdCommand(id, 't'));
    expect(rooms()[0].face).toEqual(rooms()[1].face);
  });
});

describe('areas', () => {
  it('adds an area round rooms, renames, pins a look, reassigns and removes it', () => {
    const id = seedHall();
    undoManager.execute(new AddRoomCommand(id, { id: 'b', name: 'B', anchor: [15, 5] }));
    undoManager.execute(new AddAreaCommand(id, { id: 'crypt', name: 'Crypt' }, ['hall', 'b']));
    expect(dungeon().areas).toEqual([{ id: 'crypt', name: 'Crypt' }]);
    expect(rooms().every((r) => r.areaId === 'crypt')).toBe(true);

    undoManager.execute(new RenameAreaCommand(id, 'crypt', 'Old Crypt'));
    undoManager.execute(new SetAreaLookCommand(id, 'crypt', { wallTextureTint: '#334455' }));
    expect(dungeon().areas![0]).toEqual({ id: 'crypt', name: 'Old Crypt', look: { wallTextureTint: '#334455' } });

    undoManager.execute(new AssignRoomsToAreaCommand(id, ['b'], null));
    expect(rooms().find((r) => r.id === 'b')).not.toHaveProperty('areaId');

    undoManager.execute(new RemoveAreaCommand(id, 'crypt'));
    expect(dungeon()).not.toHaveProperty('areas');
    expect(rooms().every((r) => r.areaId === undefined)).toBe(true);
    expect(ids()).toEqual(['hall', 'b']);

    undoManager.undo();
    expect(rooms().find((r) => r.id === 'hall')?.areaId).toBe('crypt');
  });

  it('refuses to assign rooms to an area the layer does not have', () => {
    const id = seedHall();
    undoManager.execute(new AssignRoomsToAreaCommand(id, ['hall'], 'nowhere'));
    expect(rooms()[0]).not.toHaveProperty('areaId');
  });
});

describe('levels', () => {
  const level = () => useStore.getState().levels;

  it('a new map has one level holding every layer, and it is the active one', () => {
    const s = useStore.getState();
    expect(s.levels).toHaveLength(1);
    expect(s.layers.every((l) => l.levelId === s.levels[0].id)).toBe(true);
    expect(s.ui.activeLevelId).toBe(s.levels[0].id);
  });

  it('adds, renames, pins a look on and removes a level, with undo', () => {
    undoManager.execute(new AddLevelCommand({ id: 'up', name: 'Upper' }));
    undoManager.execute(new RenameLevelCommand('up', 'Upper floor'));
    undoManager.execute(new SetLevelLookCommand('up', { floorTint: '#123456' }));
    expect(level()[1]).toEqual({ id: 'up', name: 'Upper floor', look: { floorTint: '#123456' } });
    undoManager.undo();
    expect(level()[1]).not.toHaveProperty('look');
    undoManager.undo();
    expect(level()[1].name).toBe('Upper');
    undoManager.undo();
    expect(level()).toHaveLength(1);
  });

  it('a new layer joins the level on show; switching level selects its first layer', () => {
    undoManager.execute(new AddLevelCommand({ id: 'up', name: 'Upper' }));
    useStore.getState().setActiveLevelId('up');
    const layer = createDungeonLayer('Attic');
    undoManager.execute(new AddLayerCommand('Add layer', layer));
    const added = useStore.getState().layers.find((l) => l.id === layer.id)!;
    expect(added.levelId).toBe('up');

    const ground = level()[0].id;
    useStore.getState().setActiveLevelId(ground);
    const active = useStore.getState().layers.find((l) => l.id === useStore.getState().ui.activeLayerId)!;
    expect(active.levelId).toBe(ground);
    expect(active.type).toBe('dungeon');

    useStore.getState().setActiveLayerId(layer.id);
    expect(useStore.getState().ui.activeLevelId).toBe('up');
  });

  it('moves a layer to another level and back', () => {
    undoManager.execute(new AddLevelCommand({ id: 'up', name: 'Upper' }));
    undoManager.execute(new MoveLayerToLevelCommand(dungeon().id, 'up'));
    expect(dungeon().levelId).toBe('up');
    undoManager.undo();
    expect(dungeon().levelId).toBe(level()[0].id);
  });

  it('refuses to remove the last level; removing another moves its layers to the first', () => {
    const only = new RemoveLevelCommand(level()[0].id);
    undoManager.execute(only);
    expect(only.refused).toBe(true);
    expect(level()).toHaveLength(1);

    undoManager.execute(new AddLevelCommand({ id: 'up', name: 'Upper' }));
    undoManager.execute(new MoveLayerToLevelCommand(dungeon().id, 'up'));
    useStore.getState().setActiveLevelId('up');
    undoManager.execute(new RemoveLevelCommand('up'));
    expect(level().map((l) => l.id)).not.toContain('up');
    expect(dungeon().levelId).toBe(level()[0].id);
    expect(useStore.getState().ui.activeLevelId).toBe(level()[0].id);

    undoManager.undo();
    expect(level().map((l) => l.id)).toContain('up');
    expect(dungeon().levelId).toBe('up');
  });
});

describe('room keys and the starting room', () => {
  it('writes, edits and removes one key per command', () => {
    undoManager.execute(new SetRoomKeyCommand('r1', key('r1', { notes: 'Trap door' })));
    undoManager.execute(new SetRoomKeyCommand('r1', key('r1', { notes: 'Trap door, rusted' })));
    expect(keyOf('r1')?.notes).toBe('Trap door, rusted');
    undoManager.execute(new SetRoomKeyCommand('r1', null));
    expect(keyOf('r1')).toBeUndefined();
    undoManager.undo();
    expect(keyOf('r1')?.notes).toBe('Trap door, rusted');
    undoManager.undo();
    expect(keyOf('r1')?.notes).toBe('Trap door');
    undoManager.undo();
    expect(keyOf('r1')).toBeUndefined();
    expect(useStore.getState().prep?.version).toBe(3);
  });

  it('sets and clears the starting room', () => {
    undoManager.execute(new SetStartingRoomCommand('r1'));
    expect(useStore.getState().mapSettings.startingRoomId).toBe('r1');
    undoManager.execute(new SetStartingRoomCommand(null));
    expect(useStore.getState().mapSettings).not.toHaveProperty('startingRoomId');
    undoManager.undo();
    expect(useStore.getState().mapSettings.startingRoomId).toBe('r1');
  });
});

describe('draw room', () => {
  const shape = (): ShapeChild => ({
    id: 'floor-1',
    name: 'Floor',
    childType: 'shape',
    visible: true,
    shapeType: 'rectangle',
    contours: [[[30, 0], [40, 0], [40, 10], [30, 10]]],
    textureScale: 1,
    textureOffsetX: 0,
    textureOffsetY: 0,
    textureFillRotation: 0,
    textureTint: '#ffffff',
  });

  it('lands the floor and the room together and one undo removes both', () => {
    const id = dungeon().id;
    undoManager.execute(createDrawRoomCommand(id, shape(), { id: 'new', name: 'Room 1', number: 1, anchor: [35, 5] }));
    expect(dungeon().children.map((c) => c.id)).toContain('floor-1');
    expect(ids()).toEqual(['new']);
    expect(rooms()[0].orphaned).toBeUndefined();
    undoManager.undo();
    expect(dungeon().children.map((c) => c.id)).not.toContain('floor-1');
    expect(ids()).toEqual([]);
  });

  it('with no walls, pins the floor outline to no stones', () => {
    const id = dungeon().id;
    undoManager.execute(createDrawRoomCommand(id, shape(), { id: 'new', name: 'Room 1', anchor: [35, 5] }, 'none'));
    const floor = dungeon().children.find((c) => c.id === 'floor-1')!;
    expect(floor.styleOverrides).toEqual({ wallTextureSetId: '' });
  });
});

describe('serialisation', () => {
  it('writes levels, strips every derived room field, and reads both back', () => {
    const id = seedHall();
    refreshRooms();
    expect(rooms()[0].face).toBeDefined();
    const data = useStore.getState().getSerializableState();
    expect(data.levels).toEqual(useStore.getState().levels);
    const saved = (data.layers.find((l) => l.id === id) as DungeonLayer).rooms![0];
    expect(saved).toEqual({ id: 'hall', name: 'Hall', number: 1, anchor: [4, 5] });
    // The live room keeps its face: only the copy is stripped.
    expect(rooms()[0].face).toBeDefined();

    useStore.getState().loadFromFile(structuredClone(data));
    expect(useStore.getState().levels).toEqual(data.levels);
    expect(rooms()[0]).toEqual({ id: 'hall', name: 'Hall', number: 1, anchor: [4, 5] });
  });
});
