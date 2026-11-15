import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '@/store/store';
import { createDungeonLayer } from '@/store/factories';
import type { Room } from '@/store/types';
import { inheritedPlace, ownLook, setLook, type LookTarget } from './roomLook';
import { undoManager } from '@/store/undoManager';

const st = () => useStore.getState();
const levelId = () => st().ui.activeLevelId;

function seed(opts: { map?: 'outdoor' | 'indoor' | 'underground'; level?: 'outdoor' | 'indoor' | 'underground'; area?: 'outdoor' | 'indoor' | 'underground'; room?: 'outdoor' | 'indoor' | 'underground' }) {
  const room = { id: 'r1', name: 'Hall', anchor: [2, 2], areaId: 'a1', look: opts.room ? { place: opts.room } : undefined } as unknown as Room;
  const layer = {
    ...createDungeonLayer('Keep', levelId()),
    id: 'd1',
    rooms: [room],
    areas: [{ id: 'a1', name: 'Wing', look: opts.area ? { place: opts.area } : undefined }],
  };
  useStore.setState((s) => {
    s.layers = [layer];
    s.mapSettings.environment = opts.map ?? 'outdoor';
    const level = s.levels.find((l) => l.id === levelId())!;
    level.look = opts.level ? { place: opts.level } : undefined;
  });
}

const roomT = (): LookTarget => ({ kind: 'room', layerId: 'd1', roomId: 'r1' });
const areaT = (): LookTarget => ({ kind: 'area', layerId: 'd1', areaId: 'a1' });
const levelT = (): LookTarget => ({ kind: 'level', levelId: levelId() });

beforeEach(() => {
  useStore.getState().resetToDefault();
  undoManager.clear?.();
});

describe('inheritedPlace', () => {
  it('a level follows the map', () => {
    seed({ map: 'underground' });
    expect(inheritedPlace(st(), levelT())).toBe('underground');
  });

  it('a level own pin does not count: it is what it would follow without it', () => {
    seed({ map: 'outdoor', level: 'indoor' });
    expect(inheritedPlace(st(), levelT())).toBe('outdoor');
  });

  it('a room follows its level, else the map', () => {
    seed({ map: 'outdoor', level: 'indoor' });
    expect(inheritedPlace(st(), roomT())).toBe('indoor');
    seed({ map: 'underground' });
    expect(inheritedPlace(st(), roomT())).toBe('underground');
  });

  it('a room follows its area before the level, and its own pin does not count', () => {
    seed({ map: 'outdoor', level: 'indoor', area: 'underground', room: 'outdoor' });
    expect(inheritedPlace(st(), roomT())).toBe('underground');
  });

  it('an area follows its level', () => {
    seed({ map: 'outdoor', level: 'indoor', area: 'underground' });
    expect(inheritedPlace(st(), areaT())).toBe('indoor');
  });

  it('is null for a target that is not in the map', () => {
    seed({});
    expect(inheritedPlace(st(), { kind: 'room', layerId: 'nope', roomId: 'r1' })).toBeNull();
    expect(inheritedPlace(st(), { kind: 'level', levelId: 'nope' })).toBeNull();
  });
});

describe('setLook with a place', () => {
  it('pins a room and a level, and undoes', () => {
    seed({});
    setLook(roomT(), { place: 'underground' });
    expect(ownLook(st(), roomT())?.place).toBe('underground');
    setLook(levelT(), { place: 'indoor' });
    expect(ownLook(st(), levelT())?.place).toBe('indoor');
    undoManager.undo();
    expect(ownLook(st(), levelT())?.place).toBeUndefined();
    expect(ownLook(st(), roomT())?.place).toBe('underground');
  });
});
