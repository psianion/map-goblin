import { describe, it, expect, beforeAll } from 'vitest';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { clipper2Engine, setClipperModule } from '../geometry/Clipper2Engine';
import type { Polygon } from '../geometry/GeometryEngine';
import { detectRooms } from './roomDetection';
import { bindDoorToRooms } from '../shared/roomBinding';
import type { DoorChild, Room, WallSegment } from '../shared/types';

/**
 * jsdom sends emscripten down the browser path, where it tries to `fetch` the
 * .wasm over HTTP and fails under vitest — so hand it the bytes directly.
 */
beforeAll(async () => {
  // `as string` keeps these untyped — the package has no @types/node.
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(
    createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'),
  );
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  const clipper: MainModule = await mod.default({ wasmBinary });
  setClipperModule(clipper);
}, 30_000);

const GRID = 1;

type Rect = [number, number, number, number]; // x0, y0, x1, y1

function rectPoly([x0, y0, x1, y1]: Rect): Polygon {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

/** One wall per rect, drawn as a closed polyline — how a user encloses a space. */
function rectWall(id: string, [x0, y0, x1, y1]: Rect): WallSegment {
  return {
    id: `wall-${id}`,
    points: [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]],
    wallType: 'normal',
    direction: 'both',
    color: '#333333',
    width: 0.4,
    roughness: 0,
  };
}

function plainWall(id: string, points: [number, number][]): WallSegment {
  return {
    id, points, wallType: 'normal', direction: 'both',
    color: '#333333', width: 0.4, roughness: 0,
  };
}

describe('detectRooms — basics', () => {
  it('returns nothing when there is no floor', () => {
    expect(detectRooms([], [], GRID)).toEqual([]);
  });

  it('treats an unwalled floor as one big room', () => {
    const rooms = detectRooms([rectPoly([0, 0, 10, 10])], [], GRID);
    expect(rooms).toHaveLength(1);
    expect(rooms[0].area).toBeCloseTo(100);
    expect(rooms[0].isPathway).toBe(false);
  });

  it('splits a floor in two when a wall crosses it', () => {
    const rooms = detectRooms(
      [rectPoly([0, 0, 10, 10])],
      [plainWall('w1', [[0, 5], [10, 5]])],
      GRID,
    );
    expect(rooms).toHaveLength(2);
    // Clipper2 snaps output coordinates to 1/64 of a world unit, so areas land
    // within ~0.1% of nominal rather than exactly on it.
    for (const room of rooms) expect(room.area).toBeCloseTo(48, 1);
  });

  it('flags a narrow floor as a pathway', () => {
    const rooms = detectRooms([rectPoly([0, 0, 10, 1.5])], [], GRID);
    expect(rooms).toHaveLength(1);
    expect(rooms[0].isPathway).toBe(true);
  });

  it('counts a sealed inner chamber but not the hole around it', () => {
    // A wall loop inside the floor yields three Clipper paths: the outer floor,
    // the hole it punches (negative winding), and the island inside the loop.
    // Only the two positive ones are rooms.
    const rooms = detectRooms([rectPoly([0, 0, 10, 10])], [rectWall('inner', [4, 4, 6, 6])], GRID);
    expect(rooms).toHaveLength(2);
    const areas = rooms.map((r) => r.area).sort((a, b) => a - b);
    expect(areas[0]).toBeCloseTo(2.56, 1); // island: 1.6 x 1.6
    // Room.boundary is a single ring, so the outer room reports its outline
    // area — the hole the wall loop punched is not subtracted.
    expect(areas[1]).toBeCloseTo(100, 1);
  });

  it('applies name overrides', () => {
    const floor = [rectPoly([0, 0, 10, 10])];
    const id = detectRooms(floor, [], GRID)[0].id;
    expect(detectRooms(floor, [], GRID, { [id]: "Klarg's Cave" })[0].name).toBe("Klarg's Cave");
  });
});

// ── Cragmaw-style fixture: 8 chambers linked by 7 narrow corridors ──────────
const CHAMBERS: Record<string, Rect> = {
  R1: [0, 0, 8, 6],
  R2: [14, 0, 22, 6],
  R3: [28, 0, 34, 8],
  R4: [0, 12, 6, 20],
  R5: [12, 12, 20, 18],
  R6: [26, 12, 34, 20],
  R7: [0, 26, 10, 32],
  R8: [16, 26, 24, 34],
};

/** Each corridor records the two chambers it joins, in end order. */
const CORRIDORS: Record<string, { rect: Rect; ends: [string, string] }> = {
  C1: { rect: [8, 2, 14, 3], ends: ['R1', 'R2'] },
  C2: { rect: [22, 2, 28, 3], ends: ['R2', 'R3'] },
  C3: { rect: [2, 6, 3, 12], ends: ['R1', 'R4'] },
  C4: { rect: [16, 6, 17, 12], ends: ['R2', 'R5'] },
  C5: { rect: [30, 8, 31, 12], ends: ['R3', 'R6'] },
  C6: { rect: [3, 20, 4, 26], ends: ['R4', 'R7'] },
  C7: { rect: [18, 18, 19, 26], ends: ['R5', 'R8'] },
};

const ALL_RECTS: Record<string, Rect> = {
  ...CHAMBERS,
  ...Object.fromEntries(Object.entries(CORRIDORS).map(([k, v]) => [k, v.rect])),
};

/** Map a detected room back to the fixture rect its centroid falls inside. */
function labelOf(room: Room | undefined): string | null {
  if (!room) return null;
  const [cx, cy] = room.centroid;
  for (const [id, [x0, y0, x1, y1]] of Object.entries(ALL_RECTS)) {
    if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) return id;
  }
  return null;
}

describe('detectRooms — 8-room Cragmaw-style dungeon benchmark', () => {
  let floor: Polygon[];
  let walls: WallSegment[];
  let doors: DoorChild[];
  /** door id -> the two fixture labels it should join */
  let expectedPairs: Map<string, [string, string]>;
  let rooms: Room[];
  let byLabel: Map<string | null, Room>;

  beforeAll(() => {
    floor = clipper2Engine.union(Object.values(ALL_RECTS).map(rectPoly), []);
    walls = Object.entries(ALL_RECTS).map(([id, r]) => rectWall(id, r));

    // Two doors per corridor: one in each end wall, joining it to a chamber.
    doors = [];
    expectedPairs = new Map();
    for (const [cid, { rect, ends }] of Object.entries(CORRIDORS)) {
      const [x0, y0, x1, y1] = rect;
      const horizontal = x1 - x0 > y1 - y0;
      const placements: [number, number][] = horizontal
        ? [[x0, (y0 + y1) / 2], [x1, (y0 + y1) / 2]]
        : [[(x0 + x1) / 2, y0], [(x0 + x1) / 2, y1]];
      placements.forEach((position, i) => {
        const id = `door-${cid}-${i}`;
        doors.push({
          id,
          name: 'Door',
          childType: 'door',
          visible: true,
          wallId: `wall-${cid}`,
          position,
          angle: horizontal ? Math.PI / 2 : 0,
          width: 1,
          style: 'single',
          state: 'closed',
          isSecret: false,
        });
        expectedPairs.set(id, [ends[i], cid]);
      });
    }

    rooms = detectRooms(floor, walls, GRID);
    byLabel = new Map(rooms.map((r) => [labelOf(r), r]));
  });

  it('finds every chamber and corridor exactly once', () => {
    const expected = Object.keys(ALL_RECTS); // 8 chambers + 7 corridors
    const found = expected.filter((id) => byLabel.has(id));
    expect(found.length / expected.length).toBeGreaterThanOrEqual(0.9);
    expect(rooms).toHaveLength(expected.length);
    expect(found).toHaveLength(expected.length);
  });

  it('classifies corridors as pathways and chambers as rooms', () => {
    const wrong = [...byLabel.entries()]
      .filter(([label, room]) => room.isPathway !== label!.startsWith('C'))
      .map(([label]) => label);
    expect(wrong).toEqual([]);
    expect(rooms.filter((r) => r.isPathway)).toHaveLength(7);
    expect(rooms.filter((r) => !r.isPathway)).toHaveLength(8);
  });

  it('produces unique ids that survive a second detection run', () => {
    expect(new Set(rooms.map((r) => r.id)).size).toBe(rooms.length);
    const rerun = detectRooms(floor, walls, GRID);
    expect(rerun.map((r) => r.id).sort()).toEqual(rooms.map((r) => r.id).sort());
  });

  it('keeps user names across re-detection via overrides', () => {
    const target = byLabel.get('R1')!;
    const renamed = detectRooms(floor, walls, GRID, { [target.id]: 'Cave Mouth' });
    expect(renamed.find((r) => r.id === target.id)?.name).toBe('Cave Mouth');
  });

  it('binds all 14 doors to the correct chamber/corridor pair', () => {
    expect(doors).toHaveLength(14);
    const byId = new Map(rooms.map((r) => [r.id, r]));
    const mismatches: string[] = [];
    for (const door of doors) {
      const { roomA, roomB } = bindDoorToRooms(door, walls, rooms);
      const got = [roomA, roomB].map((id) => labelOf(id ? byId.get(id) : undefined));
      const want = expectedPairs.get(door.id)!;
      if (!want.every((label) => got.includes(label))) {
        mismatches.push(`${door.id}: got ${got.join('+')} want ${want.join('+')}`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});
