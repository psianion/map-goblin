import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), dismiss: vi.fn() }),
}));

import { Container, Graphics } from 'pixi.js';
import { useStore } from '@/store/store';
import type { AssetChild, DungeonLayer } from '@/store/types';
import type { RenderEngine } from '@/engine/RenderEngine';
import { groupSelection } from '@/canvas/groupActions';
import { mountPropOverlay, propOverlayModel, type PropOverlayHandle } from './propOverlay';

function layer(): DungeonLayer {
  return useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
}

function prop(id: string, patch: Partial<AssetChild> = {}): AssetChild {
  return {
    id,
    name: id,
    childType: 'asset',
    visible: true,
    objectType: 'asset',
    assetId: 'crate',
    position: { x: 5, y: 5 },
    rotation: 0,
    scale: 1,
    width: 1,
    height: 1,
    tint: '#ffffff',
    flipX: false,
    flipY: false,
    ...patch,
  };
}

beforeEach(() => {
  useStore.getState().resetToDefault();
  useStore.getState().setActiveTool('select');
  useStore.getState().addChild(layer().id, prop('rug', { locked: true, position: { x: 2, y: 2 } }));
  useStore.getState().addChild(layer().id, prop('fire', { locked: true, position: { x: 8, y: 8 } }));
  useStore.getState().addChild(layer().id, prop('crate', { position: { x: 4, y: 4 } }));
  useStore.getState().addChild(layer().id, prop('barrel', { position: { x: 6, y: 4 } }));
});

describe('propOverlayModel', () => {
  it('shows every lock with the Props tool in hand, else only the hovered one', () => {
    expect(propOverlayModel(useStore.getState()).locks).toEqual([]);
    useStore.getState().setHoveredId('rug');
    let model = propOverlayModel(useStore.getState());
    expect(model.locks.map((c) => c.id)).toEqual(['rug']);
    expect(model.hover?.id).toBe('rug');

    useStore.getState().setHoveredId(null);
    useStore.getState().setActiveTool('scatterBrush');
    model = propOverlayModel(useStore.getState());
    expect(model.locks.map((c) => c.id)).toEqual(['rug', 'fire']);
    expect(model.hover).toBeNull();
  });

  it('outlines a hovered prop only when it is locked', () => {
    useStore.getState().setHoveredId('crate');
    expect(propOverlayModel(useStore.getState()).hover).toBeNull();
  });

  it('boxes a group selected whole, and not one member of it', () => {
    useStore.getState().setSelectedIds(['crate', 'barrel']);
    groupSelection();
    useStore.getState().setSelectedIds(['crate', 'barrel']);
    expect(propOverlayModel(useStore.getState()).groups).toEqual([{ x: 3.5, y: 3.5, width: 3, height: 1 }]);
    useStore.getState().setSelectedIds(['crate']);
    expect(propOverlayModel(useStore.getState()).groups).toEqual([]);
  });
});

describe('mountPropOverlay', () => {
  let frame: (() => void) | null = null;
  let overlay: PropOverlayHandle;
  let screen: Container;

  const tick = (): void => {
    const f = frame;
    frame = null;
    f?.();
  };

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      frame = cb;
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const world = new Container();
    world.scale.set(20);
    screen = new Container();
    screen.addChild(new Graphics());
    overlay = mountPropOverlay({ stage: () => world, overlay: () => screen } as unknown as RenderEngine);
  });

  afterEach(() => {
    overlay.destroy();
    vi.unstubAllGlobals();
  });

  const glyphCount = (): number => {
    const root = screen.children.find((c) => c.label === 'propOverlay') as Container;
    return (root.children[1] as Container).children.length;
  };

  it('costs nothing while an unlocked prop is dragged', () => {
    tick();
    const before = overlay.stats().redraws;
    for (let i = 0; i < 20; i++) {
      useStore.getState().updateChild(layer().id, 'crate', { position: { x: 4 + i * 0.1, y: 4 } });
      tick();
    }
    expect(overlay.stats().redraws).toBe(before);
  });

  it('redraws once when a selected prop moves in the store (a card edit, Align, a nudge), and not for edits that move nothing', () => {
    useStore.getState().setSelectedIds(['crate']);
    tick();
    const before = overlay.stats().redraws;
    useStore.getState().updateChild(layer().id, 'crate', { position: { x: 4.5, y: 4 } });
    tick();
    tick();
    expect(overlay.stats().redraws).toBe(before + 1);
    // A tint leaves the geometry alone: nothing to redraw.
    useStore.getState().updateChild(layer().id, 'crate', { tint: '#ff0000' });
    tick();
    expect(overlay.stats().redraws).toBe(before + 1);
  });

  it('redraws once when a locked prop comes under the pointer, and pools its glyph', () => {
    tick();
    const before = overlay.stats().redraws;
    useStore.getState().setHoveredId('rug');
    tick();
    tick();
    expect(overlay.stats().redraws).toBe(before + 1);
    expect(glyphCount()).toBe(1);

    useStore.getState().setActiveTool('scatterBrush');
    tick();
    expect(glyphCount()).toBe(2);
    useStore.getState().setActiveTool('select');
    useStore.getState().setHoveredId(null);
    tick();
    expect(glyphCount()).toBe(0);
  });
});
