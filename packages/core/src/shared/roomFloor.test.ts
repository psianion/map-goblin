// Rooms on every kind of floor (rooms plan §3, §8): passages split by Suggest, ground closed in
// by walls, outlined rooms, the smallest room answering a point, and the owner's maps unchanged.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { clipper2Engine, setClipperModule } from '../geometry/Clipper2Engine';
import { computeMergedFloor } from '../engine/mergedFloor';
import { suggestDivides, suggestRooms } from './suggestRooms';
import { NO_ROOM_CONTEXT, outlineFace, roomContextOf, roomFacesOf, type RoomContext } from './roomFloor';
import { syncRooms } from '../store/roomSync';
import { migrateRooms } from '../store/roomMigration';
import { buildRoomIndex } from './roomIndex';
import { computeArea, pointInRing } from './roomUtils';
import type { DungeonLayer, SerializedMapData } from '../store/types';
import type { DoorChild, Room, ShapeChild, WallSegment } from './types';

let fs: { readFileSync(p: string): Uint8Array };
let gunzip: (b: Uint8Array) => Uint8Array;
let root = '';

beforeAll(async () => {
  fs = (await import('node:fs' as string)) as typeof fs;
  gunzip = ((await import('node:zlib' as string)) as { gunzipSync: typeof gunzip }).gunzipSync;
  const { createRequire } = await import('node:module' as string);
  const { resolve } = await import('node:path' as string);
  root = resolve(process.cwd(), '../../session/testdata');
  const wasmBinary = fs.readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  const clipper: MainModule = await mod.default({ wasmBinary });
  setClipperModule(clipper);
}, 30_000);

type Ring = [number, number][];
const rect = (x0: number, y0: number, x1: number, y1: number): Ring => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

function shape(id: string, ring: Ring, extra: Partial<ShapeChild> = {}): ShapeChild {
  return { id, name: id, childType: 'shape', shapeType: 'polygon', visible: true, locked: false, contours: [ring], ...extra } as unknown as ShapeChild;
}

const wall = (id: string, points: Ring): WallSegment => ({ id, points, wallType: 'normal', direction: 'both', color: '#000000', width: 0.5, roughness: 0 });

function layer(patch: Partial<DungeonLayer>): DungeonLayer {
  return {
    id: 'l',
    name: 'l',
    type: 'dungeon',
    levelId: 'lvl',
    visible: true,
    locked: false,
    opacity: 1,
    children: [],
    standaloneWalls: [],
    thresholds: [],
    rooms: [],
    mergedFloor: null,
    style: { wallWidth: 0.5 } as DungeonLayer['style'],
    sublayerVisibility: { floor: true, grid: true, walls: true },
    ...patch,
  };
}

/** Accept every ghost and divide line, as the editor's Accept all does, then sync. */
function acceptAndSync(l: DungeonLayer, ctx: RoomContext, divides = suggestDivides(l, ctx)) {
  const ghosts = suggestRooms(l, ctx, divides);
  const accepted = layer({ ...l, thresholds: [...(l.thresholds ?? []), ...divides], rooms: [...(l.rooms ?? []), ...ghosts.map(({ face: _face, ...r }) => r)] });
  return { ghosts, accepted, rooms: syncRooms(accepted, 1, ctx).rooms };
}

/** The owner's "FA cave dungeon": four chambers joined by three passages two cells wide. */
const FA_CAVE: Ring[] = [
  [[2, 3], [11, 3], [11, 12], [2, 12]],
  [[10, 6], [16, 6], [16, 8], [10, 8]],
  [[15, 2], [27, 2], [27, 13], [15, 13]],
  [[5, 11], [7, 11], [7, 19], [5, 19]],
  [[3, 18], [13, 18], [13, 27], [3, 27]],
  [[12, 21], [18, 21], [18, 23], [12, 23]],
  [[17, 17], [26, 17], [26, 26], [17, 26]],
];
const FA_CTX: RoomContext = { frame: { minX: 0, minY: 0, maxX: 30, maxY: 30 }, baseGround: true };
const faCave = () => layer({ children: FA_CAVE.map((ring, i) => shape(`f${i}`, ring)) });

function readMap(file: string): SerializedMapData {
  const bytes = fs.readFileSync(`${root}/${file}`);
  const head = new TextDecoder().decode(bytes.subarray(0, 5));
  const text = new TextDecoder().decode(head === 'MPBLD' ? gunzip(bytes.subarray(6)) : bytes);
  const data = migrateRooms(JSON.parse(text) as SerializedMapData);
  for (const l of data.layers) {
    if (l.type !== 'dungeon') continue;
    l.children ??= [];
    l.standaloneWalls ??= [];
  }
  return data;
}

const dungeon = (data: SerializedMapData) => data.layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
const areaOf = (rooms: Room[], name: string) => +computeArea(rooms.find((r) => r.name === name)!.face!).toFixed(1);

describe('passages split a joined floor (Suggest)', () => {
  it('gives the seven joined cave floors four chambers and three passages', () => {
    const l = faCave();
    const divides = suggestDivides(l, FA_CTX);
    expect(divides).toHaveLength(6);
    for (const d of divides) expect(d.id).toMatch(/^[0-9a-f-]{36}$/);
    const ghosts = suggestRooms(l, FA_CTX, divides);
    expect(ghosts.filter((g) => g.name.startsWith('Room '))).toHaveLength(4);
    expect(ghosts.filter((g) => g.name.startsWith('Passage '))).toHaveLength(3);
    // One numbering run for rooms and passages.
    expect(ghosts.map((g) => g.number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('keeps a distinct face for every accepted room after the sync', () => {
    const { ghosts, rooms } = acceptAndSync(faCave(), FA_CTX);
    expect(rooms).toHaveLength(7);
    expect(rooms.every((r) => !r.orphaned)).toBe(true);
    expect(new Set(rooms.map((r) => JSON.stringify(r.face))).size).toBe(7);
    for (const g of ghosts) expect(computeArea(rooms.find((r) => r.id === g.id)!.face!)).toBeCloseTo(computeArea(g.face!), 6);
  });

  it('proposes no line through a floor that is one space', () => {
    expect(suggestDivides(layer({ children: [shape('a', rect(0, 0, 10, 8))] }), FA_CTX)).toEqual([]);
    expect(suggestDivides(layer({ children: [shape('a', rect(0, 0, 12, 2))] }), FA_CTX)).toEqual([]);
  });

  it('runs Suggest on the seven floors inside its budget', () => {
    const l = faCave();
    const t = performance.now();
    suggestRooms(l, FA_CTX, suggestDivides(l, FA_CTX));
    // The plan's budget is 150 ms; the margin is for a loaded test machine.
    expect(performance.now() - t).toBeLessThan(600);
  });
});

describe('ground counts as floor where walls close it in', () => {
  const yard = (doors: DoorChild[] = [], gap = false) =>
    layer({
      // The yard's south wall leaves a two-cell gap between x 9 and 11 when `gap`.
      standaloneWalls: gap
        ? [wall('w', [[9, 12], [4, 12], [4, 4], [16, 4], [16, 12], [11, 12]])]
        : [wall('w', [[4, 4], [16, 4], [16, 12], [4, 12], [4, 4]])],
      children: doors,
    });
  const door: DoorChild = {
    id: 'd', name: 'Gate', childType: 'door', visible: true, wallId: '', position: [10, 12], angle: 0, width: 2,
    style: 'single', state: 'closed', isSecret: false,
  } as DoorChild;
  const onGround: RoomContext = { frame: { minX: 0, minY: 0, maxX: 20, maxY: 20 }, baseGround: true };

  it('suggests a walled yard on base ground, and not one with a gap in its walls', () => {
    expect(suggestRooms(yard(), onGround)).toHaveLength(1);
    expect(suggestRooms(yard([], true), onGround)).toEqual([]);
  });

  it('suggests the yard once a door stands in the gap', () => {
    expect(suggestRooms(yard([door], true), onGround)).toHaveLength(1);
  });

  it('suggests nothing on base ground alone, with or without a stray wall', () => {
    expect(suggestRooms(layer({}), onGround)).toEqual([]);
    expect(suggestRooms(layer({ standaloneWalls: [wall('w', [[2, 2], [8, 2]])] }), onGround)).toEqual([]);
  });

  it('places accepted rooms on walls over ground pieces: none is orphaned', () => {
    const l = layer({
      children: [shape('g', rect(0, 0, 20, 10), { ground: true })],
      standaloneWalls: [wall('a', [[2, 2], [8, 2], [8, 8], [2, 8], [2, 2]]), wall('b', [[12, 2], [18, 2], [18, 8], [12, 8], [12, 2]])],
    });
    const ctx: RoomContext = { frame: { minX: -2, minY: -2, maxX: 22, maxY: 12 }, baseGround: false };
    const { ghosts, rooms } = acceptAndSync(l, ctx);
    expect(ghosts).toHaveLength(2);
    expect(rooms.every((r) => !r.orphaned && (r.face?.length ?? 0) >= 3)).toBe(true);
    // The open ground round the two rooms is never a room of its own.
    expect(roomFacesOf(l, ctx)).toHaveLength(2);
  });

  it('places rooms on a walls-only import the way Suggest found them', () => {
    const l = layer({ standaloneWalls: [wall('a', [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]])] });
    const ctx: RoomContext = { frame: { minX: -2, minY: -2, maxX: 12, maxY: 12 }, baseGround: false };
    const { rooms } = acceptAndSync(l, ctx);
    expect(rooms).toHaveLength(1);
    expect(rooms[0].orphaned).toBeUndefined();
  });

  it('leaves a walled floor’s faces exactly as they were', () => {
    const l = layer({ children: [shape('f', rect(0, 0, 10, 10))], standaloneWalls: [wall('w', [[0, 5], [10, 5]])] });
    const before = roomFacesOf(l, NO_ROOM_CONTEXT);
    const after = roomFacesOf(l, { frame: { minX: -5, minY: -5, maxX: 15, maxY: 15 }, baseGround: true });
    expect(after).toEqual(before);
  });
});

describe('Suggest on floors painted as ground, with no walls', () => {
  // The Floor tool's default: ground pieces, here over base ground.
  const painted = () => layer({ children: FA_CAVE.map((ring, i) => shape(`g${i}`, ring, { ground: true, textureId: 'stone' })) });

  it('gives the seven painted rectangles four rooms and three passages, each a pinned room', () => {
    const l = painted();
    const divides = suggestDivides(l, FA_CTX);
    expect(divides).toHaveLength(6);
    const ghosts = suggestRooms(l, FA_CTX, divides);
    expect(ghosts).toHaveLength(7);
    expect(ghosts.filter((g) => g.name.startsWith('Room '))).toHaveLength(4);
    expect(ghosts.filter((g) => g.name.startsWith('Passage '))).toHaveLength(3);
    for (const g of ghosts) {
      expect(g.boundary).toBeUndefined();
      expect(pointInRing(g.anchor[0], g.anchor[1], g.face!)).toBe(true);
    }
  });

  it('keeps seven distinct faces after accept and sync, and a second Suggest proposes nothing', () => {
    const { ghosts, accepted, rooms } = acceptAndSync(painted(), FA_CTX);
    expect(ghosts).toHaveLength(7);
    expect(rooms).toHaveLength(7);
    expect(rooms.every((r) => !r.orphaned && !r.boundary && (r.face?.length ?? 0) >= 3)).toBe(true);
    expect(new Set(rooms.map((r) => JSON.stringify(r.face))).size).toBe(7);
    for (const g of ghosts) expect(computeArea(rooms.find((r) => r.id === g.id)!.face!)).toBeCloseTo(computeArea(g.face!), 6);
    const synced = layer({ ...accepted, rooms });
    expect(suggestDivides(synced, FA_CTX)).toEqual([]);
    expect(suggestRooms(synced, FA_CTX, [])).toEqual([]);
  });

  it('a room follows its painted floor: growing the floor grows the room', () => {
    const { accepted, rooms } = acceptAndSync(painted(), FA_CTX);
    // The south-east chamber, piece g6, grown two cells east.
    const roomOf = (rs: Room[]) => rs.find((r) => pointInRing(21, 21, r.face!))!;
    const was = computeArea(roomOf(rooms).face!);
    const grown = layer({
      ...accepted,
      rooms,
      children: accepted.children.map((c) => (c.id === 'g6' ? { ...(c as ShapeChild), contours: [rect(17, 17, 28, 26)] } : c)),
    });
    const now = syncRooms(grown, 1, FA_CTX).rooms;
    expect(computeArea(roomOf(now).face!)).toBeCloseTo(was + 18, 6);
    expect(now.every((r) => !r.orphaned)).toBe(true);
  });

  it('keeps all seven placed when a wall is added elsewhere on the layer', () => {
    const { accepted, rooms } = acceptAndSync(painted(), FA_CTX);
    const walled = layer({ ...accepted, rooms, standaloneWalls: [wall('far', [[40, 40], [48, 40]])] });
    const now = syncRooms(walled, 1, FA_CTX).rooms;
    expect(now.every((r) => !r.orphaned)).toBe(true);
    expect(now.map((r) => r.face)).toEqual(rooms.map((r) => r.face));
  });

  it('leaves a pin on bare base ground orphaned', () => {
    const l = layer({ ...painted(), rooms: [{ id: 'bare', name: 'Bare', anchor: [29, 1] }] });
    expect(syncRooms(l, 1, FA_CTX).rooms[0].orphaned).toBe(true);
  });

  it('keeps two touching patches of different textures apart', () => {
    const l = layer({
      children: [shape('a', rect(0, 0, 6, 6), { ground: true, textureId: 'grass' }), shape('b', rect(6, 0, 12, 6), { ground: true, textureId: 'dirt' })],
    });
    const ghosts = suggestRooms(l, FA_CTX, suggestDivides(l, FA_CTX));
    expect(ghosts).toHaveLength(2);
    expect(ghosts.map((g) => computeArea(g.face!)).sort()).toEqual([36, 36]);
  });

  it('proposes nothing for the patches on a layer with a walled floor', () => {
    const l = layer({
      children: [shape('f', rect(0, 0, 6, 6)), shape('p', rect(20, 0, 26, 6), { ground: true, textureId: 'grass' })],
    });
    const ghosts = suggestRooms(l, FA_CTX, suggestDivides(l, FA_CTX));
    expect(ghosts.every((g) => g.face!.every(([x]) => x <= 6))).toBe(true);
    expect(ghosts.every((g) => !g.boundary)).toBe(true);
  });
});

describe('short walls and doors close the gaps they nearly span', () => {
  const room = (gapAtEnd: number) =>
    layer({ children: [shape('f', rect(0, 0, 10, 6))], standaloneWalls: [wall('w', [[5, -0.2], [5, 6 - gapAtEnd]])] });

  it('a wall 0.5 of a cell short of the edge seals; 1.5 and a full cell short do not', () => {
    expect(roomFacesOf(room(0.5), NO_ROOM_CONTEXT)).toHaveLength(2);
    expect(roomFacesOf(room(1.5), NO_ROOM_CONTEXT)).toHaveLength(1);
    expect(roomFacesOf(room(1), NO_ROOM_CONTEXT)).toHaveLength(1);
  });

  it('a door across a gap on walled floor is a room edge, with no wall under it', () => {
    const door = {
      id: 'd', name: 'Door', childType: 'door', visible: true, wallId: '', position: [5, 3], angle: Math.PI / 2, width: 5.2,
      style: 'single', state: 'closed', isSecret: false, freestanding: true,
    } as DoorChild;
    expect(roomFacesOf(layer({ children: [shape('f', rect(0, 0, 10, 6)), door] }), NO_ROOM_CONTEXT)).toHaveLength(2);
  });

  // The owner's cave: the seven floors, a short wall with its door inside each end of every passage.
  const SHORT_WALLS: Ring[] = [
    [[5.12, 17.54], [6.5, 17.54]],
    [[13.28, 21.56], [13.28, 22.45]],
    [[16.91, 22.5], [16.91, 21.49]],
    [[5.52, 12.38], [6.46, 12.38]],
    [[11.15, 7.48], [11.15, 6.53]],
    [[14.66, 7.45], [14.66, 6.53]],
  ];
  const DOORS: [number, number, number, number][] = [
    [5.81, 17.54, 0, 1.38],
    [13.28, 22.01, 1.57, 0.88],
    [16.91, 22, -1.57, 1.01],
    [5.99, 12.38, 0, 0.94],
    [11.15, 7.005, -Math.PI / 2, 0.95],
    [14.66, 6.99, -Math.PI / 2, 0.92],
  ];
  const doored = () =>
    layer({
      children: [
        ...FA_CAVE.map((ring, i) => shape(`f${i}`, ring)),
        ...DOORS.map(([x, y, angle, width], i) => ({
          id: `d${i}`, name: `Door ${i}`, childType: 'door', visible: true, wallId: `w${i}`, position: [x, y], angle, width,
          style: 'single', state: 'closed', isSecret: false, freestanding: true,
        }) as DoorChild),
      ],
      standaloneWalls: SHORT_WALLS.map((points, i) => wall(`w${i}`, points)),
    });
  /** The four chambers' centres, and each chamber shrunk half a cell. */
  const CHAMBERS = [FA_CAVE[0], FA_CAVE[2], FA_CAVE[4], FA_CAVE[6]];
  const centre = (r: Ring): [number, number] => [(r[0][0] + r[2][0]) / 2, (r[0][1] + r[2][1]) / 2];

  it('gives the four chambers four ghosts, none named Passage, and runs no line into a chamber', () => {
    const l = doored();
    const divides = suggestDivides(l, FA_CTX);
    const ghosts = suggestRooms(l, FA_CTX, divides);
    expect(ghosts.length).toBeGreaterThanOrEqual(4);
    const holders = CHAMBERS.map((r) => ghosts.filter((g) => pointInRing(...centre(r), g.face!)));
    for (const h of holders) expect(h).toHaveLength(1);
    expect(new Set(holders.map((h) => h[0].id)).size).toBe(4);
    for (const [g] of holders) expect(g.name).toMatch(/^Room \d+$/);
    for (const d of divides) {
      const [[x0, y0], [x1, y1]] = d.points;
      for (let t = 0; t <= 1; t += 0.02) {
        const [x, y] = [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
        for (const r of CHAMBERS) expect(x > r[0][0] + 0.5 && x < r[2][0] - 0.5 && y > r[0][1] + 0.5 && y < r[2][1] - 0.5).toBe(false);
      }
    }
  });

  it('keeps every accepted ghost’s face through the sync, distinct and none orphaned', () => {
    const { ghosts, rooms } = acceptAndSync(doored(), FA_CTX);
    expect(rooms.every((r) => !r.orphaned)).toBe(true);
    expect(new Set(rooms.map((r) => JSON.stringify(r.face))).size).toBe(rooms.length);
    for (const g of ghosts) expect(computeArea(rooms.find((r) => r.id === g.id)!.face!)).toBeCloseTo(computeArea(g.face!), 6);
  });

  it('splits a walled cave on base ground beside a stray wall, with no cave edge cutting it', () => {
    // The ground's hole where the walled floor lies is no hole in the walled floor.
    const l = layer({ ...faCave(), standaloneWalls: [wall('stray', [[28, 28], [29, 28]])] });
    const divides = suggestDivides(l, FA_CTX);
    expect(divides).toHaveLength(6);
    const ghosts = suggestRooms(l, FA_CTX, divides);
    expect(ghosts.filter((g) => g.name.startsWith('Room '))).toHaveLength(4);
    expect(ghosts.filter((g) => g.name.startsWith('Passage '))).toHaveLength(3);
  });
});

describe('outlined rooms', () => {
  const cave = layer({ children: [shape('c', rect(0, 0, 10, 10)), shape('p', rect(10, 4, 16, 6))] });

  it('cuts an outline over a cave chamber down to the floor under it', () => {
    const face = outlineFace(cave, NO_ROOM_CONTEXT, rect(-2, -2, 11, 12))!;
    // The chamber, and the cell of passage the outline also covers.
    expect(computeArea(face)).toBeCloseTo(102, 6);
    expect(face.every(([x, y]) => x >= 0 && y >= 0 && y <= 10)).toBe(true);
  });

  it('keeps an outline as drawn on a picture-only map, and refuses one under three points', () => {
    const picture = layer({});
    expect(outlineFace(picture, NO_ROOM_CONTEXT, rect(1, 1, 4, 4))).toEqual(rect(1, 1, 4, 4));
    expect(outlineFace(picture, NO_ROOM_CONTEXT, [[0, 0], [1, 1]])).toBeNull();
  });

  it('gives an outlined room its cut face in the sync, and orphans one over no floor', () => {
    const l = layer({
      ...cave,
      rooms: [
        { id: 'o', name: 'Outlined', anchor: [5, 5], boundary: rect(-2, -2, 11, 12) },
        { id: 'v', name: 'Void', anchor: [30, 30], boundary: rect(28, 28, 32, 32) },
      ],
    });
    const [outlined, voidRoom] = syncRooms(l, 1, NO_ROOM_CONTEXT).rooms;
    expect(computeArea(outlined.face!)).toBeCloseTo(102, 6);
    expect(voidRoom.orphaned).toBe(true);
  });
});

describe('the smallest room holding a point', () => {
  const outer: Room = { id: 'outer', name: 'Field', anchor: [1, 1], face: rect(0, 0, 20, 20) };
  const inner: Room = { id: 'inner', name: 'Hut', anchor: [5, 5], face: rect(4, 4, 8, 8) };

  it('answers the inner room, whichever order the rooms come in', () => {
    expect(buildRoomIndex([outer, inner]).roomAt(5, 5)?.id).toBe('inner');
    expect(buildRoomIndex([inner, outer]).roomAt(5, 5)?.id).toBe('inner');
    expect(buildRoomIndex([outer, inner]).roomAt(15, 15)?.id).toBe('outer');
  });

  it('still prefers a live room over an orphan’s stale face', () => {
    const stale: Room = { ...inner, id: 'stale', orphaned: true, face: rect(4.5, 4.5, 6, 6) };
    expect(buildRoomIndex([stale, outer]).roomAt(5, 5)?.id).toBe('outer');
  });

  it('gives a pin inside a sealed inner chamber that chamber, not the floor round it', () => {
    const l = layer({
      children: [shape('ring', rect(0, 0, 20, 20)), shape('core', rect(8, 8, 12, 12))],
      standaloneWalls: [wall('w', [[7, 7], [13, 7], [13, 13], [7, 13], [7, 7]])],
      rooms: [{ id: 'core', name: 'Core', anchor: [10, 10] }, { id: 'hall', name: 'Hall', anchor: [2, 2] }],
    });
    const [core, hall] = syncRooms(l, 1, NO_ROOM_CONTEXT).rooms;
    expect(computeArea(core.face!)).toBeLessThan(computeArea(hall.face!));
    expect(pointInRing(10, 10, core.face!)).toBe(true);
  });
});

describe("the owner's maps keep their rooms", () => {
  it('testing-cave: four rooms keep today’s faces, and Suggest offers nothing under a square cell', () => {
    const data = readMap('testing-cave.ggvtt');
    const l = dungeon(data);
    const ctx = roomContextOf(data, l);
    const { rooms } = syncRooms(l, 1, ctx);
    expect(rooms.map((r) => [r.name, areaOf(rooms, r.name), !!r.orphaned])).toEqual([
      ['Cave Ent.', 37.3, false],
      ['BLOO', 29.1, false],
      ['YELLO', 24.5, false],
      ['GREE', 25.5, false],
    ]);
    // Exactly the faces the walled floor alone gives them.
    expect(rooms.map((r) => r.face)).toEqual(syncRooms(l, 1, NO_ROOM_CONTEXT).rooms.map((r) => r.face));
    for (const ghost of suggestRooms(l, ctx, suggestDivides(l, ctx))) expect(computeArea(ghost.face!)).toBeGreaterThanOrEqual(1);
  });

  it('testing-cave as saved: Suggest proposes no line and no room, so no passage is cut off a room', () => {
    const data = readMap('testing-cave.ggvtt');
    const l = dungeon(data);
    const ctx = roomContextOf(data, l);
    expect(suggestDivides(l, ctx)).toEqual([]);
    expect(suggestRooms(l, ctx, [])).toEqual([]);
  });

  it('testing-cave without its divide lines: Suggest puts the four pins in four faces with three lines', () => {
    const data = readMap('testing-cave.ggvtt');
    const l = { ...dungeon(data), thresholds: [] };
    const ctx = roomContextOf(data, l);
    const divides = suggestDivides(l, ctx);
    expect(divides).toHaveLength(3);
    const faces = roomFacesOf(l, ctx, divides);
    const held = (l.rooms ?? []).map((r) => {
      let best = -1;
      faces.forEach((f, i) => {
        if (pointInRing(r.anchor[0], r.anchor[1], f) && (best < 0 || computeArea(f) < computeArea(faces[best]))) best = i;
      });
      return best;
    });
    expect(held.every((i) => i >= 0)).toBe(true);
    expect(new Set(held).size).toBe(4);
  });

  it('goblin-warren (both copies): rooms and faces unchanged', () => {
    for (const file of ['goblin-warren.mapbuilder', 'goblin-warren-lit.ggvtt']) {
      const data = readMap(file);
      const l = dungeon(data);
      const { rooms } = syncRooms(l, 1, roomContextOf(data, l));
      expect(rooms.map((r) => r.face)).toEqual(syncRooms(l, 1, NO_ROOM_CONTEXT).rooms.map((r) => r.face));
      expect(rooms.map((r) => [r.name, areaOf(rooms, r.name)])).toEqual([
        ['Fungus Grotto', 219.6],
        ['Plunder Nook', 169.6],
        ["Chief's Den", 186.5],
        ['Warren Hall', 293.9],
        ['Web Gallery', 243.2],
        ['Cave Mouth', 92.6],
        ['Hidden Vein', 109],
      ]);
      expect(rooms.some((r) => r.orphaned)).toBe(false);
    }
  });
});

describe('the sync’s cost', () => {
  it('cuts the floor at most twice per sync and unions no floor when the layer has its merged floor', () => {
    const data = readMap('testing-cave.ggvtt');
    const l = dungeon(data);
    const ready = { ...l, mergedFloor: computeMergedFloor(l) };
    const ctx = roomContextOf(data, l);
    const union = vi.spyOn(clipper2Engine, 'union');
    const difference = vi.spyOn(clipper2Engine, 'difference');
    try {
      syncRooms(ready, 1, ctx);
      // The cave's own ring union is memoised per children array; the sync adds no floor union.
      expect(union.mock.calls.length).toBeLessThanOrEqual(1);
      // The walled floor's cut, and the base ground's (a wall stands on this layer).
      expect(difference.mock.calls.length).toBeLessThanOrEqual(2);
      union.mockClear();
      difference.mockClear();
      // A walled layer with no ground takes the old path: one cut.
      syncRooms(layer({ mergedFloor: [rect(0, 0, 10, 10)], standaloneWalls: [wall('w', [[0, 5], [10, 5]])], rooms: [{ id: 'r', name: 'r', anchor: [2, 2] }] }), 1, NO_ROOM_CONTEXT);
      expect(union).not.toHaveBeenCalled();
      expect(difference).toHaveBeenCalledTimes(1);
      union.mockClear();
      difference.mockClear();
      // The same walled layer on base ground, every pin on the walled floor: the ground is never
      // cut, so it costs exactly the one cut it did before ground counted.
      const onBase: RoomContext = { frame: { minX: -2, minY: -2, maxX: 12, maxY: 12 }, baseGround: true };
      const walled = layer({
        mergedFloor: [rect(0, 0, 10, 10)],
        standaloneWalls: [wall('w', [[0, 5], [10, 5]])],
        rooms: [{ id: 'a', name: 'a', anchor: [2, 2] }, { id: 'b', name: 'b', anchor: [2, 8] }],
      });
      const placed = syncRooms(walled, 1, onBase).rooms;
      expect(union).not.toHaveBeenCalled();
      expect(difference).toHaveBeenCalledTimes(1);
      expect(placed.every((r) => !r.orphaned)).toBe(true);
      expect(placed.map((r) => r.face)).toEqual(syncRooms(walled, 1, NO_ROOM_CONTEXT).rooms.map((r) => r.face));
      // Seven pins on painted floor: the painted areas are cut once for the whole sync.
      difference.mockClear();
      const { accepted, rooms: paintedRooms } = acceptAndSync(
        layer({ children: FA_CAVE.map((ring, i) => shape(`g${i}`, ring, { ground: true, textureId: 'stone' })) }),
        NO_ROOM_CONTEXT,
      );
      difference.mockClear();
      expect(syncRooms(layer({ ...accepted, rooms: paintedRooms }), 1, NO_ROOM_CONTEXT).rooms.every((r) => !r.orphaned)).toBe(true);
      expect(difference).toHaveBeenCalledTimes(1);
      // A pin off the walled floor still finds its closed ground face.
      difference.mockClear();
      const yard = layer({ ...walled, standaloneWalls: [...walled.standaloneWalls, wall('y', [[10, 0], [11, 0]])], rooms: [{ id: 'out', name: 'out', anchor: [11, 11] }] });
      syncRooms(yard, 1, onBase);
      expect(difference.mock.calls.length).toBeGreaterThan(1);
    } finally {
      union.mockRestore();
      difference.mockRestore();
    }
  });
});
