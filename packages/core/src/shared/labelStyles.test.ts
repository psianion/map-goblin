import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store/store';
import type { DungeonLayer } from '../store/types';
import type { DoorChild, Room } from './types';
import { GM_NOTE_GREY, LABEL_STYLES, findBindTarget, labelFor, labelStyle, styleLook } from './labelStyles';
import { measureLabel } from '../engine/labelMetrics';

const square = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

const room = (id: string, name: string, number: number, x0: number, y0: number, x1: number, y1: number): Room => ({
  id,
  name,
  number,
  anchor: [(x0 + x1) / 2, (y0 + y1) / 2],
  boundary: square(x0, y0, x1, y1),
});

const door = (id: string, name: string, at: [number, number]): DoorChild => ({
  id,
  name,
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

function layer(): DungeonLayer {
  return useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
}

beforeEach(() => {
  useStore.getState().resetToDefault();
  const l = layer();
  useStore.getState().updateLayer(l.id, {
    rooms: [room('hall', 'Warren Hall', 4, 0, 0, 10, 10), room('nook', 'Plunder Nook', 7, 20, 0, 30, 10)],
    style: { ...l.style, wallColor: '#202020' },
  } as Partial<DungeonLayer>);
  useStore.getState().addChild(l.id, door('d1', 'Door 1', [15, 5]));
});

const at = (x: number, y: number) => ({ x, y });
const place = (style: Parameters<typeof labelFor>[0], x: number, y: number, o?: Parameters<typeof labelFor>[4]) =>
  labelFor(style, at(x, y), useStore.getState().layers, layer().id, o);

describe('label styles', () => {
  it('offers the five presets and Custom, in board order', () => {
    expect(LABEL_STYLES.map((s) => s.name)).toEqual(['Room name', 'Door tag', 'GM note', 'Number pin', 'Callout', 'Custom']);
    expect(labelStyle(undefined).name).toBe('Custom');
  });

  it('a Room name inside a room lands bold with a halo, bound, with the room’s name', () => {
    const c = place('room-name', 3, 4);
    expect(c).toMatchObject({ text: 'Warren Hall', fontSize: 0.8, weight: 'bold', backdrop: 'halo', style: 'room-name', color: '#202020' });
    expect(c.align).toBeUndefined();
    expect(c.bound).toEqual({ kind: 'room', id: 'hall' });
    expect(c.position).toEqual({ x: 3, y: 4 });
  });

  it('keeps the click as the place: the offset is the click less the anchor', () => {
    const c = place('room-name', 3, 4);
    expect(c.offset).toEqual([3 - 5, 4 - 5]);
  });

  it('a Number pin shows the room’s number in a bold pill', () => {
    const c = place('number-pin', 25, 5);
    expect(c).toMatchObject({ text: '7', fontSize: 0.6, weight: 'bold', backdrop: 'pill', bound: { kind: 'room', id: 'nook' } });
  });

  it('a Door tag takes the nearest door within a square and a half, and no door further off', () => {
    const c = place('door-tag', 15.6, 5.4);
    expect(c).toMatchObject({ text: 'Door 1', fontSize: 0.4, backdrop: 'pill', bound: { kind: 'door', id: 'd1' } });
    expect(c.offset![0]).toBeCloseTo(0.6, 9);
    expect(findBindTarget('door', at(16.4, 5), useStore.getState().layers, layer().id)?.binding).toEqual({ kind: 'door', id: 'd1' });
    expect(findBindTarget('door', at(17, 5), useStore.getState().layers, layer().id)).toBeNull();
  });

  it('with nothing under it, a binding style is a free label with its default text', () => {
    const c = place('room-name', 15, 30);
    expect(c.text).toBe('Room');
    expect(c.bound).toBeUndefined();
    expect(c.offset).toBeUndefined();
    expect(place('door-tag', 3, 3).text).toBe('Door');
  });

  it('a GM note is grey, left-aligned, in a pill, and DM-only', () => {
    const c = place('gm-note', 3, 3);
    expect(c).toMatchObject({ text: 'Note', fontSize: 0.5, backdrop: 'pill', align: 'left', color: GM_NOTE_GREY });
    expect(c.players).toBeUndefined();
    expect(c.bound).toBeUndefined();
  });

  it('Callout and Custom carry their own look; Custom writes no style keys at all', () => {
    expect(place('callout', 3, 3)).toMatchObject({ text: 'Callout', fontSize: 0.5, backdrop: 'halo', align: 'left' });
    const custom = place(undefined, 3, 3);
    expect(custom.text).toBe('Label');
    for (const k of ['style', 'weight', 'backdrop', 'align', 'players', 'bound', 'offset']) expect(k in custom).toBe(false);
  });

  it('the dock’s size and colour override the style’s, and the box is measured with them', () => {
    const c = place('door-tag', 15, 5, { fontSize: 1.2, color: '#808080' });
    expect(c.fontSize).toBe(1.2);
    expect(c.color).toBe('#808080');
    expect({ width: c.width, height: c.height }).toEqual(measureLabel('Door 1', 1.2, { backdrop: 'pill' }));
  });

  it('styleLook clears what the previous style set', () => {
    const look = styleLook(labelStyle(undefined), '#111111');
    expect(look).toEqual({ style: undefined, fontSize: 0.8, weight: undefined, backdrop: undefined, align: undefined, color: '#111111' });
  });
});
