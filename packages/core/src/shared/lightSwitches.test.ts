import { describe, it, expect } from 'vitest';
import { lightGroups, lightsInRoom, lightsOnProp, roomsWithLights, withGroupMates } from './lightSwitches';
import type { Layer } from '../store/types';

const light = (id: string, x: number, y: number, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  childType: 'light',
  visible: true,
  color: '#ffffff',
  radius: 4,
  featherRadius: 2,
  intensity: 1,
  falloff: 'quadratic',
  position: { x, y },
  ...extra,
});

const square = (x0: number, y0: number, s: number): [number, number][] => [
  [x0, y0],
  [x0 + s, y0],
  [x0 + s, y0 + s],
  [x0, y0 + s],
];

const layer = (id: string, levelId: string, children: unknown[], rooms: unknown[] = []) =>
  ({ id, type: 'dungeon', levelId, children, rooms }) as unknown as Layer;

const LEVELS = [
  { id: 'ground', name: 'Ground' },
  { id: 'cellar', name: 'Cellar' },
];

const LAYERS: Layer[] = [
  layer(
    'a',
    'ground',
    [
      light('l1', 1, 1, { group: 'Hall' }),
      light('l2', 2, 2, { group: ' Hall ' }),
      light('l3', 15, 15, { attachedTo: 'p1' }),
      light('l4', 3, 3, { group: 'Gate', attachedTo: 'p1' }),
    ],
    [{ id: 'r1', name: 'Hall', anchor: [5, 5], face: square(0, 0, 10) }],
  ),
  layer('b', 'ground', [light('l5', 4, 4)]),
  layer('c', 'cellar', [light('l6', 5, 5, { group: 'Gate' })], [{ id: 'r2', name: 'Empty', anchor: [50, 50], face: square(40, 40, 20) }]),
];

describe('light groups', () => {
  it('lists groups by trimmed name with their lights', () => {
    const groups = lightGroups(LAYERS);
    expect(groups.map((g) => [g.name, g.lights.map((l) => l.id)])).toEqual([
      ['Gate', ['l4', 'l6']],
      ['Hall', ['l1', 'l2']],
    ]);
  });

  it('adds every group mate on the map, across layers and levels', () => {
    expect(withGroupMates(LAYERS, ['l1'])).toEqual(['l1', 'l2']);
    expect(withGroupMates(LAYERS, ['l3', 'l4'])).toEqual(['l3', 'l4', 'l6']);
    expect(withGroupMates(LAYERS, ['l5'])).toEqual(['l5']);
  });

  it('finds the lights on a prop', () => {
    expect(lightsOnProp(LAYERS, 'p1').map((l) => l.id)).toEqual(['l3', 'l4']);
  });
});

describe('lightsInRoom', () => {
  it('takes the lights inside the face on the room`s level, from every layer of it', () => {
    expect(lightsInRoom({ layers: LAYERS, levels: LEVELS }, 'r1').map((l) => l.id)).toEqual(['l1', 'l2', 'l4', 'l5']);
  });

  it('gives a light in a room inside another to the inner room only', () => {
    const nested = [
      layer('a', 'ground', [light('torch', 3, 3), light('lamp', 8, 8)], [
        { id: 'hall', name: 'Hall', anchor: [8, 8], face: square(0, 0, 10) },
        { id: 'nook', name: 'Nook', anchor: [3, 3], boundary: square(2, 2, 2) },
      ]),
    ];
    expect(lightsInRoom({ layers: nested, levels: LEVELS }, 'nook').map((l) => l.id)).toEqual(['torch']);
    expect(lightsInRoom({ layers: nested, levels: LEVELS }, 'hall').map((l) => l.id)).toEqual(['lamp']);
  });

  it('leaves out another level`s lights and an unknown room', () => {
    expect(lightsInRoom({ layers: LAYERS, levels: LEVELS }, 'r2')).toEqual([]);
    expect(lightsInRoom({ layers: LAYERS, levels: LEVELS }, 'nope')).toEqual([]);
  });

  it('lists only the rooms that hold a light', () => {
    expect(roomsWithLights({ layers: LAYERS, levels: LEVELS }).map((r) => [r.id, r.lights.length])).toEqual([['r1', 4]]);
  });
});
