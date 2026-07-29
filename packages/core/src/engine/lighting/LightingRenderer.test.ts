import { describe, expect, it, vi } from 'vitest';

// The composite itself needs a GPU, so the browser gate owns "does it look right". What is
// checkable here is which frames it runs on at all — so Pixi and the texture loader are
// stubbed down to bookkeeping and `updateAndRender` runs end to end on the CPU.
vi.mock('pixi.js', () => {
  class MockContainer {
    label = '';
    children: { label: string }[] = [];
    addChild(c: { label: string }): unknown {
      this.children.push(c);
      return c;
    }
    removeChild(c: { label: string }): unknown {
      const i = this.children.indexOf(c);
      if (i >= 0) this.children.splice(i, 1);
      return c;
    }
    removeChildren(): void {
      this.children = [];
    }
    destroy(): void {}
  }
  class MockGraphics extends MockContainer {
    clear(): this { return this; }
    rect(): this { return this; }
    fill(): this { return this; }
    stroke(): this { return this; }
    circle(): this { return this; }
    setStrokeStyle(): this { return this; }
    moveTo(): this { return this; }
    lineTo(): this { return this; }
    closePath(): this { return this; }
  }
  class MockSprite extends MockContainer {
    texture: unknown;
    width = 0;
    height = 0;
    alpha = 1;
    tint = 0;
    blendMode = '';
    visible = true;
    anchor = { set: (): void => {} };
    position = { set: (): void => {} };
    scale = { set: (): void => {} };
    constructor(texture?: unknown) {
      super();
      this.texture = texture;
    }
  }
  class MockFillGradient {
    destroy(): void {}
  }
  class MockRenderTexture {}
  return {
    Container: MockContainer,
    Graphics: MockGraphics,
    Sprite: MockSprite,
    FillGradient: MockFillGradient,
    RenderTexture: MockRenderTexture,
  };
});
vi.mock('../../assets/textureLoader', () => ({
  resolveTexture: () => ({ width: 1, height: 1 }),
}));

import { LightingRenderer, lightingSignature } from './LightingRenderer';
import { LightManager } from './LightManager';
import type { RenderEngine } from '../RenderEngine';
import type { LightChild } from '../../store/types';

/**
 * The lighting composite is skipped when its signature is unchanged, so the signature is
 * the whole of the guard's correctness: anything that moves the picture and is *not* in
 * here becomes a frame that silently keeps the previous one.
 *
 * Measured on the dressed gate map (Emberhold, 4 lights, 206 walls, 1280x720): the pass it
 * guards costs ~2-3ms of a ~22ms frame, and uploads one gradient texture per light per
 * frame. An idle table changes none of these fields.
 */

const light = (over: Partial<LightChild> = {}): LightChild => ({
  id: 'light-1',
  name: 'Brazier',
  childType: 'light',
  visible: true,
  color: '#ffaa55',
  radius: 40,
  featherRadius: 8,
  intensity: 0.9,
  falloff: 'quadratic',
  position: { x: 12, y: 20 },
  ...over,
});

const clean = () => false;
const sig = (
  lights: LightChild[] = [light()],
  cam: [number, number, number] = [100, 200, 1.5],
  size: [number, number] = [1280, 720],
  ambient = '#0d0e12',
  isDirty: (id: string) => boolean = clean,
) => lightingSignature(cam[0], cam[1], cam[2], size[0], size[1], ambient, lights, isDirty);

describe('lightingSignature', () => {
  it('is stable while nothing moves — the frame the guard skips', () => {
    expect(sig()).toBe(sig());
  });

  /**
   * One case per input the composite reads. The light positions are converted to *screen*
   * space before they are drawn, which is why the camera counts as much as the light does.
   */
  const changes: [string, () => string][] = [
    ['camera x (pan)', () => sig([light()], [101, 200, 1.5])],
    ['camera y (pan)', () => sig([light()], [100, 201, 1.5])],
    ['zoom', () => sig([light()], [100, 200, 1.6])],
    ['viewport width', () => sig([light()], [100, 200, 1.5], [1281, 720])],
    ['viewport height', () => sig([light()], [100, 200, 1.5], [1280, 721])],
    ['ambient colour', () => sig([light()], [100, 200, 1.5], [1280, 720], '#101014')],
    ['light moved', () => sig([light({ position: { x: 13, y: 20 } })])],
    ['light radius', () => sig([light({ radius: 41 })])],
    ['light colour', () => sig([light({ color: '#ff0000' })])],
    ['light intensity', () => sig([light({ intensity: 0.5 })])],
    ['light falloff', () => sig([light({ falloff: 'linear' })])],
    ['light feather', () => sig([light({ featherRadius: 9 })])],
    ['light mask texture', () => sig([light({ maskTextureId: 'pack:mask' })])],
    ['a different light', () => sig([light({ id: 'light-2' })])],
    ['a second light', () => sig([light(), light({ id: 'light-2' })])],
    ['no lights at all', () => sig([])],
    // A door swings or a wall moves and LightManager marks the polygon stale: the geometry
    // changed underneath a light that did not itself move.
    ['visibility polygon invalidated', () => sig([light()], [100, 200, 1.5], [1280, 720], '#0d0e12', () => true)],
  ];

  for (const [what, produce] of changes) {
    it(`changes when ${what}`, () => {
      expect(produce()).not.toBe(sig());
    });
  }

  it('does not confuse a moved light with a moved camera', () => {
    expect(sig([light({ position: { x: 13, y: 20 } })])).not.toBe(sig([light()], [101, 200, 1.5]));
  });
});

// ── The guard in place ──────────────────────────────────────────────────────
// The signature above only proves a field is *in* the key. These pin the frame the guard
// actually lets through: a resize has to reach `this.width` before the key is built, or the
// skip eats it and the table keeps the old picture in a freshly blanked buffer.

type FakeTexture = { width: number; height: number; destroy: () => void };

/** A renderer on a fake engine that records the texture every pass drew into. */
function table() {
  const overlay = {
    children: [] as { label: string }[],
    addChild(c: { label: string }) {
      this.children.push(c);
      return c;
    },
    removeChild(c: { label: string }) {
      const i = this.children.indexOf(c);
      if (i >= 0) this.children.splice(i, 1);
      return c;
    },
  };
  const viewport = { width: 1280, height: 720, dpr: 1 };
  const drawnInto: FakeTexture[] = [];
  const engine = {
    overlay: () => overlay,
    viewport: () => viewport,
    worldToScreen: (wx: number, wy: number) => ({ x: wx, y: wy }),
    createRenderTexture: (width: number, height: number): FakeTexture => ({
      width,
      height,
      destroy: () => {},
    }),
    renderToTexture: (_c: unknown, texture: FakeTexture) => {
      drawnInto.push(texture);
    },
  } as unknown as RenderEngine;

  const lights = new LightManager();
  lights.syncFromStore([light()]);
  lights.rebuildIfDirty([]);

  const renderer = new LightingRenderer(engine, viewport.width, viewport.height);
  const frame = (ambient = '#0d0e12'): void =>
    renderer.updateAndRender(lights, 100, 200, 1.5, ambient);

  // A freshly synced light starts dirty; two frames settle the polygon rebuild it earns.
  frame();
  frame();
  return { renderer, lights, overlay, viewport, drawnInto, frame };
}

const iconCount = (overlay: { children: { label: string }[] }): number =>
  overlay.children.filter((c) => c.label.startsWith('light-icon-')).length;

describe('LightingRenderer composite guard', () => {
  it('draws nothing on an idle frame', () => {
    const t = table();
    const settled = t.drawnInto.length;
    t.frame();
    expect(t.drawnInto.length).toBe(settled);
  });

  it('recomposites at the new size when only the viewport resized', () => {
    const t = table();
    const settled = t.drawnInto.length;
    t.viewport.width = 1600;
    t.viewport.height = 900;
    t.frame();
    expect(t.drawnInto.length).toBeGreaterThan(settled);
    expect(t.drawnInto.at(-1)).toMatchObject({ width: 1600, height: 900 });
  });

  it('recomposites when the resize came from outside the render loop', () => {
    const t = table();
    t.viewport.width = 1600;
    t.viewport.height = 900;
    t.renderer.resize(1600, 900);
    const settled = t.drawnInto.length;
    t.frame();
    expect(t.drawnInto.length).toBeGreaterThan(settled);
    expect(t.drawnInto.at(-1)).toMatchObject({ width: 1600, height: 900 });
  });

  it('recomposites when a door swing invalidates the light polygons', () => {
    const t = table();
    const settled = t.drawnInto.length;
    // What a door's state change does once the store subscription sees it.
    t.lights.invalidateAll();
    t.frame();
    expect(t.drawnInto.length).toBeGreaterThan(settled);
  });

  it('recomposites when the ambient level changes', () => {
    const t = table();
    const settled = t.drawnInto.length;
    t.frame('#202030');
    expect(t.drawnInto.length).toBeGreaterThan(settled);
  });

  it('rearms after the last light is hidden and lit again', () => {
    const t = table();
    t.lights.syncFromStore([light({ visible: false })]);
    t.frame();
    const dark = t.drawnInto.length;
    t.lights.syncFromStore([light()]);
    t.frame();
    expect(t.drawnInto.length).toBeGreaterThan(dark);
  });
});

describe('LightingRenderer light icons', () => {
  it('draws the editing icons unless something opts out', () => {
    const t = table();
    expect(iconCount(t.overlay)).toBe(1);
  });

  it('drops the icons and stops redrawing them once they are turned off', () => {
    const t = table();
    t.renderer.setIconsVisible(false);
    expect(iconCount(t.overlay)).toBe(0);
    t.frame();
    expect(iconCount(t.overlay)).toBe(0);
  });
});
