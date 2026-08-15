import { describe, expect, it, vi, beforeEach } from 'vitest';

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
// Mutable so a single test can simulate a mask texture's width changing mid-session —
// a pack atlas resolves to a 1x1 placeholder until it finishes loading, then swaps in.
let mockMaskWidth = 1;
vi.mock('../../assets/textureLoader', () => ({
  resolveTexture: () => ({ width: mockMaskWidth, height: mockMaskWidth }),
}));

// Mutable for the same reason: tests toggle the OS reduced-motion answer.
let mockReducedMotion = false;
vi.mock('../motion', () => ({
  prefersReducedMotion: () => mockReducedMotion,
}));

import { LightingRenderer, lightingSignature, flickerFactor, cullLightsByDistance, MAX_RENDERED_LIGHTS } from './LightingRenderer';
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
  nowMs = 0,
) => lightingSignature(cam[0], cam[1], cam[2], size[0], size[1], ambient, lights, isDirty, nowMs);

beforeEach(() => {
  mockMaskWidth = 1;
  mockReducedMotion = false;
});

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
    // S3 P3 §4 — the dial changes the picture without changing a light, so it changes the key.
    [
      'ambient level (the DM’s dial)',
      () => lightingSignature(100, 200, 1.5, 1280, 720, '#0d0e12', [light()], clean, 0, 0.45),
    ],
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

  // A pack atlas resolves to a 1x1 placeholder until it finishes loading; the id alone
  // never changes, so the width has to be what breaks the guard for a late arrival.
  it('changes when a mask texture finishes loading (same id, resolved width changes)', () => {
    const withMask = light({ maskTextureId: 'pack:brazier-mask' });
    mockMaskWidth = 1;
    const stillLoading = sig([withMask]);
    mockMaskWidth = 64;
    const loaded = sig([withMask]);
    expect(loaded).not.toBe(stillLoading);
  });

  it('is stable across frames once the mask texture has settled', () => {
    const withMask = light({ maskTextureId: 'pack:brazier-mask' });
    mockMaskWidth = 64;
    expect(sig([withMask])).toBe(sig([withMask]));
  });

  it('is unaffected by time for a light with flicker off', () => {
    expect(sig([light()], undefined, undefined, undefined, undefined, 0)).toBe(
      sig([light()], undefined, undefined, undefined, undefined, 5000),
    );
  });

  it('changes over time for a flickering light', () => {
    const flickering = light({ flicker: true });
    expect(sig([flickering], undefined, undefined, undefined, undefined, 0)).not.toBe(
      sig([flickering], undefined, undefined, undefined, undefined, 500),
    );
  });

  it('stays put over time when reduced motion is set, even with flicker on', () => {
    mockReducedMotion = true;
    const flickering = light({ flicker: true });
    expect(sig([flickering], undefined, undefined, undefined, undefined, 0)).toBe(
      sig([flickering], undefined, undefined, undefined, undefined, 5000),
    );
  });
});

describe('flickerFactor', () => {
  it('is exactly 1 when the light has flicker off', () => {
    expect(flickerFactor(light(), 1234)).toBe(1);
  });

  it('is exactly 1 under reduced motion, regardless of time', () => {
    mockReducedMotion = true;
    expect(flickerFactor(light({ flicker: true }), 1234)).toBe(1);
  });

  it('wobbles within amplitude of the requested flickerIntensity', () => {
    const amount = 0.4;
    const flickering = light({ flicker: true, flickerIntensity: amount, flickerSpeed: 2 });
    for (let t = 0; t < 5000; t += 137) {
      const factor = flickerFactor(flickering, t);
      expect(factor).toBeGreaterThanOrEqual(1 - amount - 1e-9);
      expect(factor).toBeLessThanOrEqual(1 + amount + 1e-9);
    }
  });

  it('gives two lights placed at the same moment different phases', () => {
    const a = flickerFactor(light({ id: 'light-a', flicker: true }), 400);
    const b = flickerFactor(light({ id: 'light-b', flicker: true }), 400);
    expect(a).not.toBe(b);
  });
});

describe('cullLightsByDistance', () => {
  const at = (id: string, x: number): LightChild => light({ id, position: { x, y: 0 } });

  it('is a no-op at or under the cap', () => {
    const lights = [at('a', 0), at('b', 1)];
    expect(cullLightsByDistance(lights, 0, 0, 5)).toHaveLength(2);
  });

  it('keeps only the nearest `cap` lights to the camera', () => {
    const near = at('near', 1);
    const mid = at('mid', 10);
    const far = at('far', 100);
    const kept = cullLightsByDistance([far, mid, near], 0, 0, 2);
    expect(kept.map((l) => l.id).sort()).toEqual(['mid', 'near']);
  });

  it('the shipped cap is a small, deliberate number, not "however many fit"', () => {
    expect(MAX_RENDERED_LIGHTS).toBeGreaterThan(0);
    expect(MAX_RENDERED_LIGHTS).toBeLessThanOrEqual(64);
  });
});

// ── The guard in place ──────────────────────────────────────────────────────
// The signature above only proves a field is *in* the key. These pin the frame the guard
// actually lets through: a resize has to reach `this.width` before the key is built, or the
// skip eats it and the table keeps the old picture in a freshly blanked buffer.

type FakeTexture = { width: number; height: number; destroy: () => void };

/** A renderer on a fake engine that records the texture every pass drew into. */
function table(initialLights: LightChild[] = [light()]) {
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
  lights.syncFromStore(initialLights);
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

  // FBOs render at half linear resolution (LIGHT_FBO_SCALE) — gradients
  // upscale for free, and full-res re-render per camera move was the biggest
  // pan cost on integrated GPUs. The composite sprite still spans the viewport.
  it('recomposites at the new (half-res) size when only the viewport resized', () => {
    const t = table();
    const settled = t.drawnInto.length;
    t.viewport.width = 1600;
    t.viewport.height = 900;
    t.frame();
    expect(t.drawnInto.length).toBeGreaterThan(settled);
    expect(t.drawnInto.at(-1)).toMatchObject({ width: 800, height: 450 });
  });

  it('recomposites when the resize came from outside the render loop', () => {
    const t = table();
    t.viewport.width = 1600;
    t.viewport.height = 900;
    t.renderer.resize(1600, 900);
    const settled = t.drawnInto.length;
    t.frame();
    expect(t.drawnInto.length).toBeGreaterThan(settled);
    expect(t.drawnInto.at(-1)).toMatchObject({ width: 800, height: 450 });
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

  // ── S3 P3 §4 — the scene's ambient dial ──────────────────────────────────

  it('recomposites when the DM turns the ambient dial, with nothing else moving', () => {
    const t = table();
    const settled = t.drawnInto.length;
    t.renderer.setAmbientLevel(0.45);
    t.frame();
    expect(t.drawnInto.length).toBeGreaterThan(settled);
  });

  it('keeps composing a dial-set scene after its last light goes out', () => {
    const t = table();
    t.renderer.setAmbientLevel(1);
    t.lights.syncFromStore([]);
    const settled = t.drawnInto.length;
    t.frame();
    // The ambient fill IS the picture now — a `darkness` scene whose torch just went out has
    // to go dark, not hand back a fully lit map.
    expect(t.drawnInto.length).toBeGreaterThan(settled);
    expect(t.overlay.children.find((c) => c.label === 'lightingComposite')).toMatchObject({
      visible: true,
    });
  });

  it('leaves a scene with no dial exactly as it was — no lights, no composite', () => {
    const t = table();
    t.lights.syncFromStore([]);
    const settled = t.drawnInto.length;
    t.frame();
    expect(t.drawnInto.length).toBe(settled);
    expect(t.overlay.children.find((c) => c.label === 'lightingComposite')).toMatchObject({
      visible: false,
    });

    // …and setting the dial back to null puts that shortcut back.
    t.renderer.setAmbientLevel(0.5);
    t.frame();
    const forced = t.drawnInto.length;
    t.renderer.setAmbientLevel(null);
    t.frame();
    expect(t.drawnInto.length).toBe(forced);
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

// ── Light-count perf ─────────────────────────────────────────────────────────
// Every light in a redrawn frame costs one renderToTexture into perLightRT plus one
// composite blit into lightFBO — see the frame-cost note on MAX_RENDERED_LIGHTS. A frame
// with N lights redrawing draws 2N+1 times (the +1 is the ambient fill); this pins that
// count against the cap instead of the raw light count, which is the whole point of it.
describe('LightingRenderer light-count perf', () => {
  const manyLights = (n: number): LightChild[] =>
    Array.from({ length: n }, (_, i) => light({ id: `light-${i}`, position: { x: i, y: 0 } }));

  it('draws once per light, uncapped, under the budget', () => {
    const n = 10;
    const t = table(manyLights(n));
    const settled = t.drawnInto.length;
    t.lights.invalidateAll();
    t.frame();
    expect(t.drawnInto.length - settled).toBe(2 * n + 1);
  });

  it('caps the redraw cost at MAX_RENDERED_LIGHTS regardless of how many are placed', () => {
    const n = MAX_RENDERED_LIGHTS + 40;
    const t = table(manyLights(n));
    const settled = t.drawnInto.length;
    t.lights.invalidateAll();
    t.frame();
    // Not 2*n+1: however many are on the table, the redraw cost tops out at the cap.
    expect(t.drawnInto.length - settled).toBe(2 * MAX_RENDERED_LIGHTS + 1);
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
