import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { setClipperModule } from '../geometry/Clipper2Engine';
import { useStore } from './store';
import { syncRooms } from './roomSync';
import { seedRoomsFromDetection } from './seedRooms';
import { undoManager } from './undoManager';
import type { DungeonLayer, SerializedMapData } from './types';
import type { AnyChild, ConnectorChild, RoomChild, WallSegment } from '../shared/types';

/** Same wasm hand-off as roomSync.test.ts — jsdom can't fetch the .wasm. */
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

/** Splits the 20x10 floor into a left and a right half. */
const DIVIDER: WallSegment = {
  id: 'w1',
  points: [[10, 0], [10, 10]],
  wallType: 'normal',
  direction: 'both',
  color: '#333333',
  width: 0.4,
  roughness: 0,
};

function rect(x: number, y: number, w: number, h: number): [number, number][] {
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}

function roomChild(id: string, name: string, ring: [number, number][]): RoomChild {
  return { id, name, childType: 'room', visible: true, contours: [ring] };
}

function connectorChild(
  id: string,
  ring: [number, number][],
  kind: ConnectorChild['kind'] = 'arch',
): ConnectorChild {
  return {
    id,
    name: id,
    childType: 'connector',
    visible: true,
    contours: [ring],
    kind,
    state: kind === 'arch' ? 'open' : 'closed',
    isSecret: false,
  };
}

/** A v3.1 shell holding one dungeon layer with a 20x10 floor split down the middle. */
function mapWith(children: AnyChild[]): SerializedMapData {
  return {
    version: '3.1',
    mapSettings: {
      name: 'Authored',
      gridType: 'square',
      cellScale: { value: 5, unit: 'ft' },
      ambientLight: '#2d2d44',
    },
    grid: { visible: true, snapDivision: 2 },
    layers: [
      {
        id: 'layer-1',
        name: 'Layer 1',
        type: 'dungeon',
        visible: true,
        locked: false,
        opacity: 1,
        children,
        standaloneWalls: [structuredClone(DIVIDER)],
        mergedFloor: [rect(0, 0, 20, 10)],
        style: {},
        sublayerVisibility: { floor: true, grid: true, walls: true },
      },
    ],
  } as unknown as SerializedMapData;
}

function dungeon(): DungeonLayer {
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon');
  if (!l) throw new Error('no dungeon layer');
  return l;
}

function load(children: AnyChild[]): void {
  useStore.getState().resetToDefault();
  useStore.getState().loadFromFile(mapWith(children));
}

describe('A1 — a drawn room wins over detection', () => {
  beforeEach(() => undoManager.clear());

  it('detection alone finds the two halves the wall divides (A2 baseline)', () => {
    load([]);
    syncRooms();
    const rooms = dungeon().rooms ?? [];
    expect(rooms).toHaveLength(2);
    // Detected ids are the centroid hash, which is exactly what authored ids replace.
    for (const r of rooms) expect(r.id).toMatch(/^room-/);
  });

  it('one drawn room replaces both detected ones, id and name and all', () => {
    load([roomChild('rc-1', 'Great Hall', rect(2, 2, 6, 6))]);
    syncRooms();

    const rooms = dungeon().rooms ?? [];
    expect(rooms).toHaveLength(1);
    expect(rooms[0].id).toBe('rc-1');
    expect(rooms[0].name).toBe('Great Hall');
    expect(rooms[0].boundary).toEqual(rect(2, 2, 6, 6));
  });

  it('fills the whole persisted Room shape, not just id/name/boundary', () => {
    load([roomChild('rc-1', 'Great Hall', rect(0, 0, 6, 6))]);
    syncRooms();

    const room = (dungeon().rooms ?? [])[0];
    expect(room.area).toBeCloseTo(36, 6);
    expect(room.centroid[0]).toBeCloseTo(3, 6);
    expect(room.centroid[1]).toBeCloseTo(3, 6);
    expect(room.isPathway).toBe(false);
  });

  it('runs the same isPathway heuristic a detected room runs', () => {
    // Long and thin: >3:1 with a short axis inside two cells — a corridor.
    load([roomChild('rc-1', 'Passage', rect(0, 0, 18, 1))]);
    syncRooms();
    expect((dungeon().rooms ?? [])[0].isPathway).toBe(true);
  });

  it('A5 — detection still runs, its output just never lands in layer.rooms', () => {
    load([roomChild('rc-1', 'Great Hall', rect(2, 2, 6, 6))]);
    syncRooms();
    // Two rooms are there to be detected; none of them reached the layer.
    expect((dungeon().rooms ?? []).map((r) => r.id)).toEqual(['rc-1']);
  });

  it('removing the last drawn room hands the layer back to detection', () => {
    load([roomChild('rc-1', 'Great Hall', rect(2, 2, 6, 6))]);
    syncRooms();
    expect(dungeon().rooms).toHaveLength(1);

    useStore.getState().removeChild(dungeon().id, 'rc-1');
    syncRooms();
    expect(dungeon().rooms).toHaveLength(2);
  });
});

describe('A7 — renaming a drawn room survives the next resync', () => {
  beforeEach(() => {
    undoManager.clear();
    load([roomChild('rc-1', 'Room 1', rect(2, 2, 6, 6))]);
    syncRooms();
  });

  it('writes the name back to the child, so resync cannot clobber it', () => {
    useStore.getState().renameRoom(dungeon().id, 'rc-1', "Klarg's Cave");
    syncRooms();

    expect((dungeon().rooms ?? [])[0].name).toBe("Klarg's Cave");
    const child = dungeon().children.find((c): c is RoomChild => c.childType === 'room');
    expect(child?.name).toBe("Klarg's Cave");
  });
});

describe('A3 — seeding rooms from detection', () => {
  beforeEach(() => {
    undoManager.clear();
    load([]);
    syncRooms();
  });

  it('mints one child per detected room with a fresh uuid, never the centroid hash', () => {
    expect(seedRoomsFromDetection(dungeon().id)).toBe(2);

    const seeded = dungeon().children.filter((c): c is RoomChild => c.childType === 'room');
    expect(seeded).toHaveLength(2);
    for (const child of seeded) {
      expect(child.id).not.toMatch(/^room-/);
      expect(child.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(child.contours[0].length).toBeGreaterThanOrEqual(3);
    }
    // Names carry over from what detection called them.
    expect(seeded.map((c) => c.name).sort()).toEqual(
      (dungeon().rooms ?? []).map((r) => r.name).sort(),
    );
  });

  it('lands as one undo entry, not one per room', () => {
    seedRoomsFromDetection(dungeon().id);
    undoManager.undo();
    expect(dungeon().children.filter((c) => c.childType === 'room')).toHaveLength(0);
  });

  it('A1 governs afterwards — the layer takes its rooms from the seeded children', () => {
    seedRoomsFromDetection(dungeon().id);
    const ids = dungeon()
      .children.filter((c): c is RoomChild => c.childType === 'room')
      .map((c) => c.id);

    syncRooms();
    expect((dungeon().rooms ?? []).map((r) => r.id).sort()).toEqual([...ids].sort());
  });

  it('does nothing on a layer that already has drawn rooms', () => {
    load([roomChild('rc-1', 'Great Hall', rect(2, 2, 6, 6))]);
    syncRooms();
    expect(seedRoomsFromDetection(dungeon().id)).toBe(0);
    expect(dungeon().children.filter((c) => c.childType === 'room')).toHaveLength(1);
  });
});

describe('C2 — a connector binds the two rooms its blob covers', () => {
  const LEFT = roomChild('left', 'Left', rect(0, 0, 8, 8));
  const RIGHT = roomChild('right', 'Right', rect(10, 0, 8, 8));

  beforeEach(() => undoManager.clear());

  function connector(): ConnectorChild {
    const c = dungeon().children.find((x): x is ConnectorChild => x.childType === 'connector');
    if (!c) throw new Error('no connector');
    return c;
  }

  it('straddling two rooms binds one to each side', () => {
    load([LEFT, RIGHT, connectorChild('c1', rect(6, 3, 6, 2))]);
    syncRooms();
    expect([connector().roomA, connector().roomB].sort()).toEqual(['left', 'right']);
  });

  it('overlapping only one room stays unbound rather than half-bound', () => {
    load([LEFT, RIGHT, connectorChild('c1', rect(2, 3, 2, 2))]);
    syncRooms();
    expect(connector().roomA).toBeNull();
    expect(connector().roomB).toBeNull();
  });

  it('overlapping none stays unbound', () => {
    load([LEFT, RIGHT, connectorChild('c1', rect(50, 50, 2, 2))]);
    syncRooms();
    expect(connector().roomA).toBeNull();
    expect(connector().roomB).toBeNull();
  });

  it('overlapping three takes the two largest overlaps', () => {
    // A tall blob crossing left and right deeply, and clipping a third room by a sliver.
    const TINY = roomChild('tiny', 'Tiny', rect(8, 9, 2, 4));
    load([LEFT, RIGHT, TINY, connectorChild('c1', rect(4, 2, 10, 8))]);
    syncRooms();
    expect([connector().roomA, connector().roomB].sort()).toEqual(['left', 'right']);
  });

  it('binds against detected rooms too when nothing is drawn', () => {
    load([connectorChild('c1', rect(8, 4, 4, 2))]);
    syncRooms();
    expect(connector().roomA).toMatch(/^room-/);
    expect(connector().roomB).toMatch(/^room-/);
    expect(connector().roomA).not.toBe(connector().roomB);
  });

  it('is derived, not authored — rebinding never lands on the undo stack', () => {
    load([LEFT, RIGHT, connectorChild('c1', rect(6, 3, 6, 2))]);
    undoManager.clear();
    syncRooms();
    expect(undoManager.canUndo()).toBe(false);
  });
});

describe('E1 — rooms and connectors survive a serialization round trip', () => {
  it('load → serialize → load keeps ids, geometry and door fields', () => {
    load([
      roomChild('rc-1', 'Great Hall', rect(2, 2, 6, 6)),
      connectorChild('c1', rect(6, 3, 6, 2), 'door'),
    ]);

    const serialized = JSON.parse(
      JSON.stringify(useStore.getState().getSerializableState()),
    ) as SerializedMapData;
    useStore.getState().resetToDefault();
    useStore.getState().loadFromFile(serialized);

    const room = dungeon().children.find((c): c is RoomChild => c.childType === 'room');
    expect(room).toMatchObject({
      id: 'rc-1',
      name: 'Great Hall',
      childType: 'room',
      contours: [rect(2, 2, 6, 6)],
    });

    const connector = dungeon().children.find(
      (c): c is ConnectorChild => c.childType === 'connector',
    );
    expect(connector).toMatchObject({
      id: 'c1',
      childType: 'connector',
      kind: 'door',
      state: 'closed',
      isSecret: false,
      contours: [rect(6, 3, 6, 2)],
    });
  });
});
