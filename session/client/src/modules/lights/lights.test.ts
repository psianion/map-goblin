import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LightChild } from '@dnd/core/src/shared/types';
import type { Layer } from '@dnd/core/src/store/types';
import { useStore } from '@dnd/core/src/store/store';
import { worldToScreen } from '../../renderer/camera';
import { lightAt, lightPropAt, lightSwitchRows, mapLights, patchLightLocal, patchLightsLocal, propToggle, switchIdsOf } from './lights';

vi.mock('../../renderer/camera', () => ({
  worldToScreen: vi.fn(),
  frameWorldPoint: vi.fn(),
}));
const screenOf = vi.mocked(worldToScreen);

const light = (over: Partial<LightChild> = {}): LightChild =>
  ({
    id: 'l1',
    name: 'Brazier',
    childType: 'light',
    visible: true,
    color: '#fff',
    radius: 5,
    featherRadius: 1,
    intensity: 1,
    falloff: 'linear',
    position: { x: 0, y: 0 },
    ...over,
  }) as LightChild;

const dungeon = (children: LightChild[]): Layer =>
  ({ id: 'l1', type: 'dungeon', children, standaloneWalls: [], rooms: [] }) as unknown as Layer;

describe('mapLights', () => {
  it('lists authored lights but skips a token’s own carried torch', () => {
    const layers = [dungeon([light({ id: 'l1' }), light({ id: 'token-light:t1' })])];
    expect(mapLights(layers).map((h) => h.light.id)).toEqual(['l1']);
  });
});

describe('lightAt', () => {
  beforeEach(() => screenOf.mockReset());

  it('hits the nearest icon within 12 screen px', () => {
    const layers = [dungeon([light({ id: 'l1', position: { x: 0, y: 0 } })])];
    screenOf.mockReturnValue({ x: 100, y: 100 });
    expect(lightAt(layers, { x: 105, y: 100 })?.light.id).toBe('l1');
    expect(lightAt(layers, { x: 120, y: 100 })).toBeNull();
  });

  it('picks whichever icon is closer when two are both in range', () => {
    const layers = [
      dungeon([
        light({ id: 'far', position: { x: 0, y: 0 } }),
        light({ id: 'near', position: { x: 1, y: 0 } }),
      ]),
    ];
    screenOf.mockImplementation((x) => (x === 0 ? { x: 108, y: 100 } : { x: 100, y: 100 }));
    expect(lightAt(layers, { x: 100, y: 100 })?.light.id).toBe('near');
  });
});

describe('patchLightLocal', () => {
  it('writes only the fields the patch names, position as a fresh object', () => {
    const original = { x: 0, y: 0 };
    useStore.setState({ layers: [dungeon([light({ position: original })])] });

    patchLightLocal('l1', { radius: 9, position: { x: 3, y: 4 } });

    const child = (useStore.getState().layers[0] as unknown as { children: LightChild[] }).children[0];
    expect(child).toMatchObject({ radius: 9, color: '#fff', position: { x: 3, y: 4 } });
    expect(child.position).not.toBe(original);
  });

  it('does nothing for an id that is not on the map', () => {
    useStore.setState({ layers: [dungeon([light()])] });
    expect(() => patchLightLocal('gone', { radius: 9 })).not.toThrow();
    expect((useStore.getState().layers[0] as unknown as { children: LightChild[] }).children[0].radius).toBe(5);
  });
});

describe('switching light props and groups at the table', () => {
  const lamp = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    childType: 'light',
    name: id,
    visible: true,
    radius: 2,
    featherRadius: 1,
    intensity: 1,
    color: '#ffffff',
    falloff: 'quadratic',
    position: { x: 0, y: 0 },
    ...over,
  });
  const brazier = {
    id: 'b',
    childType: 'asset',
    name: 'b',
    visible: true,
    objectType: 'asset',
    assetId: 'gg-demo:x',
    position: { x: 10, y: 10 },
    rotation: 0,
    scale: 1,
    width: 2,
    height: 2,
    tint: '#ffffff',
    flipX: false,
    flipY: false,
  };
  const layers = (children: unknown[], locked = false) =>
    [{ id: 'L', type: 'dungeon', visible: true, locked, levelId: '', rooms: [], children }] as unknown as Layer[];

  it('finds the prop with a light under a point, and none for a prop without one', () => {
    const map = layers([brazier, lamp('f', { attachedTo: 'b' })]);
    expect(lightPropAt(map, { x: 10.9, y: 9.2 })?.id).toBe('b');
    expect(lightPropAt(map, { x: 12, y: 10 })).toBeNull();
    expect(lightPropAt(layers([brazier]), { x: 10, y: 10 })).toBeNull();
  });

  it('switches a prop`s lights and their group mates, off when any burns', () => {
    const map = layers([brazier, lamp('f', { attachedTo: 'b', group: 'Hall' }), lamp('m', { group: 'Hall', visible: false }), lamp('x')]);
    expect(propToggle(map, 'b')).toEqual({ ids: ['f', 'm'], on: false });
  });

  it('leaves darkness sources and locked group mates out of a switch', () => {
    const map = layers([lamp('a', { group: 'G' }), lamp('d', { group: 'G', darkness: true }), lamp('k', { group: 'G', locked: true })]);
    expect(switchIdsOf(map, ['a'])).toEqual(['a']);
  });
});

describe('switching many lights at once', () => {
  it('previews a whole group or room in one store write', () => {
    const children = Array.from({ length: 30 }, (_, i) => ({
      id: `g${i}`,
      childType: 'light',
      name: `g${i}`,
      visible: true,
      radius: 2,
      featherRadius: 1,
      intensity: 1,
      color: '#ffffff',
      falloff: 'quadratic',
      position: { x: i, y: 0 },
    }));
    useStore.setState({ layers: [{ id: 'L', type: 'dungeon', visible: true, locked: false, children }] as never });
    let writes = 0;
    const stop = useStore.subscribe(() => writes++);
    patchLightsLocal(children.map((c) => c.id), { visible: false });
    stop();
    expect(writes).toBe(1);
    expect(mapLights(useStore.getState().layers).every((h) => h.light.visible === false)).toBe(true);
  });
});

describe('the Map tab`s group rows count like the editor`s cards', () => {
  it('count a darkness source in the group, and switch only the lights set-lights takes', () => {
    const lamp = (id: string, extra: Record<string, unknown> = {}) => ({
      id, childType: 'light', name: id, visible: true, radius: 2, featherRadius: 1, intensity: 1, color: '#ffffff', falloff: 'quadratic', position: { x: 0, y: 0 }, group: 'Crypt', ...extra,
    });
    const layers = [{ id: 'L', type: 'dungeon', visible: true, locked: false, rooms: [], children: [lamp('a'), lamp('b'), lamp('void', { darkness: true })] }] as unknown as Layer[];
    const [row] = lightSwitchRows(layers, []).groups;
    expect(row).toMatchObject({ total: 3, count: '3 lights', ids: ['a', 'b'] });
  });
});
