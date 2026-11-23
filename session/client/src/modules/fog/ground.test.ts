import { describe, expect, it } from 'vitest';
import type { Layer, Level } from '@dnd/core/src/store/types';
import { regionOf, setCells, type Cell } from '@dnd/mechanics/fog';
import { foggedShare, groundOfMap } from './ground';

const FRAME = { minX: -2, minY: -2, maxX: 8, maxY: 8 };
const square = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];
const floorLayer = (id: string, levelId: string, ring: [number, number][]): Layer =>
  ({ id, type: 'dungeon', levelId, children: [], rooms: [], mergedFloor: [ring] }) as unknown as Layer;
const levels: Level[] = [{ id: 'up', name: 'Up' } as Level, { id: 'down', name: 'Down' } as Level];

const cellsIn = (c0: number, r0: number, c1: number, r1: number): Cell[] => {
  const out: Cell[] = [];
  for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) out.push([c, r]);
  return out;
};

describe('the share of the map still fogged', () => {
  it('counts ground only, never the void round it', () => {
    const map = { layers: [floorLayer('a', 'up', square(0, 0, 4, 4))], levels: [levels[0]!], mapSettings: {} };
    const ground = groundOfMap(map, FRAME)!;
    // The 4x4 floor sits at cells 2..5 of a frame starting at -2.
    expect(foggedShare(ground, undefined, FRAME)).toBe(1);
    expect(foggedShare(ground, { up: setCells(regionOf(FRAME)!, cellsIn(2, 2, 6, 4)) }, FRAME)).toBe(0.5);
    // Clearing the void as well changes nothing past the floor.
    expect(foggedShare(ground, { up: setCells(regionOf(FRAME)!, cellsIn(0, 0, 10, 10)) }, FRAME)).toBe(0);
  });

  it('adds every level up, each against its own ground', () => {
    const map = {
      layers: [floorLayer('a', 'up', square(0, 0, 4, 4)), floorLayer('b', 'down', square(0, 0, 4, 4))],
      levels,
      mapSettings: {},
    };
    const ground = groundOfMap(map, FRAME)!;
    expect(foggedShare(ground, { up: setCells(regionOf(FRAME)!, cellsIn(2, 2, 6, 6)) }, FRAME)).toBe(0.5);
  });

  it('takes the whole frame as ground on a map with no floor drawn, or with base ground', () => {
    const bare = groundOfMap({ layers: [], levels: [levels[0]!], mapSettings: {} }, FRAME)!;
    expect(bare[0]!.cells).toBeNull();
    const based = groundOfMap({ layers: [floorLayer('a', 'up', square(0, 0, 4, 4))], levels: [levels[0]!], mapSettings: { ground: { color: '#445533' } } }, FRAME)!;
    expect(based[0]!.cells).toBeNull();
  });
});
