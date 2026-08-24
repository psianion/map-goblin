import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LightChild } from '@dnd/core/src/shared/types';
import type { Layer } from '@dnd/core/src/store/types';
import { useStore } from '@dnd/core/src/store/store';
import { worldToScreen } from '../../renderer/camera';
import { lightAt, mapLights, patchLightLocal } from './lights';

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
