// What the sun does to a wall, as numbers — the whole of P3a that is not PixiJS.
//
// Pure, and beside `world.ts` for the same reason: the resolver says where the light is
// standing, this says what that looks like on the ground, and both are read by two apps that
// must not drift. Nothing here reads state; the caller hands over a `SunVector` and gets
// geometry back.
//
// The one rule the whole file is built around: **every output is a continuous function of the
// sun's altitude**. A shadow that snapped a step longer at 07:00 would read as a bug in the
// world, not a band boundary — so no branch here switches on a time-of-day word, and the two
// places a branch is unavoidable (the sun/moon flip) sit exactly where `intensity` is already
// 0 and nothing is drawn.

import { mixOklch, type SunVector } from './world';

// ─── Tunables ─────────────────────────────────────────────
// Painterly starting values — walked and tuned at the gate, like the time palette's.

/** How tall the caster reads, in world units (1 unit = one grid cell = 5ft). */
export const CASTER_HEIGHT = 1.2;
/** The longest a shadow ever reaches. The sun on the horizon would otherwise cast to infinity. */
export const MAX_LENGTH = 5;
/** Peak opacity, at the caster's own foot, with the light at full strength. */
export const MAX_ALPHA = 0.42;
/** A prop casts a shorter shadow than a wall — it is a barrel, not a battlement. */
export const PROP_LENGTH_SCALE = 0.55;
/**
 * How many nested bands the soft edge is built from — the `featherEdge` technique
 * (FogRenderer), in the shape a shadow wants: each band reaches further and is narrower than
 * the last, at an even fraction of the peak alpha, so the overlap telescopes to a full-strength
 * pool at the wall and a faint tapering tip. Flat geometry, no filter, no per-frame cost.
 */
export const SHADOW_STEPS = 4;
/** How much of its length a band loses off each side per step — the tip's taper. */
const TAPER = 0.22;

/** The shadow a mid-day sun casts: cool, neutral, the style guide's one confident direction. */
const NEUTRAL_SHADOW = '#4d5460';
/** …warmed as the light drops to the horizon (low amber sun). */
const LOW_SUN_SHADOW = '#6b5647';
/** …and the moon's, which is the same shadow with the warmth taken out of it. */
const MOON_SHADOW = '#525c6e';

// ─── The look ─────────────────────────────────────────────

/** Everything the sun says about a shadow, before any particular caster is named. */
export interface ShadowLook {
  /** Unit vector the shadow runs along — screen space, y down. */
  dx: number;
  dy: number;
  /** How far a wall's shadow reaches, world units. */
  length: number;
  /** Peak opacity at the caster's foot, 0..1. */
  alpha: number;
  /** '#rrggbb' — multiplied into the ground, never drawn opaque. */
  color: string;
}

const rad = (deg: number): number => (deg * Math.PI) / 180;

/**
 * What the light in the sky is doing to the ground, or `null` when nothing is casting.
 *
 * `null` is the natural-light gate, already decided: `sunAt` returns `kind: null` for an indoor
 * map, a map with the toggle off, and a moonless night, so this file never re-asks the
 * question — it just declines to draw when there is no answer.
 */
export function shadowLook(sun: SunVector): ShadowLook | null {
  if (sun.kind === null || sun.intensity <= 0) return null;
  // Away from the light, not toward it.
  const theta = rad(sun.azimuth + 180);
  const altitude = Math.max(sun.altitude, 0);
  // The horizon's tangent is 0, so the raw length runs to infinity there; the cap is what
  // makes it finite, and `Math.min` keeps it continuous while doing so.
  const reach = CASTER_HEIGHT / Math.max(Math.tan(rad(altitude)), 1e-6);
  // How low the light is standing, 0 overhead → 1 on the horizon. Continuous, and free of
  // `MAX_ALTITUDE`: a cosine says "low" without having to agree with the resolver about a cap.
  const low = Math.cos(rad(altitude));
  return {
    dx: Math.cos(theta),
    dy: Math.sin(theta),
    length: Math.min(reach, MAX_LENGTH),
    // Straight off `intensity`, which the resolver already fades to 0 at both horizons — so a
    // shadow lengthens and thins out together, and the sun/moon handover happens at nothing.
    alpha: MAX_ALPHA * sun.intensity,
    color:
      sun.kind === 'moon'
        ? MOON_SHADOW
        : // A warm tint shift, at low chroma — the amber is in the hue, never in the saturation.
          mixOklch(NEUTRAL_SHADOW, LOW_SUN_SHADOW, low),
  };
}

// ─── Wall extrusion ───────────────────────────────────────

/**
 * One band of one wall segment's shadow, as a flat `[x, y, x, y, …]` ring.
 *
 * `step` runs 1..{@link SHADOW_STEPS}: band 1 is the short wide one that sits against the wall,
 * the last is the long narrow one that reaches the tip. Drawn back to front at
 * {@link bandAlpha} each, the overlap is the soft ramp.
 */
export function shadowBand(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  look: ShadowLook,
  step: number,
  steps: number = SHADOW_STEPS,
): number[] {
  const t = step / steps;
  const vx = look.dx * look.length * t;
  const vy = look.dy * look.length * t;
  // Pull the far corners in along the wall's own direction — the further a band reaches, the
  // narrower it is, which is the lateral half of the feather.
  const segLen = Math.hypot(x2 - x1, y2 - y1);
  // Never past the midpoint: a wall shorter than the taper would otherwise cross itself.
  const inset = segLen > 0 ? Math.min(look.length * TAPER * t, segLen * 0.4) : 0;
  const ux = segLen > 0 ? ((x2 - x1) / segLen) * inset : 0;
  const uy = segLen > 0 ? ((y2 - y1) / segLen) * inset : 0;
  return [x1, y1, x2, y2, x2 - ux + vx, y2 - uy + vy, x1 + ux + vx, y1 + uy + vy];
}

/** What each band is filled at — even fractions, so the overlap lands on {@link ShadowLook.alpha}. */
export const bandAlpha = (look: ShadowLook, steps: number = SHADOW_STEPS): number =>
  look.alpha / steps;

// ─── Props ────────────────────────────────────────────────

/** A prop's shadow as a sprite transform: the art, sheared flat along the light. */
export interface PropShadow {
  /** PixiJS `skew.x` — shears the sprite's own vertical into the light's direction. */
  skewX: number;
  /**
   * PixiJS `scale.y`, against the texture's pixel height. Negative: the sprite is flipped
   * about its foot so it lies on the ground in front of itself instead of standing up.
   */
  scaleY: number;
  alpha: number;
  color: string;
}

/**
 * The transform that lays a prop's silhouette down along the light.
 *
 * With the shadow sprite anchored at its foot (0.5, 1), PixiJS's skew/scale pair works out so
 * that the sprite's top corner lands exactly `length` away along the light vector:
 * `skew.x = atan2(dx, dy)` aims it and `scale.y = -length / textureHeight` sets the reach.
 *
 * ponytail: the prop's own `rotation` is dropped — a shadow is a smear at 0.2 alpha and a
 * rotated barrel's is not a shape anyone reads. Compose the two if a gate walk ever says
 * otherwise.
 */
export function propShadow(look: ShadowLook, textureHeight: number): PropShadow {
  const length = look.length * PROP_LENGTH_SCALE;
  return {
    skewX: Math.atan2(look.dx, look.dy),
    scaleY: textureHeight > 0 ? -length / textureHeight : 0,
    // A prop's shadow is the faint one — the walls carry the direction, the props confirm it.
    alpha: look.alpha * 0.6,
    color: look.color,
  };
}

// ─── The cache key ────────────────────────────────────────

/**
 * What a layer's drawn shadows are a function of, as one string — the `lightingSignature`
 * idiom (LightingRenderer), and for the same reason: an identical string means the geometry
 * already on screen is still right, so the frame costs a compare and nothing else.
 *
 * `wallEpoch` is LightManager's wall-set counter (bumped by the same `lightingKey` change that
 * re-sweeps the lights), `sunStep` is the coarsened clock (`timeBucket`) and `orientation` is
 * the one input to the sun that is not the clock — so a paused clock on an unedited map settles
 * onto one string and never redraws.
 *
 * Every term is exact rather than rounded off a continuous number on purpose: a key that drifts
 * inside its own bucket is a key that redraws every frame of a scrub, which is the cost this
 * exists to avoid. The sun the geometry is *drawn* from is still the continuous one — the
 * bucket only says how often the picture is allowed to be re-asked for.
 */
export const shadowSignature = (
  layerId: string,
  wallEpoch: number,
  sunStep: number,
  orientation: number,
  casting: boolean,
): string =>
  casting ? `${layerId}|${wallEpoch}|${sunStep}|${orientation}` : `${layerId}|${wallEpoch}|off`;
