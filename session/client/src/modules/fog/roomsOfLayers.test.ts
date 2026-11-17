// R1 (rca-live.md): a withheld room the server sends as a stand-in is art for the floor it lies
// under, never a room the player holds, so the fog never counts it.
import { describe, expect, it } from 'vitest';
import type { Layer } from '@dnd/core/src/store/types';
import { roomsOfLayers } from './fog';

const face: [number, number][] = [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
];

describe('roomsOfLayers', () => {
  it('leaves stand-ins out of the rooms the fog reads', () => {
    const layers = [
      {
        id: 'l',
        type: 'dungeon',
        children: [],
        standaloneWalls: [],
        rooms: [
          { id: 'held', name: 'Hall', anchor: [2, 2], boundary: face },
          { id: 'withheld', name: '', anchor: [0, 0], boundary: face, standIn: true, look: { place: 'underground' } },
        ],
      },
    ] as unknown as Layer[];
    expect(roomsOfLayers(layers).map((room) => room.id)).toEqual(['held']);
  });
});
