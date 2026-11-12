import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './store';
import { undoManager } from './undoManager';
import { setCrossingKinds, setPlateauFields, setSightDropCells } from './plateauCommands';
import { defaultCrossingKinds } from '../shared/crossingKinds';
import type { PlateauChild } from '../shared/types';
import type { Command, DungeonLayer } from './types';

const outcrop: PlateauChild = {
  id: 'outcrop',
  name: 'Outcrop',
  childType: 'plateau',
  visible: true,
  contours: [[[0, 0], [6, 0], [6, 4], [0, 4]]],
  height: 1,
  edge: 'none',
};

let layerId = '';
const layer = () => useStore.getState().layers.find((l) => l.id === layerId) as DungeonLayer;
const find = <T,>(id: string) => layer().children.find((c) => c.id === id) as T | undefined;
const exec = (cmd: Command | null) => {
  expect(cmd).not.toBeNull();
  undoManager.execute(cmd!);
};

beforeEach(() => {
  useStore.getState().resetToDefault();
  undoManager.clear();
  layerId = useStore.getState().layers.find((l) => l.type === 'dungeon')!.id;
});

describe('setPlateauFields', () => {
  beforeEach(() => useStore.getState().addChild(layerId, outcrop));

  it('raises a plateau with a cliff edge and undoes back to how it was', () => {
    exec(setPlateauFields('outcrop', { height: 2, edge: 'cliff', crossingId: 'climb', sightOverride: 'hide' }));
    expect(find<PlateauChild>('outcrop')).toMatchObject({ height: 2, edge: 'cliff', crossingId: 'climb', sightOverride: 'hide' });
    undoManager.undo();
    const back = find<PlateauChild>('outcrop')!;
    expect(back.height).toBe(1);
    expect(back.edge).toBe('none');
    expect(back.crossingId).toBeUndefined();
    undoManager.redo();
    expect(find<PlateauChild>('outcrop')!.height).toBe(2);
  });

  it('keeps heights whole and refuses a slope width that is not positive', () => {
    exec(setPlateauFields('outcrop', { height: -1.4, edge: 'slope', slopeWidth: 1.5, contourLines: false }));
    expect(find<PlateauChild>('outcrop')).toMatchObject({ height: -1, edge: 'slope', slopeWidth: 1.5, contourLines: false });
    expect(setPlateauFields('outcrop', { slopeWidth: 0 })).toBeNull();
    expect(setPlateauFields('outcrop', { height: Number.NaN })).toBeNull();
    expect(setPlateauFields('outcrop', {})).toBeNull();
    expect(setPlateauFields('nothing', { height: 1 })).toBeNull();
  });

  it('sets a painted border and its width, undoes both together, and refuses a width that is not positive', () => {
    exec(setPlateauFields('outcrop', { edge: 'cliff', edgeArt: 'paint:gg-forge:wild_dirt_8x8_floor_A', borderWidth: 1.25 }));
    expect(find<PlateauChild>('outcrop')).toMatchObject({ edge: 'cliff', edgeArt: 'paint:gg-forge:wild_dirt_8x8_floor_A', borderWidth: 1.25 });
    undoManager.undo();
    const back = find<PlateauChild>('outcrop')!;
    expect(back.edgeArt).toBeUndefined();
    expect(back.borderWidth).toBeUndefined();
    undoManager.redo();
    expect(find<PlateauChild>('outcrop')!.borderWidth).toBe(1.25);
    // Back to the default width: the key goes.
    exec(setPlateauFields('outcrop', { borderWidth: undefined }));
    expect(find<PlateauChild>('outcrop')!.borderWidth).toBeUndefined();
    expect(setPlateauFields('outcrop', { borderWidth: 0 })).toBeNull();
    expect(setPlateauFields('outcrop', { borderWidth: Number.NaN })).toBeNull();
  });
});

describe('map rules', () => {
  const settings = () => useStore.getState().mapSettings;

  it('a new map starts at a 2-cell threshold with the seeded kinds', () => {
    expect(settings().sightDropCells).toBe(2);
    expect(settings().crossingKinds).toEqual(defaultCrossingKinds());
  });

  it('sets the sight threshold in whole cells, at least one, and undoes it', () => {
    exec(setSightDropCells(3.4));
    expect(settings().sightDropCells).toBe(3);
    undoManager.undo();
    expect(settings().sightDropCells).toBe(2);
    exec(setSightDropCells(0));
    expect(settings().sightDropCells).toBe(1);
    expect(setSightDropCells(1)).toBeNull();
    expect(setSightDropCells(Number.NaN)).toBeNull();
  });

  it('replaces the crossing list as one entry, and refuses duplicate ids', () => {
    const kinds = [
      ...defaultCrossingKinds().map((k) => (k.id === 'climb' ? { ...k, note: 'DC 15 Athletics' } : k)),
      { id: 'swim', name: 'Swim', blocks: false },
    ];
    exec(setCrossingKinds(kinds));
    expect(settings().crossingKinds).toEqual(kinds);
    undoManager.undo();
    expect(settings().crossingKinds).toEqual(defaultCrossingKinds());
    undoManager.redo();
    expect(settings().crossingKinds.find((k) => k.id === 'climb')?.note).toBe('DC 15 Athletics');
    expect(setCrossingKinds([{ id: 'a', name: 'A', blocks: false }, { id: 'a', name: 'B', blocks: true }])).toBeNull();
  });
});
