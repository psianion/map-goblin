import { describe, it, expect } from 'vitest';
import { anchorFor, freePiece, isFreestanding } from './freestandingDoor';
import { doorAngleValue, DOOR_ANGLE_STEP } from '../engine/tools/DoorTool';
import { createDungeonLayer } from '../store/factories';
import type { DoorChild, DungeonLayer, WallSegment } from '../store/types';

const wall = (id: string, points: [number, number][]): WallSegment => ({
  id,
  points,
  wallType: 'normal',
  direction: 'both',
  color: '#000000',
  roughness: 0,
});

const door = (over: Partial<DoorChild> = {}): DoorChild => ({
  id: 'd',
  name: 'Door 1',
  childType: 'door',
  visible: true,
  wallId: 'p',
  position: [10, 10],
  angle: 0,
  width: 1,
  style: 'single',
  state: 'closed',
  isSecret: false,
  ...over,
});

function layerWith(walls: WallSegment[], d: DoorChild): DungeonLayer {
  return { ...createDungeonLayer('Stone', 'lv'), standaloneWalls: walls, children: [d] } as DungeonLayer;
}

describe('freestanding doors', () => {
  it('stand on a piece their own width, centred where they are placed, at their angle', () => {
    const p = freePiece([10, 10], Math.PI / 2, 2, { wallType: 'normal', direction: 'both', color: '#000' });
    expect(p.points[0][0]).toBeCloseTo(10);
    expect(p.points[0][1]).toBeCloseTo(9);
    expect(p.points[1][0]).toBeCloseTo(10);
    expect(p.points[1][1]).toBeCloseTo(11);
  });

  it('turn in 5° steps, 0 to 175', () => {
    expect(DOOR_ANGLE_STEP).toBe(5);
    expect(doorAngleValue(37)).toBe(35);
    expect(doorAngleValue(38)).toBe(40);
    expect(doorAngleValue(178)).toBe(0);
    expect(doorAngleValue(-10)).toBe(0);
  });

  it('read as freestanding by their flag, or by standing on a piece of their own', () => {
    const piece = wall('p', [[9.5, 10], [10.5, 10]]);
    expect(isFreestanding(layerWith([piece], door()), door())).toBe(true);
    const long = wall('p', [[0, 10], [20, 10]]);
    expect(isFreestanding(layerWith([long], door()), door())).toBe(false);
    expect(isFreestanding(layerWith([long], door({ freestanding: true })), door({ freestanding: true }))).toBe(true);
  });

  it('anchor onto the nearest wall within one cell, never their own piece', () => {
    const piece = wall('p', [[9.5, 10], [10.5, 10]]);
    const near = wall('w', [[5, 10.8], [15, 10.8]]);
    const d = door({ freestanding: true });
    const to = anchorFor(layerWith([piece, near], d), d);
    expect(to?.wallId).toBe('w');
    expect(to?.position[1]).toBeCloseTo(10.8);
    expect(to?.angle).toBeCloseTo(0);
  });

  it('refuse to anchor with no wall within one cell, or none long enough', () => {
    const piece = wall('p', [[9.5, 10], [10.5, 10]]);
    const d = door({ freestanding: true });
    expect(anchorFor(layerWith([piece, wall('far', [[5, 12], [15, 12]])], d), d)).toBeNull();
    expect(anchorFor(layerWith([piece, wall('stub', [[10, 10.5], [10.4, 10.5]])], d), d)).toBeNull();
  });
});
