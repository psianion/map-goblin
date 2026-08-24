import { describe, it, expect, beforeEach, vi } from 'vitest';

// The glyphs themselves need a 2D canvas, so what is checkable here is the bookkeeping: which
// doors get a mark, which texture and tint it carries, and that the sprites are pooled rather
// than rebuilt. Pixi is stubbed down to the same bookkeeping `LightingRenderer.test.ts` uses.
vi.mock('pixi.js', () => {
  class MockContainer {
    label = '';
    eventMode = '';
    destroyed = false;
    children: MockContainer[] = [];
    position = {
      x: 0,
      y: 0,
      set(x: number, y: number): void { this.x = x; this.y = y; },
      copyFrom(p: { x: number; y: number }): void { this.x = p.x; this.y = p.y; },
    };
    scale = {
      x: 1,
      y: 1,
      set(x: number, y: number): void { this.x = x; this.y = y; },
      copyFrom(p: { x: number; y: number }): void { this.x = p.x; this.y = p.y; },
    };
    parent: MockContainer | null = null;
    addChild(c: MockContainer): MockContainer {
      c.parent = this;
      this.children.push(c);
      return c;
    }
    /** Pixi's own destroy detaches from the parent; the reap test reads that. */
    destroy(): void {
      this.destroyed = true;
      const i = this.parent?.children.indexOf(this) ?? -1;
      if (i >= 0) this.parent!.children.splice(i, 1);
      this.parent = null;
    }
  }
  class MockSprite extends MockContainer {
    texture: unknown;
    tint = 0;
    size = 0;
    anchor = { set: (): void => {} };
    setSize(v: number): void {
      this.size = v;
    }
  }
  return { Container: MockContainer, Sprite: MockSprite, Texture: { WHITE: {} } };
});

// The glyph name stands in for the texture — Path2D does not exist in jsdom, so the real
// rasterizer hands every glyph the same white fallback and open/closed would be indistinguishable.
vi.mock('./lucideIcons', () => ({ lucideTexture: (glyph: string) => glyph }));

import { mountDoorIcons } from './doorIconRenderer';
import type { RenderEngine } from './RenderEngine';
import { useStore } from '../store/store';
import { createDungeonLayer } from '../store/factories';
import type { DoorChild } from '../shared/types';
import type { DungeonLayer } from '../store/types';

function makeDoor(overrides?: Partial<DoorChild>): DoorChild {
  return {
    id: 'door-1',
    name: 'Door',
    childType: 'door',
    visible: true,
    wallId: '',
    position: [3, 4],
    angle: 0,
    width: 1,
    style: 'single',
    state: 'closed',
    isSecret: false,
    ...overrides,
  };
}

type MockSprite = {
  texture: unknown;
  tint: number;
  size: number;
  position: { x: number; y: number };
  destroyed: boolean;
};
type MockLayer = { children: MockSprite[]; destroyed: boolean };

interface Harness {
  sprites: MockSprite[];
  overlayChildren: number;
  layerDestroyed: boolean;
  tick: () => void;
  unmount: () => void;
}

function mount(): Harness {
  const overlay = {
    children: [] as MockLayer[],
    addChild(c: MockLayer): MockLayer {
      this.children.push(c);
      return c;
    },
  };
  const stage = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 } };
  let tick: () => void = () => {};
  const engine = {
    overlay: () => overlay,
    stage: () => stage,
    ticker: () => ({
      add: (fn: () => void) => {
        tick = fn;
      },
      remove: () => {},
    }),
  } as unknown as RenderEngine;
  const unmount = mountDoorIcons(engine);
  const layer = overlay.children[0];
  return {
    get sprites() {
      return layer.children;
    },
    get overlayChildren() {
      return overlay.children.length;
    },
    get layerDestroyed() {
      return layer.destroyed;
    },
    tick: () => tick(),
    unmount,
  };
}

function seed(...layers: DungeonLayer[]): void {
  useStore.setState((s) => {
    s.layers = layers;
  });
}

describe('mountDoorIcons', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
  });

  it('draws one mark per door, at the resolved position, with the state glyph', () => {
    const layer = createDungeonLayer('L');
    layer.children = [makeDoor()];
    seed(layer);

    const h = mount();
    h.tick();

    expect(h.sprites).toHaveLength(1);
    expect(h.sprites[0].texture).toBe('door-closed');
    expect(h.sprites[0].position).toMatchObject({ x: 3, y: 4 });
    expect(h.sprites[0].size).toBeCloseTo(0.75);
    h.unmount();
  });

  it('shows the open glyph for an open door and the closed one for a locked door', () => {
    const layer = createDungeonLayer('L');
    layer.children = [
      makeDoor({ id: 'a', state: 'open' }),
      makeDoor({ id: 'b', state: 'locked', position: [8, 8] }),
    ];
    seed(layer);

    const h = mount();
    h.tick();

    expect(h.sprites.map((s) => s.texture)).toEqual(['door-open', 'door-closed']);
    h.unmount();
  });

  it('skips archways and hidden doors', () => {
    const layer = createDungeonLayer('L');
    layer.children = [
      makeDoor({ id: 'arch', style: 'archway' }),
      makeDoor({ id: 'hidden', visible: false }),
      makeDoor({ id: 'real' }),
    ];
    seed(layer);

    const h = mount();
    h.tick();

    expect(h.sprites).toHaveLength(1);
    h.unmount();
  });

  it('skips doors on a hidden layer', () => {
    const layer = createDungeonLayer('L');
    layer.visible = false;
    layer.children = [makeDoor()];
    seed(layer);

    const h = mount();
    h.tick();

    expect(h.sprites).toHaveLength(0);
    h.unmount();
  });

  it('tints a secret door gold and an ordinary one parchment', () => {
    const layer = createDungeonLayer('L');
    layer.children = [makeDoor({ id: 'plain' }), makeDoor({ id: 'secret', isSecret: true, position: [9, 9] })];
    seed(layer);

    const h = mount();
    h.tick();

    expect(h.sprites.map((s) => s.tint)).toEqual([0xe0d6c3, 0xe0b252]);
    h.unmount();
  });

  it('reuses sprites across redraws and reaps the ones whose door is gone', () => {
    const layer = createDungeonLayer('L');
    layer.children = [makeDoor({ id: 'a' }), makeDoor({ id: 'b', position: [7, 7] })];
    seed(layer);

    const h = mount();
    h.tick();
    const first = h.sprites[0];
    expect(h.sprites).toHaveLength(2);

    // A store edit replaces `layers` wholesale, which is what the redraw guard watches.
    const next = createDungeonLayer('L2');
    next.children = [makeDoor({ id: 'a', state: 'open' })];
    seed(next);
    h.tick();

    expect(h.sprites).toHaveLength(1);
    expect(h.sprites[0]).toBe(first);
    expect(h.sprites[0].texture).toBe('door-open');
    h.unmount();
  });

  it('adds exactly one overlay layer and tears it down on unmount', () => {
    const layer = createDungeonLayer('L');
    layer.children = [makeDoor()];
    seed(layer);

    const h = mount();
    expect(h.overlayChildren).toBe(1);
    h.unmount();
    expect(h.layerDestroyed).toBe(true);
  });
});
