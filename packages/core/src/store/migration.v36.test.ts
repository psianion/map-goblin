// 3.5 → 3.6: additive. A wall's corner style and a layer's, a door's freestanding flag.
// A 3.5 map loads as it was, the fields it lacks taking their defaults (sharp corners, doors
// on their walls), and a 3.6 map round-trips through migrateToLatest, the parser the table
// loads maps with too.

import { beforeEach, describe, expect, it } from 'vitest';
import { CURRENT_VERSION, SUPPORTED_VERSIONS, migrateToLatest } from './migration';
import { useStore } from './store';
import type { DoorChild, DungeonLayer, SerializedMapData } from './types';
import { standaloneWallLook, styleWallLook } from '../shared/wallLook';

const wall = { id: 'w', points: [[0, 0], [4, 0], [4, 4]], wallType: 'normal', direction: 'both', color: '#000000', roughness: 0 };
const door = { id: 'd', name: 'Door 1', childType: 'door', visible: true, wallId: 'p', position: [10, 10], angle: 0.6, width: 1, style: 'single', state: 'closed', isSecret: false };
const piece = { ...wall, id: 'p', points: [[9.6, 9.8], [10.4, 10.2]] };

beforeEach(() => useStore.getState().resetToDefault());

const dungeon = (data: SerializedMapData) => data.layers.find((l) => l.type === 'dungeon') as unknown as DungeonLayer;

/** The default map with one wall, one piece and one door on its dungeon layer, as a saved file. */
function saved(patch: (l: DungeonLayer) => void): SerializedMapData {
  useStore.setState((s) => {
    const l = s.layers.find((x) => x.type === 'dungeon') as DungeonLayer;
    l.standaloneWalls = structuredClone([wall, piece]) as DungeonLayer['standaloneWalls'];
    l.children.push(structuredClone(door) as DoorChild);
    patch(l);
  });
  return JSON.parse(JSON.stringify(useStore.getState().getSerializableState())) as SerializedMapData;
}

describe('map format 3.6', () => {
  it('is the version saved, and 3.5 is still read', () => {
    expect(CURRENT_VERSION).toBe('3.6');
    expect(SUPPORTED_VERSIONS).toContain('3.5');
    expect(useStore.getState().getSerializableState().version).toBe('3.6');
  });

  it('loads a 3.5 map with sharp corners and its doors on their walls', () => {
    const old = { ...saved(() => {}), version: '3.5' } as SerializedMapData;
    useStore.getState().resetToDefault();
    useStore.getState().loadFromFile(migrateToLatest(old));
    const l = dungeon(useStore.getState().getSerializableState());
    expect(styleWallLook(l.style).corner).toBe('sharp');
    expect(standaloneWallLook(l.standaloneWalls[0], l.style).corner).toBe('sharp');
    expect((l.children.find((c) => c.id === 'd') as DoorChild).freestanding).toBeUndefined();
  });

  it('round-trips corner styles and a freestanding door through save and load', () => {
    const data = saved((l) => {
      l.style.wallCornerStyle = 'rounded';
      l.standaloneWalls[0].cornerStyle = 'sharp';
      (l.children.find((c) => c.id === 'd') as DoorChild).freestanding = true;
    });
    useStore.getState().resetToDefault();
    useStore.getState().loadFromFile(migrateToLatest(data));
    const l = dungeon(useStore.getState().getSerializableState());
    expect(l.style.wallCornerStyle).toBe('rounded');
    expect(l.standaloneWalls[0].cornerStyle).toBe('sharp');
    expect(standaloneWallLook(l.standaloneWalls[1], l.style).corner).toBe('rounded');
    const d = l.children.find((c) => c.id === 'd') as DoorChild;
    expect(d).toMatchObject({ freestanding: true, wallId: 'p', angle: 0.6 });
  });
});
