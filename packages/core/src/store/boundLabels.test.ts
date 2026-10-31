import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useStore } from './store';
import { undoManager } from './undoManager';
import { PropertyCommand } from './commands';
import type { DoorChild, DungeonLayer, Room, TextChild } from './types';
import { installBoundLabelSync, syncBoundLabels } from './boundLabels';
import { labelFor } from '../shared/labelStyles';

const square = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

const room = (id: string, name: string, number: number): Room => ({
  id,
  name,
  number,
  anchor: [5, 5],
  boundary: square(0, 0, 10, 10),
});

const door = (id: string, at: [number, number]): DoorChild => ({
  id,
  name: 'Door 1',
  childType: 'door',
  visible: true,
  wallId: '',
  position: at,
  angle: 0,
  width: 1,
  style: 'single',
  state: 'closed',
  isSecret: false,
});

const layer = () => useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
const label = (id: string) => layer().children.find((c) => c.id === id) as TextChild;
const rooms = () => layer().rooms ?? [];

function place(id: string, style: Parameters<typeof labelFor>[0], x: number, y: number): void {
  const c = labelFor(style, { x, y }, useStore.getState().layers, layer().id);
  useStore.getState().addChild(layer().id, { id, name: id, ...c });
}

function setRooms(next: Room[]): void {
  useStore.getState().updateLayer(layer().id, { rooms: next } as Partial<DungeonLayer>);
}

let stop: (() => void) | null = null;

beforeEach(() => {
  useStore.getState().resetToDefault();
  undoManager.clear();
  setRooms([room('hall', 'Warren Hall', 4)]);
  useStore.getState().addChild(layer().id, door('d1', [15, 5]));
  stop = installBoundLabelSync();
});

afterEach(() => {
  stop?.();
  stop = null;
});

describe('bound labels', () => {
  it('follow a room rename', () => {
    place('t', 'room-name', 3, 4);
    setRooms([{ ...rooms()[0], name: 'Great Hall' }]);
    expect(label('t').text).toBe('Great Hall');
  });

  it('follow a renumber', () => {
    place('pin', 'number-pin', 6, 6);
    expect(label('pin').text).toBe('4');
    setRooms([{ ...rooms()[0], number: 9 }]);
    expect(label('pin').text).toBe('9');
  });

  it('follow an anchor move by their offset', () => {
    place('t', 'room-name', 3, 4);
    setRooms([{ ...rooms()[0], anchor: [6, 8] }]);
    expect(label('t').position).toEqual({ x: 4, y: 7 });
    expect(label('t').offset).toEqual([-2, -1]);
  });

  it('follow a door drag, and keep a label moved by hand where it was put', () => {
    place('tag', 'door-tag', 15, 5.5);
    useStore.getState().updateChild(layer().id, 'd1', { position: [18, 5] } as Partial<DoorChild>);
    expect(label('tag').position.x).toBeCloseTo(18, 9);
    expect(label('tag').position.y).toBeCloseTo(5.5, 9);
    // Moved by hand: the anchor stood still, so the offset takes the new place.
    useStore.getState().updateChild(layer().id, 'tag', { position: { x: 20, y: 6 } });
    expect(label('tag').position).toEqual({ x: 20, y: 6 });
    expect(label('tag').offset).toEqual([2, 1]);
  });

  it('follow a door whose wall is dragged: the wall moves, the door child does not, the tag still follows', () => {
    useStore.getState().addWall(layer().id, {
      id: 'w9', points: [[20, 20], [24, 20]], wallType: 'normal', direction: 'both', color: '#000000', roughness: 0,
    });
    useStore.getState().addChild(layer().id, { ...door('d9', [22, 20]), wallId: 'w9' });
    place('tag9', 'door-tag', 22, 20.5);
    expect(label('tag9').bound).toEqual({ kind: 'door', id: 'd9' });
    const children = layer().children;
    // A live wall drag writes the wall's points only, tick by tick.
    for (const dy of [1, 2, 3]) {
      useStore.getState().updateWall(layer().id, 'w9', { points: [[20, 20 + dy], [24, 20 + dy]] });
      expect(label('tag9').position.x).toBeCloseTo(22, 9);
      expect(label('tag9').position.y).toBeCloseTo(20.5 + dy, 9);
    }
    expect((layer().children.find((c) => c.id === 'd9') as DoorChild).position).toEqual([22, 20]);
    expect(children.find((c) => c.id === 'd9')).toBe(layer().children.find((c) => c.id === 'd9'));
  });

  it('unbind when the target is deleted, keeping the last text', () => {
    place('t', 'room-name', 3, 4);
    setRooms([]);
    expect(label('t').bound).toBeUndefined();
    expect(label('t').offset).toBeUndefined();
    expect(label('t').text).toBe('Warren Hall');
  });

  it('do no work with nothing bound', () => {
    place('free', undefined, 3, 4);
    const out = syncBoundLabels(useStore.getState());
    expect(out.patches).toEqual([]);
    expect(out.anchors.size).toBe(0);
  });

  it('add no undo entry, and re-sync when undo restores the room', () => {
    place('t', 'room-name', 3, 4);
    const before = rooms();
    const after = [{ ...before[0], name: 'Great Hall' }];
    undoManager.execute(new PropertyCommand('Rename room', { type: 'layer', layerId: layer().id }, { rooms: before }, { rooms: after }));
    expect(label('t').text).toBe('Great Hall');
    expect(undoManager.size()).toBe(1);
    undoManager.undo();
    expect(label('t').text).toBe('Warren Hall');
    expect(undoManager.size()).toBe(0);
  });

  it('a room not yet given its anchor (a file mid-load) is not a delete', () => {
    place('t', 'room-name', 3, 4);
    const r = rooms()[0];
    const { patches } = syncBoundLabels({
      layers: [{ ...layer(), rooms: [{ ...r, anchor: undefined as unknown as [number, number] }] }],
    });
    expect(patches).toEqual([]);
  });

  it('re-syncs 50 bound labels quickly (informative)', () => {
    for (let i = 0; i < 50; i++) place(`t${i}`, 'room-name', 1 + (i % 8), 1 + Math.floor(i / 8));
    const t0 = performance.now();
    setRooms([{ ...rooms()[0], name: 'Great Hall', anchor: [6, 6] }]);
    const ms = performance.now() - t0;
    expect(label('t49').text).toBe('Great Hall');
    console.info(`[boundLabels] 50 labels re-synced in ${ms.toFixed(2)} ms`);
  });
});
