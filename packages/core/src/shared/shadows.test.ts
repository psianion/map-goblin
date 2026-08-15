// The pure half of P3a. Nothing here draws — the claims are the ones a picture cannot check:
// that the extrusion is the quad the doc comment says it is, that nothing snaps anywhere on the
// clock, that the cache key is a function of the four things it claims, and that the
// natural-light gate is the resolver's answer rather than a second opinion.

import { describe, it, expect } from 'vitest';
import { resolveWorldLight, type MapEnvironment, type NightSky } from './world';
import { extractWallSegments } from '../engine/lighting/raycaster';
import { LightManager } from '../engine/lighting/LightManager';
import type { DungeonLayer } from '../store/types';
import {
  CASTER_HEIGHT,
  MAX_ALPHA,
  MAX_LENGTH,
  PROP_LENGTH_SCALE,
  SHADOW_STEPS,
  bandAlpha,
  propShadow,
  shadowBand,
  shadowLook,
  shadowSignature,
  type ShadowLook,
} from './shadows';

const sunAt = (minutes: number, map: MapEnvironment = {}, nightSky: NightSky = 'full-moon') =>
  resolveWorldLight({
    environment: 'outdoor',
    naturalLight: true,
    ...map,
    clockMinutes: minutes,
    nightSky,
  }).sun;

const lookAt = (minutes: number, map?: MapEnvironment, sky?: NightSky): ShadowLook | null =>
  shadowLook(sunAt(minutes, map, sky));

/** The whole day, one sample a minute — the resolution any snap would have to hide under. */
const DAY = Array.from({ length: 1440 }, (_, m) => m);

describe('shadowLook — the natural-light gate', () => {
  it('an outdoor map with the toggle on casts at midday', () => {
    const look = lookAt(720);
    expect(look).not.toBeNull();
    expect(look!.alpha).toBeGreaterThan(0);
    expect(look!.length).toBeGreaterThan(0);
  });

  it('nothing casts with natural light off, indoors, underground, or under no moon', () => {
    expect(lookAt(720, { naturalLight: false })).toBeNull();
    expect(lookAt(720, { environment: 'indoor' })).toBeNull();
    expect(lookAt(720, { environment: 'underground' })).toBeNull();
    expect(lookAt(0, {}, 'moonless')).toBeNull();
  });

  it('the moon casts, and casts fainter than the sun', () => {
    const moon = lookAt(0)!;
    const sun = lookAt(720)!;
    expect(moon).not.toBeNull();
    expect(moon.alpha).toBeLessThan(sun.alpha);
  });

  it('a low sun and a full moon both cast something a screen can show', () => {
    // The gate walk's finding: linear-in-intensity put the whole evening shoulder and the moon
    // under the noise floor. Half of noon at dusk, a third of it under a full moon.
    const noon = lookAt(720)!.alpha;
    expect(lookAt(1020)!.alpha).toBeGreaterThan(noon * 0.4); // 17:00
    expect(lookAt(420)!.alpha).toBeGreaterThan(noon * 0.4); // 07:00
    expect(lookAt(0)!.alpha).toBeGreaterThan(noon * 0.3); // full moon, midnight
  });

  it('the shadow runs away from the light, not toward it', () => {
    // Orientation 0 puts the rising sun due east (screen right), so dawn's shadow runs west.
    const dawn = lookAt(400)!;
    expect(dawn.dx).toBeLessThan(0);
  });

  it('the map orientation turns the whole day with it', () => {
    const north = lookAt(720)!;
    const turned = lookAt(720, { orientation: 90 })!;
    expect(turned.dx).not.toBeCloseTo(north.dx, 3);
    // …and only the direction: the hour still decides how long and how hard.
    expect(turned.length).toBeCloseTo(north.length, 6);
    expect(turned.alpha).toBeCloseTo(north.alpha, 6);
  });

  it('a low sun casts long and a high sun casts short, capped either way', () => {
    const noon = lookAt(720)!;
    const evening = lookAt(1020)!;
    expect(evening.length).toBeGreaterThan(noon.length);
    expect(noon.length).toBeCloseTo(CASTER_HEIGHT / Math.tan((75 * Math.PI) / 180), 5);
    for (const m of DAY) {
      const look = lookAt(m);
      if (look) expect(look.length).toBeLessThanOrEqual(MAX_LENGTH);
    }
  });
});

describe('shadowLook — continuity across the day', () => {
  // A shadow that stepped at a band edge would read as a bug in the world. The bands are
  // narration only (`BANDS`); nothing drawn is allowed to know where they are.
  const alphaOf = (m: number): number => lookAt(m)?.alpha ?? 0;

  // A minute is 1/1440 of the arc; anything visible as a step is orders of magnitude larger.
  // As a *share* of the peak rather than an absolute, because "smooth" is a claim about the
  // shape of the curve and an absolute would instead pin how dark a shadow is allowed to get:
  // every per-minute delta scales with `MAX_ALPHA`, so tuning the strength up would fail a
  // fixed bound while the ramp it is meant to police stayed exactly as smooth.
  const STEP = MAX_ALPHA * 0.012;

  it('opacity never jumps, at a band edge or anywhere else', () => {
    let worst = 0;
    for (const m of DAY) worst = Math.max(worst, Math.abs(alphaOf(m) - alphaOf((m + 1) % 1440)));
    expect(worst).toBeLessThan(STEP);
  });

  it('…including at the four narration bands and both horizons', () => {
    for (const edge of [300, 360, 420, 1020, 1080, 1140]) {
      expect(Math.abs(alphaOf(edge) - alphaOf(edge - 1))).toBeLessThan(STEP);
      expect(Math.abs(alphaOf(edge) - alphaOf(edge + 1))).toBeLessThan(STEP);
    }
  });

  it('length never jumps while anything is being drawn', () => {
    for (const m of DAY) {
      const a = lookAt(m);
      const b = lookAt((m + 1) % 1440);
      if (!a || !b) continue;
      // Relative, because the curve is genuinely steepest just under the cap (1/tan runs away
      // near the horizon) — that is a slope. A snap would move the reach by a visible fraction
      // of itself in one minute of a 1440-minute day; 5% is far past anything smooth.
      expect(Math.abs(a.length - b.length) / a.length).toBeLessThan(0.05);
    }
  });

  it('the direction only ever swings where nothing is drawn', () => {
    // The moon sets in the west a minute before the sun rises in the east, so the vector does
    // turn right round — at an opacity of zero, which is the resolver's own guarantee.
    for (const m of DAY) {
      const a = lookAt(m);
      const b = lookAt((m + 1) % 1440);
      if (!a || !b) continue;
      const swing = Math.hypot(a.dx - b.dx, a.dy - b.dy);
      expect(Math.min(a.alpha, b.alpha) * swing).toBeLessThan(0.01);
    }
  });
});

describe('shadowBand — the extrusion', () => {
  const look: ShadowLook = { dx: 1, dy: 0, length: 4, alpha: 0.4, color: '#4d5460' };

  it('extrudes the segment along the light vector', () => {
    const band = shadowBand(0, 0, 0, 10, look, SHADOW_STEPS, SHADOW_STEPS);
    expect(band.slice(0, 4)).toEqual([0, 0, 0, 10]);
    // Far corners sit a full length downwind — the wall is 10 long, so the taper is well
    // inside the "never past the midpoint" clamp.
    expect(band[4]).toBeCloseTo(4, 6);
    expect(band[6]).toBeCloseTo(4, 6);
  });

  it('each step reaches further and comes in narrower — the feather, as geometry', () => {
    const near = shadowBand(0, 0, 0, 10, look, 1, SHADOW_STEPS);
    const far = shadowBand(0, 0, 0, 10, look, SHADOW_STEPS, SHADOW_STEPS);
    expect(far[4]).toBeGreaterThan(near[4]);
    const width = (b: number[]): number => Math.abs(b[5] - b[7]);
    expect(width(far)).toBeLessThan(width(near));
  });

  it('a wall shorter than the taper never crosses itself', () => {
    // 0.1 long against a 4-unit shadow: the inset is clamped to 40% of the wall either side.
    const band = shadowBand(0, 0, 0, 0.1, look, SHADOW_STEPS, SHADOW_STEPS);
    expect(band[5]).toBeGreaterThan(band[7]);
  });

  it('a zero-length segment degenerates rather than producing NaN', () => {
    const band = shadowBand(3, 3, 3, 3, look, 2, SHADOW_STEPS);
    for (const v of band) expect(Number.isFinite(v)).toBe(true);
  });

  it('the bands stack to about the peak opacity', () => {
    const per = bandAlpha(look);
    const stacked = 1 - (1 - per) ** SHADOW_STEPS;
    expect(stacked).toBeGreaterThan(look.alpha * 0.8);
    expect(stacked).toBeLessThanOrEqual(look.alpha);
  });
});

describe('propShadow — the sprite transform', () => {
  /**
   * PixiJS's own matrix for `rotation = 0`: `c = sin(skew.x) * scale.y`, `d = cos(skew.x) *
   * scale.y`. With the sprite anchored at its foot its top corner is local `(0, -height)`, so
   * this is where the tip of the shadow actually lands on screen.
   */
  const tipOf = (look: ShadowLook, h: number): [number, number] => {
    const cast = propShadow(look, h);
    return [-h * Math.sin(cast.skewX) * cast.scaleY, -h * Math.cos(cast.skewX) * cast.scaleY];
  };

  it('lays the silhouette down exactly along the light', () => {
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
      [0, -1],
      [Math.SQRT1_2, -Math.SQRT1_2],
    ]) {
      const look: ShadowLook = { dx, dy, length: 4, alpha: 0.4, color: '#4d5460' };
      const reach = look.length * PROP_LENGTH_SCALE;
      const [x, y] = tipOf(look, 64);
      expect(x).toBeCloseTo(dx * reach, 5);
      expect(y).toBeCloseTo(dy * reach, 5);
    }
  });

  it('a prop with no texture yet scales to nothing rather than to infinity', () => {
    const cast = propShadow({ dx: 1, dy: 0, length: 4, alpha: 0.4, color: '#4d5460' }, 0);
    expect(cast.scaleY).toBe(0);
  });
});

describe('a standalone wall casts like any other', () => {
  // The gate walk found the bailey's freestanding palisade casting nothing. This pins the whole
  // chain from a wall with no floor ring anywhere near it to a quad with area in it, because a
  // standalone wall is the *only* kind on the demo map — a layer whose walls all dropped out
  // here would still look plausible, lit by the floor union's own edges.
  const standalone = (points: [number, number][]): DungeonLayer =>
    ({
      id: 'layer-1',
      type: 'dungeon',
      children: [],
      mergedFloor: null,
      standaloneWalls: [
        { id: 'w1', points, wallType: 'normal', direction: 'both', color: '#26221c', width: 0.5, roughness: 0 },
      ],
    }) as unknown as DungeonLayer;

  /** Shoelace — a degenerate extrusion (light running along the wall) comes out at 0. */
  const area = (band: number[]): number => {
    let sum = 0;
    for (let i = 0; i < band.length; i += 2) {
      const j = (i + 2) % band.length;
      sum += band[i]! * band[j + 1]! - band[j]! * band[i + 1]!;
    }
    return Math.abs(sum) / 2;
  };

  it('reaches the segment list with no floor ring on the layer at all', () => {
    // fieldstone-keep's north courtyard wall, the one the walk sampled across.
    const segments = extractWallSegments([standalone([[9, 43], [58, 43]])]);
    expect(segments).toEqual([{ x1: 9, y1: 43, x2: 58, y2: 43 }]);
  });

  it('extrudes to quads with real area at a low sun', () => {
    const [seg] = extractWallSegments([standalone([[9, 43], [58, 43]])]);
    // 17:00 with the demo map's orientation — the evening the walk was looking at.
    const look = lookAt(1020, { orientation: 90 })!;
    expect(look).not.toBeNull();
    for (let step = 1; step <= SHADOW_STEPS; step++) {
      expect(area(shadowBand(seg!.x1, seg!.y1, seg!.x2, seg!.y2, look, step))).toBeGreaterThan(1);
    }
  });

  it('…and the freestanding stub too, whichever way it happens to run', () => {
    // Vertical, mid-courtyard, nothing behind it. Under the moon the light crosses it.
    const [seg] = extractWallSegments([standalone([[18, 49], [18, 53]])]);
    const look = lookAt(0, { orientation: 90 })!;
    expect(area(shadowBand(seg!.x1, seg!.y1, seg!.x2, seg!.y2, look, SHADOW_STEPS))).toBeGreaterThan(0);
  });

  it('participates in the invalidation: editing walls bumps the epoch, and the epoch is the key', () => {
    // `invalidateAll` is what subscribeToStore fires when its `lightingKey` moves, and that key
    // carries `wallSignature` — every standalone wall's own geometry.
    const lights = new LightManager();
    const before = lights.getWallEpoch();
    lights.invalidateAll();
    const after = lights.getWallEpoch();
    expect(after).toBeGreaterThan(before);
    expect(shadowSignature('layer-1', before, 204, 90, true)).not.toBe(
      shadowSignature('layer-1', after, 204, 90, true),
    );
  });
});

describe('shadowSignature — the cache key', () => {
  const key = (over: Partial<{ id: string; epoch: number; step: number; deg: number; on: boolean }> = {}) =>
    shadowSignature(
      over.id ?? 'layer-1',
      over.epoch ?? 3,
      over.step ?? 144,
      over.deg ?? 0,
      over.on ?? true,
    );

  it('is stable for an unchanged layer, wall set, sun step and orientation', () => {
    expect(key()).toBe(key());
  });

  it('changes on a wall edit, a sun step, an orientation nudge, and per layer', () => {
    expect(key({ epoch: 4 })).not.toBe(key());
    expect(key({ step: 145 })).not.toBe(key());
    expect(key({ deg: 45 })).not.toBe(key());
    expect(key({ id: 'layer-2' })).not.toBe(key());
  });

  it('collapses every sun to one key once nothing is casting — an off map never redraws', () => {
    expect(key({ on: false, step: 0 })).toBe(key({ on: false, step: 999 }));
    expect(key({ on: false, deg: 0 })).toBe(key({ on: false, deg: 180 }));
    // …but a wall edit still rebuilds it, so turning natural light back on is not a stale draw.
    expect(key({ on: false, epoch: 9 })).not.toBe(key({ on: false }));
  });
});
