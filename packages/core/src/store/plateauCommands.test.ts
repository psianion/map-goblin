import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './store';
import { undoManager } from './undoManager';
import { addOpening, removeOpening, setCrossingKinds, setPlateauFields, setSightDropCells } from './plateauCommands';
import { defaultCrossingKinds } from '../shared/crossingKinds';
import type { OpeningChild, ShapeChild } from '../shared/types';
import type { Command, DungeonLayer } from './types';

const outcrop: ShapeChild = {
  id: 'outcrop',
  name: 'Outcrop',
  childType: 'shape',
  visible: true,
  shapeType: 'polygon',
  contours: [[[0, 0], [6, 0], [6, 4], [0, 4]]],
  textureScale: 1,
  textureOffsetX: 0,
  textureOffsetY: 0,
  textureFillRotation: 0,
  textureTint: '#ffffff',
};

const stairs: OpeningChild = {
  id: 'stairs',
  name: 'Stairs',
  childType: 'opening',
  visible: true,
  kind: 'stairs',
  shapeId: 'outcrop',
  t: 0.25,
  width: 2,
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

  it('raises a floor with a cliff edge and undoes back to plain ground', () => {
    exec(setPlateauFields('outcrop', { height: 2, edge: 'cliff', crossingId: 'climb', sightOverride: 'hide' }));
    expect(find<ShapeChild>('outcrop')).toMatchObject({ height: 2, edge: 'cliff', crossingId: 'climb', sightOverride: 'hide' });
    undoManager.undo();
    const back = find<ShapeChild>('outcrop')!;
    expect(back.height).toBeUndefined();
    expect(back.edge).toBeUndefined();
    undoManager.redo();
    expect(find<ShapeChild>('outcrop')!.height).toBe(2);
  });

  it('keeps heights whole and refuses a slope width that is not positive', () => {
    exec(setPlateauFields('outcrop', { height: -1.4, edge: 'slope', slopeWidth: 1.5, contourLines: false }));
    expect(find<ShapeChild>('outcrop')).toMatchObject({ height: -1, edge: 'slope', slopeWidth: 1.5, contourLines: false });
    expect(setPlateauFields('outcrop', { slopeWidth: 0 })).toBeNull();
    expect(setPlateauFields('outcrop', { height: Number.NaN })).toBeNull();
    expect(setPlateauFields('outcrop', {})).toBeNull();
    expect(setPlateauFields('nothing', { height: 1 })).toBeNull();
  });
});

describe('openings', () => {
  it('adds stairs and removes them, each one entry', () => {
    useStore.getState().addChild(layerId, outcrop);
    exec(addOpening(layerId, stairs));
    expect(find<OpeningChild>('stairs')).toEqual(stairs);
    exec(removeOpening('stairs'));
    expect(find('stairs')).toBeUndefined();
    undoManager.undo();
    expect(find<OpeningChild>('stairs')).toEqual(stairs);
    undoManager.undo();
    expect(find('stairs')).toBeUndefined();
    expect(removeOpening('stairs')).toBeNull();
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
