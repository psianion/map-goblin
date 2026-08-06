import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

interface FakeSprite {
  label: string;
  zIndex: number;
  visible: boolean;
}

class MockContainer {
  children: FakeSprite[] = [];
  addChild(c: FakeSprite): FakeSprite {
    this.children.push(c);
    return c;
  }
  removeChild(c: FakeSprite): FakeSprite {
    const i = this.children.indexOf(c);
    if (i >= 0) this.children.splice(i, 1);
    return c;
  }
}

// Mock classes live inside the factory — vi.mock is hoisted above any
// top-level class declaration it would otherwise close over (TDZ).
vi.mock('pixi.js', () => {
  class MockSprite {
    visible = true;
    position = { x: 0, y: 0, set(x: number, y: number): void { this.x = x; this.y = y; } };
    rotation = 0;
    width = 0;
    height = 0;
    scale = { x: 1, y: 1 };
    tint = 0;
    anchor = { set: (): void => {} };
    label = '';
    zIndex = 0;
    texture: unknown;
    constructor(t?: unknown) { this.texture = t; }
    destroy(): void {}
  }
  return {
    Sprite: MockSprite,
    Assets: { get: vi.fn(), load: vi.fn(() => Promise.resolve(undefined)), add: vi.fn() },
    Texture: { WHITE: {} },
  };
});
vi.mock('../assets/textureLoader', () => ({
  resolveTexture: (id: string) => ({ id, width: 200, height: 200 }),
}));
vi.mock('../assets/textureManifest', () => ({
  getTextureEntry: () => null,
}));
vi.mock('./sceneGraph', () => ({ getLayerEntry: vi.fn() }));

import { subscribeToAssets } from './subscribeToAssets';
import { getLayerEntry } from './sceneGraph';
import { useStore } from '../store/store';
import type { AssetChild, DungeonLayer } from '../store/types';

function asset(id: string): AssetChild {
  return {
    id,
    name: id,
    childType: 'asset',
    visible: true,
    objectType: 'asset',
    assetId: 'tree-a',
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: 1,
    width: 1,
    height: 1,
    tint: '#ffffff',
    flipX: false,
    flipY: false,
  };
}

describe('subscribeToAssets', () => {
  let layerId: string;
  let objects: MockContainer;
  let unsub: (() => void) | null = null;

  beforeEach(() => {
    useStore.getState().resetToDefault();
    const layer = useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
    layerId = layer.id;
    objects = new MockContainer();
    // All seven sublayers, not just the one this file cares about — a
    // regression that reads the wrong sublayer should fail loudly (undefined
    // access) instead of silently passing because the fake only had `objects`.
    vi.mocked(getLayerEntry).mockReturnValue({
      sublayers: {
        water: new MockContainer(),
        floor: new MockContainer(),
        grid: new MockContainer(),
        walls: new MockContainer(),
        doors: new MockContainer(),
        objects,
        labels: new MockContainer(),
      },
    } as never);
  });

  afterEach(() => {
    unsub?.();
    unsub = null;
  });

  it('lands sprites in the objects sublayer', () => {
    useStore.getState().addChild(layerId, asset('a1'));
    unsub = subscribeToAssets();
    expect(objects.children.length).toBe(1);
    expect(objects.children[0].label).toBe('placed-a1');
  });

  it('assigns zIndex to match position in layer.children', () => {
    useStore.getState().addChild(layerId, asset('a1'));
    useStore.getState().addChild(layerId, asset('a2'));
    unsub = subscribeToAssets();
    expect(objects.children[0].zIndex).toBe(0);
    expect(objects.children[1].zIndex).toBe(1);
  });

  it('re-resolves the texture when a swap changes assetId', () => {
    useStore.getState().addChild(layerId, asset('a1'));
    unsub = subscribeToAssets();
    const sprite = objects.children[0] as FakeSprite & { texture: { id: string } };
    expect(sprite.texture.id).toBe('tree-a');

    useStore.getState().updateChild(layerId, 'a1', { assetId: 'tree-b' } as never);
    expect(sprite.texture.id).toBe('tree-b');
    // Same sprite, not a rebuild — position/order state must survive the swap.
    expect(objects.children.length).toBe(1);
    expect(objects.children[0]).toBe(sprite);
  });

  it('reorderChild updates zIndex to match the new order', () => {
    useStore.getState().addChild(layerId, asset('a1'));
    useStore.getState().addChild(layerId, asset('a2'));
    unsub = subscribeToAssets();

    useStore.getState().reorderChild(layerId, 0, 1); // a1 now draws after a2

    const a1 = objects.children.find((s) => s.label === 'placed-a1')!;
    const a2 = objects.children.find((s) => s.label === 'placed-a2')!;
    expect(a2.zIndex).toBe(0);
    expect(a1.zIndex).toBe(1);
  });
});
