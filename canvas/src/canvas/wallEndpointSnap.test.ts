// Where a wall endpoint actually lands.
//
// The middleware runs after `gridSnap`, so what it is handed is already quantized to
// `1/snapDivision` — half a cell at the default division. A click aimed at the visible floor
// edge therefore arrives up to a full subdivision inside the room, looking joined at any
// working zoom and not being joined at all: `detectRooms` cuts the floor with a rectangle
// grown by half a wall width (0.25 at the default 0.5), so a divider that stops half a unit
// short leaves a bridge of floor at each end, the difference returns one polygon, and the
// room silently never splits.

import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '@/store/store';
import { wallEndpointSnap } from './wallEndpointSnap';
import type { DungeonLayer } from '@/store/types';
import type { Polygon } from '@/types/geometry';

/** A plain 10×10 room, corners on whole cells. */
const RING: Polygon = [[0, 0], [10, 0], [10, 10], [0, 10]];

function layer(): DungeonLayer {
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon');
  if (!l) throw new Error('default state has no dungeon layer');
  return l;
}

function seed(): DungeonLayer {
  useStore.getState().updateLayer(layer().id, { mergedFloor: [RING] } as Partial<DungeonLayer>);
  useStore.getState().setActiveTool('wall');
  return layer();
}

beforeEach(() => {
  useStore.getState().resetToDefault();
});

describe('wallEndpointSnap', () => {
  it('is the half-unit-short divider that used to fail to split the room', () => {
    seed();
    // Default snapDivision is 2, so this is exactly one subdivision inside each edge —
    // the endpoints `gridSnap` hands over for a divider drawn to the visible edges.
    expect(wallEndpointSnap({ x: 5, y: 0.5 })).toEqual({ x: 5, y: 0 });
    expect(wallEndpointSnap({ x: 5, y: 9.5 })).toEqual({ x: 5, y: 10 });
  });

  it('reaches the edge from any side, not just the corners', () => {
    seed();
    expect(wallEndpointSnap({ x: 0.5, y: 3 })).toEqual({ x: 0, y: 3 });
    expect(wallEndpointSnap({ x: 9.5, y: 7 })).toEqual({ x: 10, y: 7 });
  });

  it('leaves a wall that was meant to stop short alone', () => {
    seed();
    // Two subdivisions in: further than the grid can misplace a click at the edge, so this
    // is a stub somebody drew on purpose.
    expect(wallEndpointSnap({ x: 5, y: 1 })).toEqual({ x: 5, y: 1 });
    expect(wallEndpointSnap({ x: 5, y: 5 })).toEqual({ x: 5, y: 5 });
  });

  it('scales its reach with the grid it is correcting for', () => {
    seed();
    useStore.getState().setSnapDivision(4);
    // A quarter-cell grid can only park a click a quarter short, so half a unit is now a
    // deliberate stub rather than a miss.
    expect(wallEndpointSnap({ x: 5, y: 0.25 })).toEqual({ x: 5, y: 0 });
    expect(wallEndpointSnap({ x: 5, y: 0.5 })).toEqual({ x: 5, y: 0.5 });
  });

  it('still prefers an existing wall endpoint, so chains keep joining', () => {
    const l = seed();
    useStore.getState().updateLayer(l.id, {
      standaloneWalls: [
        {
          id: 'w1',
          points: [
            [5, 0.4],
            [5, 4],
          ],
          wallType: 'normal',
          direction: 'both',
          color: '#333333',
          width: 0.5,
          roughness: 0,
        },
      ],
    } as Partial<DungeonLayer>);
    // Nearer the ring than the wall end, but a hand-drawn endpoint is a join somebody made.
    expect(wallEndpointSnap({ x: 5, y: 0.5 })).toEqual({ x: 5, y: 0.4 });
  });

  it('keeps its hands off every other tool', () => {
    seed();
    useStore.getState().setActiveTool('select');
    expect(wallEndpointSnap({ x: 5, y: 0.5 })).toEqual({ x: 5, y: 0.5 });
  });
});
