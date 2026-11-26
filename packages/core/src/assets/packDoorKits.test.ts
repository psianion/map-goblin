// A door kit a pack declares: whole leaves in their own frames, the default door of the wall
// sets its pieces name, offered beside the built-in kits.
import { afterEach, describe, expect, it } from 'vitest';
import { doorKitById, doorKitFor, doorKitIds, doorKitOf, kitWallSet, leafPoses, packDoorKits, wholeDoorFrame } from './doorKits';
import { resetAssetPackManager, seedPack } from '../testing/seedCatalog';
import type { DoorMeasure, ManifestEntry } from '../engine/packManifest';

const entry = (material: string, gridSize: string, door: DoorMeasure): ManifestEntry => ({ type: 'object', material, gridSize, pieceType: 'object', variant: 'A', set: 'Test_Doors', tags: ['door'], door });

function seedDoors(): void {
  const rock = { kit: 'test_rock', label: 'Rock' };
  seedPack('test-pack', {
    rock_leaf_1x1_A: entry('rock_leaf', '1x1', { ...rock, part: 'leaf', walls: ['Test_Cave', 'Test_Wall_Rock'] }),
    rock_frame_2x1_A: entry('rock_frame', '2x1', { ...rock, part: 'frame', post: [0.49, 0.7] }),
    rock_frame_double_3x1_A: entry('rock_frame_double', '3x1', { ...rock, part: 'frame-double', post: [0.99, 1.2] }),
    // A kit with no leaf is no kit.
    bare_frame_2x1_A: entry('bare_frame', '2x1', { kit: 'test_bare', label: 'Bare', part: 'frame', post: [0.49, 0.7] }),
  });
}

afterEach(() => resetAssetPackManager());

describe('a door kit a pack declares', () => {
  it('is built from its entries, whole, and offered after the built-in kits', () => {
    seedDoors();
    expect(packDoorKits().map((k) => k.id)).toEqual(['test_rock']);
    expect(doorKitIds()).toEqual(['stone', 'wood', 'cave', 'test_rock']);
    const kit = doorKitById('test_rock')!;
    expect(kit).toMatchObject({ hang: 'whole', label: 'Rock', jamb: { kind: 'posts' } });
    expect(kit.whole).toEqual({
      leaf: 'test-pack:rock_leaf_1x1_A',
      frame: { entryId: 'test-pack:rock_frame_2x1_A', post: [0.49, 0.7] },
      double: { entryId: 'test-pack:rock_frame_double_3x1_A', post: [0.99, 1.2] },
    });
  });

  it('is the door of the wall sets it names, and a door may still pick another kit', () => {
    seedDoors();
    expect(doorKitFor('Test_Cave')?.id).toBe('test_rock');
    expect(doorKitFor('Test_Wall_Rock')?.id).toBe('test_rock');
    expect(kitWallSet(doorKitById('test_rock')!)).toBe('Test_Cave');
    expect(doorKitFor('GG_Fieldstone')?.id).toBe('stone');
    expect(doorKitOf({ style: 'single', kit: 'wood' }, 'Test_Cave')?.id).toBe('wood');
    expect(doorKitOf({ style: 'single' }, 'Test_Cave')?.id).toBe('test_rock');
  });

  it('frames one cell with its single frame and two or three with its double', () => {
    seedDoors();
    const art = doorKitById('test_rock')!.whole!;
    expect(wholeDoorFrame(art, 1)?.entryId).toBe('test-pack:rock_frame_2x1_A');
    expect(wholeDoorFrame(art, 2)?.entryId).toBe('test-pack:rock_frame_double_3x1_A');
    expect(wholeDoorFrame(art, 3)?.entryId).toBe('test-pack:rock_frame_double_3x1_A');
  });

  it('hangs its leaves edge to edge: one leaf a cell long, two across two or three cells', () => {
    seedDoors();
    const kit = doorKitById('test_rock')!;
    const single = leafPoses({ width: 1, style: 'single', state: 'closed' }, [5, 5], 0, kit, 0.5);
    expect(single).toHaveLength(1);
    expect(single[0].origin[0]).toBeCloseTo(4.5, 9);
    expect(single[0].length).toBeCloseTo(0.98, 9);
    const double = leafPoses({ width: 3, style: 'double', state: 'closed' }, [5, 5], 0, kit, 0.5);
    expect(double.map((p) => p.origin[0])).toEqual([3.5, 6.5]);
    expect(double[0].length).toBeCloseTo(1.485, 9);
    // Shut, on the wall's line.
    for (const p of double) expect(p.origin[1]).toBeCloseTo(5, 9);
  });

  it('builds nothing with no pack', () => {
    expect(packDoorKits()).toEqual([]);
    expect(doorKitById('test_rock')).toBeNull();
  });
});
