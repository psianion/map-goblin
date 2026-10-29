import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

interface FakeSprite {
  label: string;
  zIndex: number;
  visible: boolean;
  alpha: number;
  parent: MockContainer | null;
}

class MockContainer {
  children: FakeSprite[] = [];
  addChild(c: FakeSprite): FakeSprite {
    c.parent?.removeChild(c);
    this.children.push(c);
    c.parent = this;
    return c;
  }
  removeChild(c: FakeSprite): FakeSprite {
    const i = this.children.indexOf(c);
    if (i >= 0) this.children.splice(i, 1);
    c.parent = null;
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
    scale = { x: 1, y: 1 };
    // PixiJS's size setters keep the scale's current sign (measureMixin's _setWidth /
    // _setHeight), so a flip applied on one sync is still there on the next.
    private w = 0;
    private h = 0;
    get width(): number { return this.w; }
    set width(v: number) {
      const local = (this.texture as { width?: number } | undefined)?.width ?? 0;
      const sign = Math.sign(this.scale.x) || 1;
      this.scale.x = local ? (v / local) * sign : sign;
      this.w = v;
    }
    get height(): number { return this.h; }
    set height(v: number) {
      const local = (this.texture as { height?: number } | undefined)?.height ?? 0;
      const sign = Math.sign(this.scale.y) || 1;
      this.scale.y = local ? (v / local) * sign : sign;
      this.h = v;
    }
    tint = 0;
    alpha = 1;
    parent: { removeChild(c: unknown): unknown } | null = null;
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
vi.mock('./sceneGraph', () => ({ getLayerEntry: vi.fn(), getOverheadContainer: vi.fn() }));
// The shadow pass is the sun's, not this loop's — it draws with the real PixiJS this file has
// mocked away. Its own contract is covered in shared/shadows.test.ts.
vi.mock('./shadowPass', () => ({ syncPropShadows: vi.fn() }));

import {
  SEE_UNDER_ALPHA,
  overheadEntries,
  setAssetChildrenAlpha,
  setOverheadFade,
  subscribeToAssets,
} from './subscribeToAssets';
import { getLayerEntry, getOverheadContainer } from './sceneGraph';
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
  let overheadLayer: MockContainer;
  let unsub: (() => void) | null = null;

  beforeEach(() => {
    useStore.getState().resetToDefault();
    // A view preference: the reset leaves it where the last test put it.
    useStore.setState((s) => {
      s.ui.seeUnderOverhead = false;
    });
    const layer = useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
    layerId = layer.id;
    objects = new MockContainer();
    overheadLayer = new MockContainer();
    vi.mocked(getOverheadContainer).mockReturnValue(overheadLayer as never);
    // All eight sublayers, not just the one this file cares about — a
    // regression that reads the wrong sublayer should fail loudly (undefined
    // access) instead of silently passing because the fake only had `objects`.
    vi.mocked(getLayerEntry).mockReturnValue({
      sublayers: {
        water: new MockContainer(),
        floor: new MockContainer(),
        shadows: new MockContainer(),
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

  const sprite = (id: string): FakeSprite =>
    [...objects.children, ...overheadLayer.children].find((s) => s.label === `placed-${id}`)!;

  it('keeps a flipped piece flipped through re-syncs caused by other children', () => {
    // A cave band laid as placed pieces mirrors its straights with flipY. Every layer
    // update re-syncs every sprite, so the flip has to come out the same each time or
    // the rock along one room's wall changes whenever anything else on the layer does.
    useStore.getState().addChild(layerId, { ...asset('rock'), flipY: true });
    useStore.getState().addChild(layerId, { ...asset('rock2'), flipX: true });
    useStore.getState().addChild(layerId, asset('other'));
    unsub = subscribeToAssets();
    const scaleOf = (id: string) => ({ ...(sprite(id) as FakeSprite & { scale: { x: number; y: number } }).scale });
    const first = { rock: scaleOf('rock'), rock2: scaleOf('rock2') };
    expect(first.rock.y).toBeLessThan(0);
    expect(first.rock.x).toBeGreaterThan(0);
    expect(first.rock2.x).toBeLessThan(0);
    expect(first.rock2.y).toBeGreaterThan(0);

    // Unrelated edits: another child's tint, then its position.
    useStore.getState().updateChild(layerId, 'other', { tint: '#ff2020' } as never);
    expect({ rock: scaleOf('rock'), rock2: scaleOf('rock2') }).toEqual(first);
    useStore.getState().updateChild(layerId, 'other', { position: { x: 3, y: 1 } } as never);
    expect({ rock: scaleOf('rock'), rock2: scaleOf('rock2') }).toEqual(first);

    // Unflipping still takes.
    useStore.getState().updateChild(layerId, 'rock', { flipY: false } as never);
    expect(scaleOf('rock').y).toBeGreaterThan(0);
  });

  it('draws a prop at its opacity times any fade on it', () => {
    useStore.getState().addChild(layerId, { ...asset('a1'), opacity: 0.5 });
    unsub = subscribeToAssets();
    expect(sprite('a1').alpha).toBe(0.5);

    setAssetChildrenAlpha(layerId, ['a1'], 0.3);
    expect(sprite('a1').alpha).toBeCloseTo(0.15);
    // A store update mid-gesture keeps the fade.
    useStore.getState().updateChild(layerId, 'a1', { position: { x: 2, y: 2 } } as never);
    expect(sprite('a1').alpha).toBeCloseTo(0.15);

    setAssetChildrenAlpha(layerId, ['a1'], 1);
    expect(sprite('a1').alpha).toBe(0.5);
  });

  it('puts overhead props in the overhead container, ordered by layer then index', () => {
    useStore.getState().addChild(layerId, asset('a1'));
    useStore.getState().addChild(layerId, { ...asset('canopy'), overhead: true });
    unsub = subscribeToAssets();
    const layerIndex = useStore.getState().layers.findIndex((l) => l.id === layerId);

    expect(objects.children.map((s) => s.label)).toEqual(['placed-a1']);
    expect(overheadLayer.children.map((s) => s.label)).toEqual(['placed-canopy']);
    expect(sprite('canopy').zIndex).toBe(layerIndex * 1e5 + 1);

    // Switching overhead off brings it back down into its layer, same sprite.
    const canopy = sprite('canopy');
    useStore.getState().updateChild(layerId, 'canopy', { overhead: false } as never);
    expect(objects.children).toContain(canopy);
    expect(overheadLayer.children).toHaveLength(0);
    expect(canopy.zIndex).toBe(1);
  });

  it("carries its layer's visibility and opacity onto an overhead sprite", () => {
    useStore.getState().addChild(layerId, { ...asset('canopy'), overhead: true, opacity: 0.8 });
    unsub = subscribeToAssets();
    useStore.getState().updateLayer(layerId, { opacity: 0.5 });
    expect(sprite('canopy').alpha).toBeCloseTo(0.4);
    useStore.getState().updateLayer(layerId, { visible: false });
    expect(sprite('canopy').visible).toBe(false);
    useStore.getState().updateLayer(layerId, { visible: true });
    expect(sprite('canopy').visible).toBe(true);
  });

  it('fades overhead props while the DM looks under them', () => {
    useStore.getState().addChild(layerId, { ...asset('canopy'), overhead: true });
    useStore.getState().addChild(layerId, asset('a1'));
    unsub = subscribeToAssets();
    useStore.setState((s) => {
      s.ui.seeUnderOverhead = true;
    });
    expect(sprite('canopy').alpha).toBeCloseTo(SEE_UNDER_ALPHA);
    expect(sprite('a1').alpha).toBe(1);
  });

  it('lists overhead props with their boxes, and fades one by id', () => {
    useStore.getState().addChild(layerId, {
      ...asset('canopy'),
      overhead: true,
      position: { x: 4, y: 5 },
      width: 2,
      height: 1,
      scale: 2,
      rotation: Math.PI / 2,
    });
    useStore.getState().addChild(layerId, asset('a1'));
    unsub = subscribeToAssets();

    const entries = overheadEntries();
    expect(entries.map((e) => e.childId)).toEqual(['canopy']);
    expect(entries[0].obb).toEqual({ cx: 4, cy: 5, hw: 2, hh: 1, rot: Math.PI / 2 });

    setOverheadFade('canopy', 0.25);
    expect(sprite('canopy').alpha).toBeCloseTo(0.25);
    setOverheadFade('canopy', 1);
    expect(sprite('canopy').alpha).toBe(1);
  });
});
