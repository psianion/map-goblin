import { describe, expect, it, vi, beforeEach } from 'vitest';

// The composite itself needs a GPU, so the browser gate owns "does it look right". What is
// checkable here is which draws run, in which order, into which buffers, and that nothing is
// allocated per recomposite — so Pixi and the texture loader are stubbed down to bookkeeping
// and `updateAndRender` runs end to end on the CPU.
const counts = vi.hoisted(() => ({ graphics: 0, sprites: 0, gradients: 0 }));
vi.mock('pixi.js', () => {
  class Point {
    x = 0;
    y = 0;
    set(x: number, y?: number): void {
      this.x = x;
      this.y = y ?? x;
    }
  }
  class MockContainer {
    label = '';
    children: MockContainer[] = [];
    visible = true;
    alpha = 1;
    tint = 0xffffff;
    blendMode = 'normal';
    filters: unknown[] = [];
    mask: unknown = null;
    rotation = 0;
    position = new Point();
    scale = new Point();
    addChild(c: MockContainer): MockContainer {
      this.children.push(c);
      return c;
    }
    removeChild(c: MockContainer): MockContainer {
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
    /** Every fill this shape was given since its last clear. */
    fills: unknown[] = [];
    /** How many times its geometry was rebuilt. */
    clears = 0;
    constructor() {
      super();
      counts.graphics++;
    }
    clear(): this {
      this.clears++;
      this.fills = [];
      return this;
    }
    rect(): this { return this; }
    poly(): this { return this; }
    fill(style?: unknown): this { this.fills.push(style); return this; }
    stroke(): this { return this; }
    moveTo(): this { return this; }
    lineTo(): this { return this; }
    closePath(): this { return this; }
  }
  class MockSprite extends MockContainer {
    texture: unknown;
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
    anchor = { set: (): void => {} };
    constructor(texture?: unknown) {
      super();
      this.texture = texture;
      counts.sprites++;
    }
  }
  class MockFillGradient {
    constructor() {
      counts.gradients++;
    }
    destroy(): void {}
  }
  class MockRenderTexture {}
  class MockFilter {
    strength: number;
    blendMode = 'normal';
    matrix: number[] = [];
    constructor(o: { strength?: number } = {}) {
      this.strength = o.strength ?? 0;
    }
    destroy(): void {}
  }
  return {
    BlurFilter: MockFilter,
    ColorMatrixFilter: MockFilter,
    Container: MockContainer,
    Graphics: MockGraphics,
    Sprite: MockSprite,
    FillGradient: MockFillGradient,
    RenderTexture: MockRenderTexture,
    // The icon glyphs rasterize through `lucideIcons`, which falls back to `Texture.WHITE`
    // wherever there is no 2D context — jsdom, i.e. here.
    Texture: { WHITE: { width: 1, height: 1 }, from: () => ({ width: 1, height: 1 }) },
  };
});
vi.mock('../../assets/textureLoader', () => ({
  resolveTexture: () => ({ width: 64, height: 64 }),
}));

import {
  DARKNESS_ALPHA,
  LightingRenderer,
  animationFactor,
  falloffAt,
  flickerNoise,
  gradedLight,
  headroom,
  isolateContent,
  lightingSignature,
  nightOnlyActive,
  rgb,
  W_LIGHT_GRADE,
  type LightingContent,
} from './LightingRenderer';
import { Container, Graphics } from 'pixi.js';
import { LightManager } from './LightManager';
import type { RenderEngine } from '../RenderEngine';
import type { AssetChild, LightChild } from '../../store/types';
import { skyFrame } from '../../shared/sky';
import { clearFreeze } from '../../shared/freeze';

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

const prop = (over: Partial<AssetChild> = {}): AssetChild => ({
  id: 'brazier',
  name: 'Brazier',
  childType: 'asset',
  visible: true,
  objectType: 'asset',
  assetId: 'brazier',
  position: { x: 3, y: 3 },
  rotation: 0,
  scale: 1,
  width: 1,
  height: 1,
  tint: '#ffffff',
  flipX: false,
  flipY: false,
  glows: true,
  ...over,
});

const NIGHT = skyFrame({ environment: 'outdoor', minutes: 0, nightSky: 'moonless' });
const NOON = skyFrame({ environment: 'outdoor', minutes: 720 });

const clean = () => 0;
const sig = (
  lights: LightChild[] = [light()],
  cam: [number, number, number] = [100, 200, 1.5],
  size: [number, number] = [1280, 720],
  gradeKey = 'grade',
  staleness: (id: string) => number = clean,
) => lightingSignature(cam[0], cam[1], cam[2], size[0], size[1], gradeKey, lights, staleness);

beforeEach(() => {
  clearFreeze();
});

describe('lightingSignature', () => {
  it('is stable while nothing moves — the frame the guard skips', () => {
    expect(sig()).toBe(sig());
  });

  const changes: [string, () => string][] = [
    ['camera x (pan)', () => sig([light()], [101, 200, 1.5])],
    ['camera y (pan)', () => sig([light()], [100, 201, 1.5])],
    ['zoom', () => sig([light()], [100, 200, 1.6])],
    ['viewport width', () => sig([light()], [100, 200, 1.5], [1281, 720])],
    ['viewport height', () => sig([light()], [100, 200, 1.5], [1280, 721])],
    ['the grade (regions, sky, DM-lit)', () => sig([light()], [100, 200, 1.5], [1280, 720], 'other')],
    ['light moved', () => sig([light({ position: { x: 13, y: 20 } })])],
    ['light radius', () => sig([light({ radius: 41 })])],
    ['light colour', () => sig([light({ color: '#ff0000' })])],
    ['light intensity', () => sig([light({ intensity: 0.5 })])],
    ['light falloff', () => sig([light({ falloff: 'linear' })])],
    ['light bright edge', () => sig([light({ featherRadius: 9 })])],
    ['light cone', () => sig([light({ cone: { angle: 90, direction: 0 } })])],
    ['light animation', () => sig([light({ animation: { kind: 'pulse', speed: 1 } })])],
    ['light becomes darkness', () => sig([light({ darkness: true })])],
    ['light through walls', () => sig([light({ throughWalls: true })])],
    ['a second light', () => sig([light(), light({ id: 'light-2' })])],
    ['no lights at all', () => sig([])],
    ['visibility polygon invalidated', () => sig([light()], [100, 200, 1.5], [1280, 720], 'grade', () => 1)],
    ['the glowing props', () => lightingSignature(100, 200, 1.5, 1280, 720, 'grade', [light()], clean, () => 1, 'glow')],
    ['the animation clock, when given', () => lightingSignature(100, 200, 1.5, 1280, 720, 'grade', [light()], clean, () => 1, '', 5)],
    ['the content revision', () => lightingSignature(100, 200, 1.5, 1280, 720, 'grade', [light()], clean, () => 1, '', undefined, '7')],
  ];

  for (const [what, produce] of changes) {
    it(`changes when ${what}`, () => {
      expect(produce()).not.toBe(sig());
    });
  }
});

// ── The renderer on a fake engine ───────────────────────────────────────────

type FakeTexture = { width: number; height: number; resolution?: number; destroy: () => void };
type Node = { label?: string; children?: Node[]; visible?: boolean; fills?: unknown[]; clears?: number; alpha?: number; texture?: unknown };

/** A renderer on a fake engine that records every pass as (root label, target). */
function table(initialLights: LightChild[] = [light()], glows: AssetChild[] = []) {
  const overlay = {
    children: [] as Node[],
    addChild(c: Node) {
      this.children.push(c);
      return c;
    },
    removeChild(c: Node) {
      const i = this.children.indexOf(c);
      if (i >= 0) this.children.splice(i, 1);
      return c;
    },
  };
  const viewport = { width: 1280, height: 720, dpr: 1 };
  const passes: { label: string; target: FakeTexture; root: Node }[] = [];
  const engine = {
    overlay: () => overlay,
    viewport: () => viewport,
    worldToScreen: (wx: number, wy: number) => ({ x: wx, y: wy }),
    createRenderTexture: (width: number, height: number, resolution?: number): FakeTexture => ({
      width,
      height,
      resolution,
      destroy: () => {},
    }),
    renderToTexture: (c: unknown, texture: FakeTexture) => {
      const root = c as Node;
      passes.push({ label: root.label || root.children?.[0]?.label || '', target: texture, root });
    },
  } as unknown as RenderEngine;

  const lights = new LightManager();
  lights.syncFromStore(initialLights);
  lights.rebuildIfDirty([]);
  lights.setGlows(
    glows.map((p) => ({ prop: p, strength: p.glow?.strength ?? 0.9, animation: p.glow?.animation })),
    glows.map((p) => p.id).join(','),
  );

  const renderer = new LightingRenderer(engine, viewport.width, viewport.height);
  renderer.setSky(NIGHT);
  const frame = (ambient = '#ffffff'): void => renderer.updateAndRender(lights, 100, 200, 1.5, ambient);
  frame();
  frame();
  const labels = (): string[] => passes.map((p) => p.label);
  const find = (root: Node, label: string): Node | undefined => {
    if (root.label === label) return root;
    for (const c of root.children ?? []) {
      const hit = find(c, label);
      if (hit) return hit;
    }
    return undefined;
  };
  const lastRoot = (label: string): Node => passes.filter((p) => p.label === label).at(-1)!.root;
  const sprite = (): { visible: boolean } =>
    overlay.children.find((c) => c.label === 'lightingComposite') as unknown as { visible: boolean };
  return { renderer, lights, overlay, viewport, passes, labels, frame, sprite, find, lastRoot };
}

const iconCount = (overlay: { children: Node[] }): number =>
  overlay.children.filter((c) => (c.label ?? '').startsWith('light-icon-')).length;

describe('the four draws', () => {
  it('grade, light, final in that order — and the darkness mask only when a darkness source burns', () => {
    const t = table();
    t.passes.length = 0;
    t.lights.invalidateAll();
    t.frame('#202030');
    expect(t.labels()).toEqual(['gradeRoot', 'lightRoot', 'finalRoot']);

    const d = table([light(), light({ id: 'void', darkness: true, position: { x: 20, y: 20 } })]);
    d.passes.length = 0;
    d.renderer.invalidate();
    d.frame('#202030');
    expect(d.labels()).toEqual(['gradeRoot', 'lightRoot', 'darkRoot', 'finalRoot']);
  });

  it('draws nothing on an idle frame', () => {
    const t = table();
    const settled = t.passes.length;
    t.frame();
    expect(t.passes.length).toBe(settled);
  });

  it('composes grade + light, then lays the darkness over both in black', () => {
    const t = table([light({ id: 'void', darkness: true })]);
    const final = t.lastRoot('finalRoot');
    const [grade, lit, dark] = final.children as (Node & { blendMode?: string; tint?: number })[];
    expect(grade!.label).toBe('gradeSprite');
    expect(lit).toMatchObject({ label: 'lightSprite', blendMode: 'add' });
    expect(dark).toMatchObject({ label: 'darkSprite', tint: 0x000000, alpha: DARKNESS_ALPHA, visible: true });
  });

  it('draws darkness sources into the darkness mask, never into the light buffer', () => {
    const t = table([light({ id: 'void', darkness: true })]);
    const lightLayer = t.find(t.lastRoot('lightRoot'), 'lightLayer')!;
    expect((lightLayer.children ?? []).filter((c) => c.label === 'light-void' && c.visible)).toHaveLength(0);
    const dark = t.find(t.lastRoot('darkRoot'), 'darkLayer')!;
    expect((dark.children ?? []).filter((c) => c.label === 'light-void' && c.visible)).toHaveLength(1);
  });

  it('the DM-lit view drops the darkness masks and lights every region', () => {
    const t = table([light({ id: 'void', darkness: true })]);
    t.renderer.setSky(NIGHT, { allLit: true });
    t.passes.length = 0;
    t.frame();
    expect(t.labels()).not.toContain('darkRoot');
    expect(t.renderer.currentGrade()).toBe('#ffffff');
  });
});

describe('no light cap (agreed gap: the 24 cap, and the fog mask used another set)', () => {
  const many = (n: number): LightChild[] =>
    Array.from({ length: n }, (_, i) => light({ id: `light-${i}`, position: { x: i * 3, y: 0 } }));

  it('draws all 60 lights into the one light buffer', () => {
    const t = table(many(60));
    const layer = t.find(t.lastRoot('lightRoot'), 'lightLayer')!;
    expect((layer.children ?? []).filter((c) => c.label?.startsWith('light-light-') && c.visible)).toHaveLength(60);
  });

  it('costs the same number of draws for 1 light as for 60', () => {
    const one = table(many(1));
    one.passes.length = 0;
    one.lights.invalidateAll();
    one.frame('#101010');
    const sixty = table(many(60));
    sixty.passes.length = 0;
    sixty.lights.invalidateAll();
    sixty.frame('#101010');
    expect(sixty.passes.length).toBe(one.passes.length);
  });
});

describe('nothing allocated per recomposite (agreed gap: a Graphics leak per frame)', () => {
  it('keeps the pool and every allocation constant over 500 recomposites', () => {
    const t = table(
      Array.from({ length: 20 }, (_, i) => light({ id: `l${i}`, position: { x: i, y: i } })),
      [prop()],
    );
    const pool = t.renderer.poolSize();
    const graphics = counts.graphics;
    const sprites = counts.sprites;
    const gradients = counts.gradients;
    for (let i = 0; i < 500; i++) t.renderer.updateAndRender(t.lights, 100 + i, 200, 1.5, '#ffffff');
    expect(t.renderer.stats.recomposites).toBeGreaterThanOrEqual(500);
    expect(t.renderer.poolSize()).toBe(pool);
    expect(counts.graphics).toBe(graphics);
    expect(counts.sprites).toBe(sprites);
    expect(counts.gradients).toBe(gradients);
  });

  it('rebuilds a light’s geometry only when its polygon goes stale, never on a pan', () => {
    const t = table();
    const g = t.find(t.lastRoot('lightRoot'), 'light-light-1')!;
    const clears = g.clears!;
    t.renderer.updateAndRender(t.lights, 300, 200, 1.5, '#ffffff');
    expect(g.clears).toBe(clears);
    t.lights.invalidateAll();
    t.frame();
    expect(g.clears).toBe(clears + 1);
  });

  it('drops a pooled light when it leaves the map', () => {
    const t = table([light(), light({ id: 'b' })]);
    expect(t.renderer.poolSize()).toBe(2);
    t.lights.syncFromStore([light()]);
    t.frame('#000001');
    expect(t.renderer.poolSize()).toBe(1);
  });
});

describe('glowing props', () => {
  it('draw their own sprite into the light buffer, white, at their strength', () => {
    const t = table([], [prop({ glow: { strength: 0.4 } })]);
    const glows = t.find(t.lastRoot('lightRoot'), 'glowLayer')!;
    const sprite = (glows.children ?? []).find((c) => c.label === 'glow-brazier')!;
    expect(sprite.alpha).toBeCloseTo(0.4);
  });

  it('count as animated when their glow is', () => {
    const steady = table([], [prop()]);
    steady.passes.length = 0;
    steady.frame();
    expect(steady.passes).toHaveLength(0);
    const pulsing = table([], [prop({ glow: { strength: 0.9, animation: { kind: 'pulse', speed: 1 } } })]);
    pulsing.passes.length = 0;
    pulsing.frame();
    expect(pulsing.labels()).toEqual(['lightRoot', 'finalRoot']);
  });

  it('keep a flipped glow flipped through re-syncs caused by other things', () => {
    // The glow pool re-poses every pooled sprite on every light pass, so the flip has to
    // come out the same each time or a mirrored prop's glow mirrors back and forth.
    const candle = prop({ id: 'candle', glow: { strength: 0.9 } });
    const t = table([], [prop({ flipY: true }), prop({ id: 'lamp', flipX: true }), candle]);
    type Glow = { label?: string; alpha: number; scale: { x: number; y: number } };
    const glow = (id: string): Glow =>
      (t.find(t.lastRoot('lightRoot'), 'glowLayer')!.children as unknown as Glow[]).find((c) => c.label === `glow-${id}`)!;
    const scales = () => ({ brazier: { ...glow('brazier').scale }, lamp: { ...glow('lamp').scale } });
    const first = scales();
    expect(first.brazier.y).toBeLessThan(0);
    expect(first.brazier.x).toBeGreaterThan(0);
    expect(first.lamp.x).toBeLessThan(0);
    expect(first.lamp.y).toBeGreaterThan(0);

    // A pan redraws the light buffer.
    t.passes.length = 0;
    t.renderer.updateAndRender(t.lights, 101, 200, 1.5, '#ffffff');
    expect(t.labels()).toContain('lightRoot');
    expect(scales()).toEqual(first);

    // Another prop's glow changes.
    const glows = [prop({ flipY: true }), prop({ id: 'lamp', flipX: true }), { ...candle, glow: { strength: 0.3 } }];
    t.lights.setGlows(
      glows.map((p) => ({ prop: p, strength: p.glow?.strength ?? 0.9, animation: p.glow?.animation })),
      'candle-dimmed',
    );
    t.renderer.updateAndRender(t.lights, 101, 200, 1.5, '#ffffff');
    expect(glow('candle').alpha).toBeCloseTo(0.3);
    expect(scales()).toEqual(first);
  });
});

describe('animation', () => {
  it('adds the time term only while something animates, and then redraws only the light buffer', () => {
    const t = table([light({ animation: { kind: 'flicker', speed: 1 } })]);
    t.passes.length = 0;
    t.frame();
    expect(t.labels()).toEqual(['lightRoot', 'finalRoot']);
    const still = table([light()]);
    still.passes.length = 0;
    still.frame();
    expect(still.passes).toHaveLength(0);
  });

  it('flicker shakes intensity by ±20 % and reach by ±6 %, seeded per light', () => {
    let swing = 0;
    for (let t = 0; t < 20; t += 0.037) {
      const f = animationFactor({ kind: 'flicker', speed: 1 }, 'a', t);
      expect(f.intensity).toBeGreaterThanOrEqual(0.8 - 1e-9);
      expect(f.intensity).toBeLessThanOrEqual(1.2 + 1e-9);
      expect(Math.abs(f.radius - 1)).toBeLessThanOrEqual(0.06 + 1e-9);
      expect(f.radius - 1).toBeCloseTo((f.intensity - 1) * 0.3, 9);
      swing = Math.max(swing, Math.abs(f.intensity - 1));
    }
    // Visibly stronger than the old ±12 % shimmer.
    expect(swing).toBeGreaterThan(0.12);
    expect(flickerNoise('a', 1)).not.toBe(flickerNoise('b', 1));
    expect(flickerNoise('a', 1)).toBe(flickerNoise('a', 1));
  });

  it('pulse breathes between 70 % and 100 %, and no animation is steady', () => {
    const values = [0, 0.5, 1, 1.5, 2, 2.5].map((t) => animationFactor({ kind: 'pulse', speed: 1 }, 'x', t).intensity);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0.7);
    expect(Math.max(...values)).toBeLessThanOrEqual(1);
    expect(animationFactor(undefined, 'x', 3)).toEqual({ intensity: 1, radius: 1 });
  });

  it('stands still under a freeze', () => {
    (globalThis as { __GG_FREEZE__?: unknown }).__GG_FREEZE__ = { minutes: 720 };
    const t = table([light({ animation: { kind: 'flicker', speed: 1 } })]);
    t.passes.length = 0;
    t.frame();
    expect(t.passes).toHaveLength(0);
  });
});

describe('night-only and level-filtered lights', () => {
  it('a night-only light burns inside its darkness window only', () => {
    expect(nightOnlyActive({ nightOnly: { min: 0.5, max: 1 } }, 0.2)).toBe(false);
    expect(nightOnlyActive({ nightOnly: { min: 0.5, max: 1 } }, 0.9)).toBe(true);
    expect(nightOnlyActive({}, 0)).toBe(true);
    const t = table([light({ nightOnly: { min: 0.5, max: 1 } })]);
    const visible = () =>
      (t.find(t.lastRoot('lightRoot'), 'lightLayer')!.children ?? []).filter((c) => c.label === 'light-light-1' && c.visible);
    expect(visible()).toHaveLength(1);
    // Frozen, so the light goes out at once rather than over its 300 ms fade.
    (globalThis as { __GG_FREEZE__?: unknown }).__GG_FREEZE__ = { minutes: 720 };
    t.renderer.setSky(NOON);
    for (let i = 0; i < 3; i++) t.renderer.updateAndRender(t.lights, 100 + i, 200, 1.5, '#ffffff');
    expect(visible()).toHaveLength(0);
  });

  it('draws only the lights the manager holds — the shown level’s (subscribeToStore filters by level)', () => {
    const t = table([light({ id: 'here' })]);
    const layer = t.find(t.lastRoot('lightRoot'), 'lightLayer')!;
    expect((layer.children ?? []).map((c) => c.label)).toContain('light-here');
    t.lights.syncFromStore([]);
    t.frame('#000002');
    expect((layer.children ?? []).map((c) => c.label)).not.toContain('light-here');
  });
});

describe('the grade mask', () => {
  it('grades by the regions the manager was given, each room face its own colour', () => {
    const t = table([]);
    t.renderer.setSky(NOON);
    t.lights.setRegions({
      level: { mood: 'lit', moodTint: '#ffffff' },
      rooms: [{ id: 'r', face: [[0, 0], [4, 0], [4, 4], [0, 4]], mood: { mood: 'dark', moodTint: '#ffffff' } }],
      key: 'k1',
    });
    t.frame();
    const faces = t.find(t.lastRoot('gradeRoot'), 'gradeFaces') as Node & { fills: { color: number }[] };
    expect(faces.fills).toHaveLength(1);
    expect(faces.fills[0]!.color).toBeLessThan(0x404040);
    expect(t.renderer.currentGrade()).toBe('#ffffff');
  });

  it('without regions grades by the frame’s ambient, as before (a lightless map still composites)', () => {
    const t = table([]);
    t.renderer.setSky(NOON);
    t.frame('#2d2d44');
    expect(t.sprite().visible).toBe(true);
    expect(t.renderer.currentGrade()).toBe('#2d2d44');
  });
});

describe('the guard in place', () => {
  it('recomposites at the new (half-res) size when the viewport resized', () => {
    const t = table();
    t.viewport.width = 1600;
    t.viewport.height = 900;
    t.frame();
    expect(t.passes.at(-1)!.target).toMatchObject({ width: 800, height: 450 });
  });

  it('recomposites when a door swing invalidates the light polygons', () => {
    const t = table();
    const settled = t.passes.length;
    t.lights.invalidateAll();
    t.frame();
    expect(t.passes.length).toBeGreaterThan(settled);
  });

  it('recomposites when the sky changes', () => {
    const t = table();
    const settled = t.passes.length;
    t.renderer.setSky(NOON);
    t.frame();
    expect(t.passes.length).toBeGreaterThan(settled);
  });

  it('stays out of the live view while the composite is off, and comes back when on', () => {
    const t = table();
    t.renderer.setLiveComposite(false);
    t.frame('#101010');
    expect(t.sprite().visible).toBe(false);
    t.renderer.setLiveComposite(true);
    t.frame('#101010');
    expect(t.sprite().visible).toBe(true);
  });
});

describe('the grade, as arithmetic', () => {
  it('leaves a torch reading as a torch under a cold night', () => {
    const graded = gradedLight('#ffb454', '#1a1a2e');
    expect(graded[0]).toBeGreaterThan(graded[1]);
    expect(graded[1]).toBeGreaterThan(graded[2]);
    expect(W_LIGHT_GRADE).toBeGreaterThan(0);
  });

  it('a neutral white grade leaves a torch as authored', () => {
    expect(gradedLight('#ffb454', '#ffffff')).toEqual(rgb('#ffb454'));
  });

  it('keeps one light inside the range at every grade (headroom)', () => {
    for (const grade of ['#000000', '#181c28', '#808080', '#ffffff']) {
      const [gr, gg, gb] = rgb(grade);
      const c = gradedLight('#ffffff', grade).map((v) => v * headroom(grade));
      expect(Math.max(gr + c[0]!, gg + c[1]!, gb + c[2]!)).toBeLessThanOrEqual(255);
    }
  });

  it('falloff runs out at the rim with no ring', () => {
    for (const f of ['quadratic', 'linear'] as const) {
      expect(falloffAt(f, 0)).toBe(1);
      expect(falloffAt(f, 1)).toBe(0);
    }
    expect(falloffAt('quadratic', 0.5)).toBeCloseTo(0.75, 10);
  });
});

describe('icons', () => {
  it('draws the editing icons unless something opts out', () => {
    const t = table();
    expect(iconCount(t.overlay)).toBe(1);
    t.renderer.setIconsVisible(false);
    expect(iconCount(t.overlay)).toBe(0);
  });
});

describe('the export: renderInto takes a frame', () => {
  const target = (): FakeTexture => ({ width: 4096, height: 3072, destroy: () => {} });

  it('runs the same four draws at the export size, resolution 1, and multiplies onto the file', () => {
    const t = table();
    const tex = target();
    t.passes.length = 0;
    t.renderer.renderInto(tex as never, 128, 4096, 3072, NOON);
    expect(t.labels().slice(0, 3)).toEqual(['gradeRoot', 'lightRoot', 'finalRoot']);
    expect(t.passes[0]!.target).toMatchObject({ width: 2048, height: 1536, resolution: 1 });
    expect(t.passes.at(-1)).toMatchObject({ label: 'lightingCompositeExport', target: tex });
  });

  it('grades by the frame it is handed, not the last live one', () => {
    const t = table([]);
    t.lights.setRegions({ level: { mood: 'lit', moodTint: '#ffffff' }, rooms: [], key: 'k' });
    t.renderer.setSky(NIGHT);
    t.frame();
    const nightGrade = t.renderer.currentGrade();
    t.passes.length = 0;
    t.renderer.renderInto(target() as never, 128, 4096, 3072, NOON);
    const bg = t.find(t.passes[0]!.root, 'gradeBg') as Node & { fills: { color: number }[] };
    expect(bg.fills[0]!.color).toBe(0xffffff);
    expect(nightGrade).not.toBe('#ffffff');
  });

  it('draws a night-only light by the export’s darkness, every light with no fade', () => {
    const t = table([light({ id: 'night', nightOnly: { min: 0.5, max: 1 } })]);
    t.passes.length = 0;
    t.renderer.renderInto(target() as never, 128, 4096, 3072, NOON);
    const layer = t.find(t.passes.find((p) => p.label === 'lightRoot')!.root, 'lightLayer')!;
    expect((layer.children ?? []).filter((c) => c.label === 'light-night' && c.visible)).toHaveLength(0);
  });
});

describe('content only: the bare sheet is never lit', () => {
  /** A world container shaped like the scene graph's: content, the sheet fill, and the rest. */
  function world() {
    const root = new Container();
    root.label = 'worldContainer';
    const background = new Container();
    const fill = new Graphics();
    background.addChild(fill);
    const sheetClip = new Graphics();
    background.mask = sheetClip;
    const terrain = new Container();
    const grid = new Container();
    const layers = new Container();
    const overhead = new Container();
    const preview = new Container();
    const handles = new Graphics();
    for (const c of [background, terrain, grid, layers, overhead, preview, sheetClip, handles]) root.addChild(c);
    let rev = 0;
    const content: LightingContent = {
      root,
      content: [background, terrain, layers, overhead],
      exclude: [fill],
      revision: () => String(rev),
    };
    return { root, background, fill, sheetClip, terrain, grid, layers, overhead, preview, handles, content, bump: () => rev++ };
  }

  it('mutes everything but the content for the pass — the fill, the grid, the overlays — and puts it back', () => {
    const w = world();
    w.preview.alpha = 0.5;
    w.handles.alpha = 0;
    const restore = isolateContent(w.content);
    for (const c of [w.fill, w.grid, w.preview, w.handles]) expect(c.alpha).toBe(0);
    for (const c of [w.background, w.terrain, w.layers, w.overhead]) expect(c.alpha).toBe(1);
    // The sheet's clip is a mask the content wears: left alone, or the background texture would vanish.
    expect(w.sheetClip.alpha).toBe(1);
    restore();
    expect([w.fill.alpha, w.grid.alpha, w.preview.alpha, w.handles.alpha]).toEqual([1, 1, 0.5, 0]);
  });

  it('renders the content, inverts its coverage onto white, and screens that over the final', () => {
    const t = table();
    const w = world();
    t.renderer.setContent(w.content);
    t.passes.length = 0;
    t.frame();
    expect(t.labels()).toEqual(['gradeRoot', 'lightRoot', 'worldContainer', 'paperRoot', 'finalRoot']);
    const [, , content, paper] = t.passes;
    // Full logical size through the world's own camera, at half resolution; the paper at the buffers' size.
    expect(content!.target).toMatchObject({ width: 1280, height: 720, resolution: 0.5 });
    expect(paper!.target).toMatchObject({ width: 640, height: 360 });
    const coverage = t.find(paper!.root, 'contentSprite') as Node & { tint: number };
    expect(coverage).toMatchObject({ tint: 0x000000, texture: content!.target });
    expect(t.find(paper!.root, 'paperBg')!.fills).toEqual([0xffffff]);
    const last = t.lastRoot('finalRoot').children!.at(-1) as Node & { blendMode: string };
    expect(last).toMatchObject({ label: 'paperSprite', blendMode: 'screen', visible: true, texture: paper!.target });
    // The world is back as it was once the pass is done.
    expect([w.fill.alpha, w.grid.alpha, w.preview.alpha]).toEqual([1, 1, 1]);
  });

  it('re-reads the content on an edit or a zoom, and not on a change of sky', () => {
    const t = table();
    const w = world();
    t.renderer.setContent(w.content);
    t.frame();
    t.passes.length = 0;
    t.frame();
    expect(t.passes).toHaveLength(0);

    w.bump();
    t.frame();
    expect(t.labels()).toEqual(['lightRoot', 'worldContainer', 'paperRoot', 'finalRoot']);

    t.passes.length = 0;
    t.renderer.setSky(NOON);
    t.frame();
    expect(t.labels()).toEqual(['gradeRoot', 'lightRoot', 'finalRoot']);
    expect(t.lastRoot('finalRoot').children!.at(-1)).toMatchObject({ label: 'paperSprite', visible: true });

    t.passes.length = 0;
    t.renderer.updateAndRender(t.lights, 100, 200, 1.6, '#ffffff');
    expect(t.labels()).toContain('worldContainer');
  });

  it('lights the whole view, as before, until a host says what the content is — and again once it lifts it', () => {
    const t = table();
    t.passes.length = 0;
    t.renderer.invalidate();
    t.frame();
    expect(t.labels()).toEqual(['gradeRoot', 'lightRoot', 'finalRoot']);
    expect(t.lastRoot('finalRoot').children!.at(-1)).toMatchObject({ label: 'paperSprite', visible: false });

    t.renderer.setContent(world().content);
    t.frame();
    t.renderer.setContent(null);
    t.passes.length = 0;
    t.frame();
    expect(t.labels()).not.toContain('paperRoot');
    expect(t.lastRoot('finalRoot').children!.at(-1)).toMatchObject({ label: 'paperSprite', visible: false });
  });

  it('masks the export by its own content pass, at the file size, and leaves the live buffers alone', () => {
    const t = table();
    const w = world();
    t.renderer.setContent(w.content);
    t.frame();
    const live = t.lastRoot('finalRoot').children!.at(-1)!.texture;
    t.passes.length = 0;
    t.renderer.renderInto({ width: 4096, height: 3072, destroy: () => {} } as never, 128, 4096, 3072, NOON);
    const content = t.passes.find((p) => p.label === 'worldContainer')!;
    expect(content.target).toMatchObject({ width: 4096, height: 3072, resolution: 0.5 });
    expect(t.passes.find((p) => p.label === 'paperRoot')!.target).toMatchObject({ width: 2048, height: 1536, resolution: 1 });
    expect(t.lastRoot('finalRoot').children!.at(-1)!.texture).toBe(live);
  });
});
