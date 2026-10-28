import { describe, it, expect, beforeAll } from 'vitest';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { setClipperModule } from '../geometry/Clipper2Engine';
import { suggestRooms } from './suggestRooms';
import { pointInRing } from './roomUtils';
import type { DungeonLayer } from '../store/types';
import type { Room, WallSegment } from './types';

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

const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

const wall = (id: string, points: [number, number][]): WallSegment => ({
  id,
  points,
  wallType: 'normal',
  direction: 'both',
  color: '#000000',
  width: 0.4,
  roughness: 0,
});

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
    mergedFloor: null,
    style: { wallWidth: 0.4 } as DungeonLayer['style'],
    sublayerVisibility: { floor: true, grid: true, walls: true },
    ...patch,
  };
}

const FRAME = { minX: -2, minY: -2, maxX: 32, maxY: 14 };

describe('suggestRooms', () => {
  it('proposes one room per face of a two-floor map, numbered in reading order', () => {
    const out = suggestRooms(layer({ mergedFloor: [rect(0, 0, 10, 10), rect(20, 0, 30, 10)] }), FRAME);
    expect(out.map((r) => r.name)).toEqual(['Room 1', 'Room 2']);
    expect(out.map((r) => r.number)).toEqual([1, 2]);
    expect(out[0].anchor[0]).toBeLessThan(out[1].anchor[0]);
    for (const r of out) {
      expect(r.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(pointInRing(r.anchor[0], r.anchor[1], r.face!)).toBe(true);
    }
  });

  it('leaves alone a face that already holds a room, and numbers on from the rooms there', () => {
    const existing: Room = { id: 'keep', name: 'Hall', number: 4, anchor: [5, 5] };
    const out = suggestRooms(
      layer({ mergedFloor: [rect(0, 0, 10, 10), rect(20, 0, 30, 10)], rooms: [existing] }),
      FRAME,
    );
    expect(out).toHaveLength(1);
    expect(out[0].anchor[0]).toBeGreaterThan(20);
    expect(out[0]).toMatchObject({ name: 'Room 5', number: 5 });
  });

  it('cuts faces with walls and thresholds like the refresh does', () => {
    const out = suggestRooms(
      layer({
        mergedFloor: [rect(0, 0, 30, 10)],
        standaloneWalls: [wall('w', [[10, 0], [10, 10]])],
        thresholds: [{ id: 't', points: [[20, 0], [20, 10]] }],
      }),
      FRAME,
    );
    expect(out).toHaveLength(3);
  });

  it('on a walls-only import, proposes what the walls enclose and drops the outside', () => {
    const out = suggestRooms(
      layer({
        standaloneWalls: [
          wall('a', [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]),
          wall('b', [[20, 0], [30, 0], [30, 10], [20, 10], [20, 0]]),
        ],
      }),
      FRAME,
    );
    expect(out).toHaveLength(2);
    for (const r of out) expect(r.anchor[1]).toBeGreaterThan(0);
  });

  it('proposes nothing on an empty layer', () => {
    expect(suggestRooms(layer({}), null)).toEqual([]);
    expect(suggestRooms(layer({}), FRAME)).toEqual([]);
  });
});
