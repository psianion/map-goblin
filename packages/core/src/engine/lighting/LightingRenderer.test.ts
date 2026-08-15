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
    /** Every fill this shape was given, so a test can read the base the FBO cleared to. */
    fills: unknown[] = [];
    clear(): this { return this; }
    rect(): this { return this; }
    fill(style?: unknown): this { this.fills.push(style); return this; }
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

import { LightingRenderer, lightingSignature, flickerFactor, cullLightsByDistance, MAX_RENDERED_LIGHTS, rgb, gradedLight, W_LIGHT_GRADE } from './LightingRenderer';
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
    // P2 — the world clock, bucketed. The grade colour covers the picture this pass draws
    // today; the bucket is what the sun/moon direction (P3) moves inside one grade colour.
    [
      'the world clock’s bucket',
      () => lightingSignature(100, 200, 1.5, 1280, 720, '#0d0e12', [light()], clean, 0, 1, 7),
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
  /** The FBO's base fills, frame by frame — the grade, and the bite's second pass of it. */
  const baseFills: { color: number; alpha: number }[][] = [];
  const engine = {
    overlay: () => overlay,
    viewport: () => viewport,
    worldToScreen: (wx: number, wy: number) => ({ x: wx, y: wy }),
    createRenderTexture: (width: number, height: number): FakeTexture => ({
      width,
      height,
      destroy: () => {},
    }),
    renderToTexture: (c: unknown, texture: FakeTexture) => {
      const container = c as { label?: string; children?: { fills?: unknown[] }[] };
      if (container.label === 'ambientContainer') {
        const fills = container.children?.[0]?.fills;
        if (fills) baseFills.push([...fills] as { color: number; alpha: number }[]);
      }
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
  const sprite = (): { visible: boolean } =>
    overlay.children.find((c) => c.label === 'lightingComposite') as unknown as {
      visible: boolean;
    };
  return { renderer, lights, overlay, viewport, drawnInto, baseFills, frame, sprite };
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

  // P1 — the grade/bite split. A map's mood is not conditional on it owning a torch, and the
  // old shortcut (no lights, no dial ⇒ no composite at all) is why a lightless map was the one
  // map with no mood.
  it('still composites a lightless, dial-less scene — for its grade, at no bite', () => {
    const t = table();
    t.lights.syncFromStore([]);
    const settled = t.drawnInto.length;
    t.frame('#2d2d44');
    expect(t.drawnInto.length).toBeGreaterThan(settled);
    expect(t.sprite().visible).toBe(true);
    // The grade as authored, opaque — and nothing else. No dial is no bite.
    expect(t.baseFills.at(-1)).toEqual([{ color: 0x2d2d44, alpha: 1 }]);
  });

  it('lays the bite over the grade as a second pass of the same colour', () => {
    const t = table();
    t.lights.syncFromStore([]);
    t.renderer.setAmbientLevel(0.7);
    t.frame('#2d2d44');
    expect(t.baseFills.at(-1)).toEqual([
      { color: 0x2d2d44, alpha: 1 },
      { color: 0x2d2d44, alpha: 0.7 },
    ]);
  });

  it('takes the composed grade over the frame’s own ambient once one is set', () => {
    const t = table();
    t.renderer.setGrade('#442d2d');
    t.frame('#2d2d44');
    expect(t.baseFills.at(-1)?.[0].color).toBe(0x442d2d);
    // …and hands the frame back when nobody is composing one.
    t.renderer.setGrade(null);
    t.frame('#2d2d44');
    expect(t.baseFills.at(-1)?.[0].color).toBe(0x2d2d44);
  });

  it('redraws when the clock bucket moves under an unchanged grade colour', () => {
    const t = table();
    t.renderer.setGrade('#442d2d', 100);
    t.frame('#2d2d44');
    const drawn = t.drawnInto.length;
    // Same colour, later hour: the picture the sun draws is not a function of the grade alone.
    t.renderer.setGrade('#442d2d', 101);
    t.frame('#2d2d44');
    expect(t.drawnInto.length).toBeGreaterThan(drawn);
    // …and a paused clock costs nothing: the same bucket is the same frame.
    const moved = t.drawnInto.length;
    t.frame('#2d2d44');
    expect(t.drawnInto.length).toBe(moved);
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

// ── P1 — what the grade does to the picture ─────────────────────────────────
// The composite needs a GPU, but its arithmetic does not: the FBO is the grade (plus the
// bite's second pass of it) with each light's graded colour added on top, and the sprite
// multiplies the result over the map. Modelled here per channel so the requirements can be
// asserted as *properties* of the output rather than as identities of the intermediates —
// W1 explicitly changes what a lit floor looks like, so nothing about it is byte-stable.

/** The FBO's unlit base: the grade, then the bite's second pass of it. 0..1 per channel. */
const base = (grade: string, bite: number): number[] =>
  rgb(grade).map((c) => (c / 255) * (1 - bite * (1 - c / 255)));

/** The FBO inside a pool: the base with the light's graded colour added at `intensity`. */
const pool = (grade: string, light: string, bite: number, intensity = 0.8): number[] =>
  gradedLight(light, grade).map((c, i) =>
    Math.min(1, base(grade, bite)[i] + (c / 255) * intensity),
  );

/** What the map's own pixels come out as: `dst · lerp(1, fbo, 0.95)`, the sprite's multiply. */
const SPRITE_ALPHA = 0.95;
const out = (floor: number[], fbo: number[]): number[] =>
  floor.map((c, i) => c * (1 - SPRITE_ALPHA * (1 - fbo[i])));

/** Hue angle in degrees — what "still reads warm" means when brightness is free to move. */
function hue([r, g, b]: number[]): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

const DAY = '#e8e4d8';
const NIGHT = '#1a1a2e';
const TORCH = '#ffb454';
/** A stretch of mid-grey dungeon floor, as the art ships it. */
const FLOOR = [0.55, 0.55, 0.55];

describe('the grade, as properties of the output', () => {
  it('(a) leaves a torch reading as a torch under a cold night', () => {
    // The finding this replaces: grading the whole composite dragged the pool's own colour
    // toward the grade's. Tinting the light's contribution instead moves its brightness, not
    // its hue — a brazier under a night sky is a cooler, dimmer brazier, not a blue one.
    const ungraded = rgb(TORCH);
    const graded = gradedLight(TORCH, NIGHT);
    const drift = Math.abs(hue(graded) - hue(ungraded));
    expect(drift).toBeLessThan(15);
    // …and it did cool: the grade took a real share of it, so this is not a no-op either.
    expect(graded[0]).toBeLessThan(ungraded[0]);
    expect(W_LIGHT_GRADE).toBeGreaterThan(0);
    // Warm still means warm: red leads, blue trails, as it did before the grade.
    expect(graded[0]).toBeGreaterThan(graded[1]);
    expect(graded[1]).toBeGreaterThan(graded[2]);
  });

  it('(b) changes the LIT floor when the grade goes from day to night (W1)', () => {
    // The whole point of P1. Lit ground used to escape the grade almost entirely — the pool
    // washed the fill out from under itself and the composite never got another word in.
    const day = out(FLOOR, pool(DAY, TORCH, 0));
    const night = out(FLOOR, pool(NIGHT, TORCH, 0));
    const drop = 1 - night[0] / day[0];
    expect(drop).toBeGreaterThan(0.2);
    // …and what is left standing in the pool is the torch, not the sky: the night takes the
    // ambient blue out of the lit ground and leaves the flame's own warmth doing the work,
    // which is the art guide's "grey floors, one or two strong warm glows".
    expect(night[0]).toBeGreaterThan(night[2]);
    expect(hue(night)).toBeLessThan(60);
  });

  it('(c) gives the DM a dark night map with pools burning in it (W2 + finding 2)', () => {
    // Their bite is 0 — no vision-darkness is ever imposed on a referee — but the grade is
    // not vision, and a night map is *supposed* to be dark. What they must not lose is the
    // map: the braziers are right there, several times brighter than the ground around them.
    const dm = { unlit: out(FLOOR, base(NIGHT, 0)), lit: out(FLOOR, pool(NIGHT, TORCH, 0)) };
    expect(dm.unlit[0]).toBeLessThan(FLOOR[0] * 0.25);
    expect(dm.lit[0]).toBeGreaterThan(dm.unlit[0] * 3);
    // …and a player's bite lands strictly under the DM on the same ground, never over it.
    expect(out(FLOOR, base(NIGHT, 0.7))[0]).toBeLessThan(dm.unlit[0]);
  });

  it('(d) leaves a map with a neutral white grade exactly as it was', () => {
    // The compat anchor. White is "no grade", and no grade must cost nothing at any bite —
    // both fills are the grade, so both are white, and the multiply is the identity.
    for (const bite of [0, 0.45, 0.7, 1]) {
      expect(base('#ffffff', bite)).toEqual([1, 1, 1]);
      expect(out(FLOOR, base('#ffffff', bite))).toEqual(FLOOR);
    }
    // …and an ungraded torch is the torch as authored.
    expect(gradedLight(TORCH, '#ffffff')).toEqual(rgb(TORCH));
  });

  it('reads a colour off the wire, or black if it cannot', () => {
    expect(rgb('#2d2d44')).toEqual([0x2d, 0x2d, 0x44]);
    expect(rgb('2d2d44')).toEqual([0x2d, 0x2d, 0x44]);
    expect(rgb('not a colour')).toEqual([0, 0, 0]);
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
