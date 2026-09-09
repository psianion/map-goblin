// The living fog's paint: an animated cloud shader over the mask geometry the fog layers
// already compute. This file owns no fog *decisions* at all — where the fog is stays the
// business of `FogRenderer`/`FogOverlay` and the ring geometry they build on mutation; what
// arrives here is that geometry rasterised into a small mask texture, and everything below
// is about how the cover over it looks and breathes.
//
// The discipline the mask layers live by carries over with one stated exception. The mask
// texture is re-rendered on fog mutation (and per frame only while a reveal fade is
// running); the *shader* runs every frame the stage draws, because a time uniform is the
// whole of its animation — that is the one per-frame cost this feature adds, and the fps
// gate in sprint3-fog is the budget it answers to. Reduced motion freezes the clock
// instead of the cover: a still cloud is still a cloud, and nothing then moves.
//
// Three light strata with independent drift vectors, not one field: layers sliding over
// each other is what reads as weather rather than as a scrolling texture. Each layer picks
// its own noise character (`layerNoise`) — puffy billow, warped-streaky smoke, a smooth
// haze, or fbm stretched along its own drift — ported verbatim from
// docs/mockups/2026-09-09-fog-current-vs-living.html's right panel, which is the reference
// look this file now targets (v2, "living fog"; the v1 fixed three-billow-band stack it
// replaces is gone).
//
// The coastline rule is the one security-shaped line in here: the mask is sampled twice,
// once straight and once displaced by the cloud field, and the two are combined with
// `min()`. A cloud lobe can therefore eat *inward* over ground the player has earned, but
// a bay can never open *outward* over ground they have not — the organic edge only ever
// covers more than the geometry says, never less. Whatever this shader does, the flat
// scrim beneath it (FogRenderer) still covers everything unearned on its own.
//
// ponytail: pixi through @dnd/core, the same reach-through TokenRenderer documents.
import { BlurFilter, Container, Geometry, Graphics, Mesh, RenderTexture, Shader, Sprite } from 'pixi.js';
import type { RenderEngine } from '@dnd/core/src/engine/RenderEngine';
import type { Bounds } from './FogRenderer';

/** Mask texel value for the memory tier — must match what the shader's tier ramp expects. */
export const MASK_MEMORY = 0x808080;

/**
 * How many pools the cloud fades over at once. The lighting pass composites 24 lights
 * (`MAX_RENDERED_LIGHTS`) and a party has a handful of darkvision eyes; past this the
 * furthest from the mask are dropped, which errs towards the cloud closing at the geometry.
 */
export const MAX_POOLS = 40;

/**
 * How far the coastline may wander, in world units (= grid cells).
 *
 * This is the *inward* reach of a cloud lobe over revealed ground — the `min()` above means
 * it is never an outward reveal. Held under the mask's own margin-plus-feather so a lobe
 * plays in the dark past a room's claim and does not lap over the outer stones of a wall
 * the room has paid for: a revealed room shows its complete wall, and a light inside it
 * pools to the wall's far face rather than to half the band.
 */
const EDGE_WARP = 0.65;

/**
 * One noise unit ≈ this many cells — the drift and billow scales below are tuned to it.
 * Matches the mockup's own unit (its `uv` is world position divided by its map's height,
 * fixed at 14 cells) so a preset's `scale`/`speed` numbers port to `uLayerA` unchanged —
 * anything else would need every preset re-tuned by hand against a different ruler.
 */
const NOISE_CELLS = 14;

/**
 * Mask-blur cells per unit of `FogLook.fade` (D1), measured off the mockup rather than
 * guessed. The mockup blurs its memory-tier mask by `10 * fade` css px, on a mask texture
 * `min(900, imgW/2)` px wide standing for a `W = 14 * aspect` cell-wide world; its demo
 * image is 1342px wide at an aspect that puts `W` at about 18.8 cells, so the texture is
 * 671px for 18.8 cells — about 35.7 px/cell. Radius in cells is then
 * `10 * fade / 35.7 ≈ 0.28 * fade`. At the new default fade (2.5) that lands at 0.7 cells,
 * close to the fixed 0.6 cells (`FOG_FADE / 2`) production used before this dial existed —
 * the port widens the look on purpose without jumping it.
 */
const FADE_BLUR_CELLS_PER_UNIT = 0.28;

/** `uSeamLobe`'s fixed value — see the seam comment in FRAGMENT for what it does. Not part
 * of `FogLook`: the wobble is a shape decision for this shader, not a table-facing dial. */
const SEAM_LOBE = 0.12;

/**
 * The mask texture's resolution, in texels per world unit, bounded both ways: enough that a
 * cell is a few texels (the feather ramps drawn into the mask survive), capped so a big map
 * does not ask for a texture the GPU minds. The texture's long side stays ≤ 2048.
 */
const maskScale = (w: number, h: number): number =>
  Math.min(24, Math.max(6, 2048 / Math.max(w, h)));

/** A cover rect this much wider than a real map is the "player holds nothing" EVERYTHING
 * bounds — no texture covers that, and no texture needs to: a null mask rect makes the
 * shader answer "hidden" everywhere, which is exactly that player's fog. */
const COVERABLE_MAX = 4096;

const VERTEX = /* glsl */ `
  in vec2 aPosition;
  out vec2 vWorld;
  uniform mat3 uProjectionMatrix;
  uniform mat3 uWorldTransformMatrix;
  uniform mat3 uTransformMatrix;
  uniform vec4 uCoverRect;
  void main() {
    vec3 pos = uTransformMatrix * vec3(aPosition, 1.0);
    gl_Position = vec4((uProjectionMatrix * uWorldTransformMatrix * pos).xy, 0.0, 1.0);
    // World position comes from the cover rect, never from the matrices: uTransformMatrix
    // is the mesh's *accumulated* transform, and the player layer mirroring the camera puts
    // screen-space in it — the first live walk read every mask sample out of range that way.
    vWorld = uCoverRect.xy + aPosition * uCoverRect.zw;
  }
`;

const FRAGMENT = /* glsl */ `
  #define MAX_POOLS ${MAX_POOLS}
  precision mediump float;
  in vec2 vWorld;
  uniform sampler2D uMask;
  uniform sampler2D uMaskSoft;
  uniform float uTime;
  uniform float uWind;
  uniform float uNoise;
  uniform float uWarp;
  uniform float uDense;
  uniform float uMist;
  uniform float uRim;
  uniform float uFade;
  uniform float uSeamLobe;
  uniform float uVeil;
  uniform float uGlow;
  uniform vec4 uMaskRect;
  uniform vec3 uDeep;
  // The base lifted toward white — the rim/underlay tint. Not read by this pass yet: the
  // blurred-floor underlay it feeds is WP3 (D3), not shipped here. Kept in sync now so that
  // work adds no further palette wiring.
  uniform vec3 uMid;
  uniform vec3 uWash;
  uniform float uWashAlpha;
  // Each layer as two vec4s — the only uniform shapes proven in this codebase's UniformGroup
  // (a scalar and a vec4 array; see uPools below, already one). uLayerA = (type, strength,
  // scale, speed); uLayerB = (angle, tint.r, tint.g, tint.b).
  uniform vec4 uLayerA[3];
  uniform vec4 uLayerB[3];
  // The pools live sight runs out over in the dark — x, y, and the radius it is whole to
  // and the one it is gone by — and how many are set. A pool's warmth (a light source, vs a
  // darkvision eye) packs into the *sign* of its inner radius rather than a fourth uniform
  // array: nothing in this codebase proves a second array-shaped uniform uploads without a
  // live GL context to check it against (this file's tests explain why), and vec4 already
  // carries the one spare bit torch glow needs. poolAt and the glow loop below both read
  // abs()/the sign of .z for it — see LivingFog.setPools in the TS half of this file.
  uniform vec4 uPools[MAX_POOLS];
  uniform int uPoolCount;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float s = 0.0;
    float a = 0.5;
    mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
    for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = r * p * 2.03 + 11.7; a *= 0.5; }
    return s;
  }
  // Puffy cauliflower lobes, not streaky filaments: |2n-1| plateaus at the noise extrema.
  float billow(vec2 p) {
    float s = 0.0;
    float a = 0.55;
    mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
    for (int i = 0; i < 4; i++) { s += a * abs(2.0 * vnoise(p) - 1.0); p = r * p * 1.94 + 11.7; a *= 0.52; }
    return s;
  }
  // One noise character per layer type — ported verbatim from the mockup. 0 billow =
  // cauliflower cloud, 1 smoke = warped streaky fbm, 2 haze = smooth low-contrast veil,
  // 3 streaks = fbm stretched along the layer's own drift direction.
  float layerNoise(int type, vec2 p, vec2 dir) {
    if (type == 1) {
      vec2 q = p + 0.7 * (vec2(fbm(p * 0.9 + 3.1), fbm(p * 0.9 + 7.7)) - 0.5);
      return smoothstep(0.22, 0.78, fbm(q));
    }
    if (type == 2) return clamp(0.5 + 1.1 * (fbm(p * 0.6) - 0.5), 0.0, 1.0);
    if (type == 3) {
      vec2 q = vec2(dot(p, dir), dot(p, vec2(-dir.y, dir.x)));
      return smoothstep(0.2, 0.8, fbm(q * vec2(0.35, 2.2)));
    }
    return billow(p);
  }
  // The tier mask, softened inward only. Live texels read the blurred copy, remapped so the
  // fade lands exactly on the neighbour's level at the line (a 1|0 edge blurs to 0.5 there,
  // a 1|0.5 edge to 0.75 — so 2b−1 is 0 against hidden and 0.5 against a memory); memory and
  // hidden texels read themselves, flat. Nothing is ever lifted above what the geometry says,
  // and a remembered room a few cells wide is not misted to void by the dark around it,
  // which a plain min(sharp, blurred) did.
  // How far into a pool this point still is: 1 out to the inner radius, easing to 0 at the
  // outer one on the lighting pass's own rim curve (the smoothstep in falloffAt), taken over
  // every pool and kept at the nearest. A torch and a darkvision ring both ease out over their
  // last quarter, the torch on to a pad past its radius where its light already is (the
  // caller sets inner and outer to say so: nightPools in FogRenderer). So
  // live sight runs out on the player's seat the way light does, and no circle is drawn.
  float poolAt(vec2 world) {
    float best = 0.0;
    for (int i = 0; i < MAX_POOLS; i++) {
      if (i >= uPoolCount) break;
      vec4 p = uPools[i];
      float iz = abs(p.z);
      float r = clamp((distance(world, p.xy) - iz) / max(p.w - iz, 1e-3), 0.0, 1.0);
      best = max(best, 1.0 - r * r * (3.0 - 2.0 * r));
    }
    return best;
  }
  float maskAt(vec2 world) {
    vec2 uv = (world - uMaskRect.xy) * uMaskRect.zw;
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
    float s = texture(uMask, uv).r;
    if (s < 0.99) return s;
    float live = clamp(2.0 * texture(uMaskSoft, uv).r - 1.0, 0.0, 1.0);
    // In the dark every live texel is inside some pool's geometry; the pools say how far.
    // The fade lands on the memory grey, not on hidden: what a token sees it has explored,
    // so past a ring the ground is a memory, and a band fading to denser cloud than the
    // remembered floor behind it read as a blue smear. The geometry's own edge, through the
    // blur, still takes a pool's rim to hidden wherever nothing was ever seen past it.
    // Floored at the memory level, because a texel the hard mask calls live is ground the
    // player holds: at worst it reads as its own memory, never as hidden. The remap above
    // runs to 0 across the blur, so without the floor the cloud formed a faint ring just
    // inside every sight edge — the same tier step as the rim and the wisps, arriving one
    // level lower down. The pool branch already floors for this reason; so does this one now.
    return uPoolCount > 0
      ? min(max(live, 0.5), max(poolAt(world), 0.5))
      : max(live, 0.5);
  }

  void main() {
    // One wind multiplier drives every layer's drift and the shared warp field (D6) — wind
    // reads through the same uTime reduced motion already freezes, so slowing/stopping the
    // clock stops the wind too, with nothing extra to gate.
    float t = uTime * uWind;
    vec2 uv = vWorld * uNoise;

    // Shared gentle warp keeps every stratum organic without reading as smoke.
    vec2 wp = uv * 1.6 + vec2(t * 0.012, -t * 0.004);
    vec2 w = vec2(fbm(wp), fbm(wp + vec2(5.2, 1.3))) - 0.5;

    // The layer stack (D5): each of the 3 layers picks its own noise character, tint and
    // drift. Density is the strength-weighted mean; colour mixes up from the base, one tint
    // per layer. top keeps the last layer's own noise apart, the way the old fixed stack
    // did, for the extra wobble the cut's d term below wants.
    float den = 0.0;
    float wsum = 0.0;
    float top = 0.0;
    vec3 col = uDeep;
    for (int i = 0; i < 3; i++) {
      int type = int(uLayerA[i].x + 0.5);
      float strength = uLayerA[i].y;
      float scale = uLayerA[i].z;
      float speed = uLayerA[i].w;
      float angle = uLayerB[i].x;
      vec3 tint = uLayerB[i].yzw;
      vec2 dir = vec2(cos(angle), sin(angle));
      float ni = layerNoise(type, uv * scale + dir * (t * speed) + 0.6 * w, dir);
      den += strength * ni;
      wsum += strength;
      col = mix(col, tint, strength * (0.15 + 0.85 * smoothstep(0.25, 0.90, ni)));
      if (i == 2) top = ni;
    }
    den = clamp(den / max(wsum, 0.05), 0.0, 1.0);

    // Torch glow (D4): the party's light warms the fog around it, as lamps do in real mist.
    // Darkvision pools stay cold — a torch is a light, a darkvision ring is an eye, and only
    // the light should tint the cloud warm.
    float glow = 0.0;
    for (int i = 0; i < MAX_POOLS; i++) {
      if (i >= uPoolCount) break;
      vec4 p = uPools[i];
      if (p.z >= 0.0) continue; // not warm — see uPools' comment above
      glow += 1.0 - smoothstep(0.0, p.w * 1.8, distance(vWorld, p.xy));
    }
    col = mix(col, vec3(1.0, 0.80, 0.50), clamp(glow, 0.0, 1.0) * uGlow * 0.7);

    // The coastline. min() is the security half — lobes eat inward, bays never open outward.
    float m = min(maskAt(vWorld), maskAt(vWorld + w * uWarp));

    // mFog floors the live/memory step at the memory level (min(m,0.5)*2 is 1 for both m=0.5
    // and m=1) so the cut terms below — d, body, wisp, rim — cannot see which of the two this
    // point is: they answer one question only, "is this ground hidden at all", the same
    // clamp kept from the pre-v2 shader that closed the ring bug (5e3ce63, 7e48810). The
    // 0.85 factor on mFog (against the mockup's bare mFog) reopens the mockup's own
    // "m*1.7 - 0.42" body threshold at the memory tier: the mockup's memory (m=0.5) sends
    // 0.5*1.7-0.42=0.43 into its d, and mFog*0.85-0.42 at mFog=1 lands there too
    // (1*0.85-0.42=0.43) — same cut depth, ported onto production's floored mFog instead of
    // the mockup's unclamped m.
    float mFog = min(m, 0.5) * 2.0;
    float d = den - (mFog * 0.85 - 0.42) + (top - 0.5) * 0.10;
    // uFade widens every one of these ramps together — a bigger fade spends the cut over
    // more world, never a sharper one.
    float body = smoothstep(-0.08 * uFade, 0.14 * uFade, d);
    float wisp = smoothstep(-0.20 * uFade, -0.06 * uFade, d) * (1.0 - body);

    // The fog is denser and darker right at its cut edge, which after the clamp above is the
    // only edge it can see: explored meeting hidden. A shadowed crease at the cut, not an ink
    // outline: 0.85 of the base (the mockup's value; the old 0.6 drew a stroke under every
    // sight line once the body around it went pale).
    float rim = smoothstep(0.0, 0.12 * uFade, d) * (1.0 - smoothstep(0.12 * uFade, 0.36 * uFade, d));
    col = mix(col, uDeep * 0.85, rim * uRim);

    // Hidden ground renders at exactly uDense, flat — the player seat passes 1.0, so
    // nothing beneath the cover (map bounds included) can telegraph through it. The ramp
    // ends at the memory grey, so a remembered room carries none of the dense cover: its
    // cloud is the mist alone, thin enough that the map reads through it.
    // The ramp's top sits past the memory grey (0.62, the mockup's), so a remembered room
    // keeps a trace of the dense cover in its mist — the reference reads that way — while the
    // seam gate below, not this ramp, is what takes the cover off toward live sight.
    float hiddenness = 1.0 - smoothstep(0.10, 0.62, m);
    float aBody = mix(uMist * (0.45 + 0.55 * den), uDense, hiddenness);
    float alpha = body * aBody + wisp * aBody * 0.28;

    // D2 — the live/memory seam, organic instead of the flat ramp v1 shipped. seam wobbles
    // the cut position by the cloud's own density (bounded ±uSeamLobe/2) so the edge is not
    // a geometric line, while staying *monotonic* in m for any fixed den: seam is linear in
    // m with a den-only offset, so as m rises from memory to live the gate below can only
    // fall or hold, never rise back — which is what keeps this a fade instead of a ring
    // (unlike the mockup's unclamped coastline, which a ring bug already forced production
    // away from twice: 5e3ce63, 7e48810). The ramp [A, B] widens with uFade (a wider fade
    // reads as a softer seam, matching the cut's own widening above) and B is held under
    // 1.0 so the gate reaches exactly 0 once m reaches 1 (live sight has no cover left but
    // the veil) rather than asymptoting toward it. A few den values right at the memory edge
    // (m≈0.5) still leave a small residual past B when uSeamLobe pushes seam under it — that
    // residual is the wobble doing its job: an organic edge, not a hairline.
    float seam = m + (den - 0.5) * uSeamLobe;
    float seamA = 1.0 - 0.5 * clamp(uFade / 2.5, 0.2, 1.0);
    float seamB = 1.0 - 0.001;
    float seamGate = 1.0 - smoothstep(seamA, seamB, seam);
    alpha *= seamGate;

    // A thin drifting veil over ground the party can see: the fog never fully leaves, only
    // thins. Gated by den (thicker cloud, more veil) and by m (only over live sight — a
    // memory keeps its own mist term above, not this).
    float veil = uVeil * smoothstep(0.35, 0.95, den) * smoothstep(0.55, 1.0, m);
    alpha = clamp(max(alpha, veil), 0.0, 1.0);

    // The cover's one hard promise, said in its own line so no dial can talk it out of it:
    // ground the mask calls hidden (m = 0 — a hidden texel is exactly 0, and the blur only
    // ever runs over live ones) renders at uDense whatever the cloud is doing. The cut terms
    // above would let it slip: at a wide enough fade the body ramp no longer saturates over
    // the shallowest cloud (uFade above ~2.6 at den 0), and the player seat's 1.0 would then
    // be a fraction — a see-through hole in unexplored ground.
    alpha = max(alpha, uDense * (1.0 - smoothstep(0.0, 0.10, m)));

    // The memory wash, under the cloud: the explored tier's own darkening, read off the same
    // seam ramp the cloud fades on so the two cannot disagree about where a tier begins.
    float washA = uWashAlpha * seamGate;
    gl_FragColor = vec4(col * alpha + uWash * washA * (1.0 - alpha), alpha + washA * (1.0 - alpha));
  }
`;

/** '#rrggbb' → [r, g, b] in 0..1; anything unparseable answers as mid grey. */
const rgb = (hex: string): [number, number, number] => {
  const n = /^#([0-9a-f]{6})$/i.exec(hex)?.[1];
  const v = n ? parseInt(n, 16) : 0x808080;
  return [((v >> 16) & 0xff) / 255, ((v >> 8) & 0xff) / 255, (v & 0xff) / 255];
};

export interface FogPalette {
  /**
   * Shade one of this look's colours — the mist base or a layer's tint — toward the scene's
   * grade and darkness. The same pull the pre-v2 `fogPalette` always did (grade-hue pull,
   * darken with `darkness`), generalised from the old fixed deep/mid/high identity to any
   * hex a `FogLook` names, so the scene grade lands on the base *and* on every layer tint
   * (D8), not only on three hardcoded stops.
   */
  shade(hex: string): [number, number, number];
}

/**
 * The seat's fog colours: pulled toward the scene's composed grade at unit luminance rather
 * than multiplied by it (which would kill a bright mist outright on a near-black grade), and
 * settled a step darker as the scene's `darkness` rises. `fogPalette(grade, darkness).shade`
 * is applied identically to the mist base and to every layer's own tint — one grade, every
 * stratum, see `LivingFog.setLook`.
 */
export function fogPalette(grade: string, darkness: number): FogPalette {
  const g = rgb(grade);
  const lum = Math.max(0.02, 0.2126 * g[0] + 0.7152 * g[1] + 0.0722 * g[2]);
  const tint = g.map((c) => Math.min(2.2, c / lum)) as [number, number, number];
  const T = 0.55;
  const dim = 1 - 0.175 * darkness;
  return {
    shade: (hex) => {
      const c = rgb(hex);
      return [0, 1, 2].map((i) => c[i] * (1 - T + T * tint[i]) * dim) as [number, number, number];
    },
  };
}

/** One pool the clear tier runs out over — see `LivingFog.setPools`. */
export interface FogPool {
  x: number;
  y: number;
  /** Whole out to here… */
  inner: number;
  /** …and gone by here. */
  outer: number;
  /** A light source glows the fog warm near it (D4); a darkvision eye does not — it is the
   * party's own sight running out in the dark, not a source of light. */
  warm: boolean;
}

export type FogLayerType = 'billow' | 'smoke' | 'haze' | 'streaks';

/** One stratum of the cloud — see `layerNoise` in FRAGMENT for what each `type` looks like. */
export interface FogLayer {
  type: FogLayerType;
  tint: string;
  strength: number;
  scale: number;
  speed: number;
  /** Drift direction, degrees. */
  angle: number;
}

/** The table-facing shape of the cloud — everything `LivingFog.setLook` can change at once.
 * `dense`/`mist`/`rim` stay on `LivingFogLook` (below): they are the tier's own opacities,
 * not part of the weather a DM dials. */
export interface FogLook {
  preset?: 'cumulus' | 'mist' | 'smoke' | 'rolling';
  /** The mist under the layers — what shows wherever every layer is thin, and the colour the
   * scene grade pulls before it ever reaches a layer tint (`fogPalette`). */
  base: string;
  layers: [FogLayer, FogLayer, FogLayer];
  /** Multiplies every layer's drift and the shared warp field (D6). */
  wind: number;
  /** How wide the coastline's fade and the mask's own blur run, in the same cells the mask
   * geometry is drawn in (D1). */
  fade: number;
  veil: number;
  glow: number;
  /** Lifts D6's layer cap from one 'smoke' layer to three. Off by default — the plan's
   * performance bar is measured per layer type before this defaults on for anyone. */
  heavy?: boolean;
}

const TYPE_CODE: Record<FogLayerType, number> = { billow: 0, smoke: 1, haze: 2, streaks: 3 };
const TYPE_NAMES: readonly FogLayerType[] = ['billow', 'smoke', 'haze', 'streaks'];

/** [type, tint, strength, scale, speed, angle-in-degrees] — the mockup's own row shape. */
type PresetRow = readonly [number, string, number, number, number, number];
const preset = (rows: readonly [PresetRow, PresetRow, PresetRow]): [FogLayer, FogLayer, FogLayer] =>
  rows.map(([type, tint, strength, scale, speed, angle]) => ({
    type: TYPE_NAMES[type],
    tint,
    strength,
    scale,
    speed,
    angle,
  })) as [FogLayer, FogLayer, FogLayer];

/** Ported verbatim from docs/mockups/2026-09-09-fog-current-vs-living.html's `PRESETS`. */
export const FOG_PRESETS: Record<'cumulus' | 'mist' | 'smoke' | 'rolling', [FogLayer, FogLayer, FogLayer]> = {
  cumulus: preset([
    [0, '#aab2ba', 1.0, 1.05, 0.009, 20],
    [0, '#d5dade', 0.6, 2.1, 0.017, 160],
    [0, '#f2f4f6', 0.4, 3.8, 0.028, 335],
  ]),
  mist: preset([
    [2, '#b9c6d2', 1.0, 0.8, 0.006, 10],
    [2, '#dfe7ee', 0.7, 2.2, 0.012, 190],
    [1, '#eef2f5', 0.3, 4.0, 0.02, 30],
  ]),
  smoke: preset([
    [1, '#6f7278', 1.0, 1.2, 0.02, 90],
    [1, '#9a9ea3', 0.6, 2.6, 0.035, 250],
    [3, '#c4c7cb', 0.35, 4.5, 0.05, 80],
  ]),
  rolling: preset([
    [0, '#9fa8b0', 1.0, 0.6, 0.006, 0],
    [2, '#cfd6dc', 0.8, 1.8, 0.01, 180],
    [3, '#eef1f3', 0.35, 3.5, 0.03, 15],
  ]),
};

/**
 * The look the mockup was showing when it was signed off (2026-09-09): the ground-mist preset
 * as re-tuned by hand in the page — a white base, a near-black billow deck at strength 0.4, a
 * warm haze, and a white smoke top; every layer driven far faster than the presets above.
 * Provisional until the lock-the-defaults session the plan's WP1 leaves for after the settings
 * panel ships (docs/2026-09-09-living-fog-v2-plan.md §4).
 */
export const DEFAULT_FOG_LOOK: FogLook = {
  base: '#ffffff',
  layers: preset([
    [0, '#05080b', 0.4, 6, 0.12, 345],
    [2, '#945f14', 0.25, 2.2, 0.155, 300],
    [1, '#ffffff', 0.6, 4, 0.145, 320],
  ]),
  wind: 4,
  fade: 4,
  veil: 0.22,
  glow: 1,
};

/**
 * D6's provisional heavy-fog cap: at most one 'smoke' layer (12 noise evaluations against 4
 * for the other three types) unless the caller has turned heavy fog on. An extra smoke layer
 * demotes to 'billow' rather than being dropped, so a preset authored with two stays a
 * three-layer cloud instead of quietly losing a stratum.
 */
const capLayers = (layers: readonly FogLayer[], heavy: boolean): readonly FogLayer[] => {
  if (heavy) return layers;
  let seenSmoke = false;
  return layers.map((layer) => {
    if (layer.type !== 'smoke') return layer;
    if (!seenSmoke) {
      seenSmoke = true;
      return layer;
    }
    return { ...layer, type: 'billow' };
  });
};

export interface LivingFogLook {
  /** Cover over never-explored ground. The player seat passes exactly 1 — see the shader. */
  dense: number;
  /**
   * How far a tier's edge fades inward, in cells, before the first `setLook` call recomputes
   * it from `FogLook.fade` (`FADE_BLUR_CELLS_PER_UNIT`) — the blur radius of the soft mask.
   */
  fade: number;
  /** The mist over the memory tier. */
  mist: number;
  /** How dark the cut edge's rim goes. */
  rim: number;
}

export interface LivingFog {
  /** The animated cover. The caller parents it where its seat's draw order wants it. */
  mesh: Mesh<Geometry, Shader>;
  /** Draw the tier mask into this, in world coordinates, then call `renderMask`. */
  maskPaint: Graphics;
  /** Reveal fades draw here, above the tiers; render per frame only while one runs. */
  fadePaint: Container;
  /** Point the mask texture at this world rect (null ⇒ everything is hidden). */
  setMaskBounds(bounds: Bounds | null): void;
  /**
   * The two textures the cloud shader samples, for a caller that paints them itself instead
   * of through `maskPaint` — the raster tier compositor, which composites vision mode's whole
   * mask on the GPU.
   *
   * These are the same two objects for the life of this fog: the shader's bind group holds
   * their *sources*, so a caller may resize them in place but must never swap them.
   */
  readonly maskTextures: { mask: RenderTexture; maskSoft: RenderTexture };
  /**
   * Where the mask textures currently sit and what they are sized at, or null when the last
   * `setMaskBounds` found nothing coverable — which is "hidden everywhere", and wants no
   * paint at all.
   */
  maskFit(): { scale: number; bounds: Bounds } | null;
  /** Rasterise `maskPaint` + `fadePaint` into the mask texture. */
  renderMask(): void;
  /** Shade `setLook`'s base and layer tints toward this scene's grade and darkness — kept so
   * a later `setLook` (a new preset, a slider) and a later `setPalette` (the scene's grade or
   * darkness changing) can each fire on their own without clobbering the other's state. */
  setPalette(palette: FogPalette): void;
  /** The weather itself: base colour, the three layers, wind/fade/veil/glow. Also updates the
   * mask's own blur radius (D1) and re-renders the soft mask if one is already sized, so a
   * fade change shows without waiting on the next fog mutation. */
  setLook(look: FogLook): void;
  /** The mist over the memory tier, 0..1 — the caller eases it with the light level. */
  setMist(mist: number): void;
  /**
   * The wash under the cloud on the memory tier — a 0xrrggbb colour already graded the way
   * the map beneath it is, and its strength. 0 (the default) draws none: the DM's haze wants
   * the cloud alone.
   */
  setWash(color: number, alpha: number): void;
  /**
   * The pools live sight runs out over, world units: whole out to `inner`, gone by `outer`.
   * Empty (the default, and daylight) leaves the geometry's edge as the only edge.
   */
  setPools(pools: readonly FogPool[]): void;
  /** Stretch the cover quad over a world rect (the visible viewport, plus margin). */
  cover(bounds: Bounds): void;
  /** Advance the clock. The caller decides whether reduced motion freezes it. */
  advance(dtSeconds: number): void;
  destroy(): void;
}

export function createLivingFog(engine: RenderEngine, initialLook: LivingFogLook): LivingFog {
  // A unit quad; `cover` moves and stretches it. The transform is what the vertex shader
  // reads the world position back out of, so the fragment works in world units.
  const geometry = new Geometry({
    attributes: { aPosition: [0, 0, 1, 0, 1, 1, 0, 1] },
    indexBuffer: [0, 1, 2, 0, 2, 3],
  });

  const maskRT = RenderTexture.create({ width: 4, height: 4 });
  // The softened copy: `maskRT` through one blur, re-rendered whenever the mask is.
  const maskSoftRT = RenderTexture.create({ width: 4, height: 4 });
  const soften = new BlurFilter({ strength: 0, quality: 2 });
  const softSprite = new Sprite(maskRT);
  softSprite.filters = [soften];
  const softScene = new Container();
  softScene.addChild(softSprite);
  const maskScene = new Container();
  const maskPaint = new Graphics();
  const fadePaint = new Container();
  maskScene.addChild(maskPaint, fadePaint);

  const shader = Shader.from({
    gl: { vertex: VERTEX, fragment: FRAGMENT },
    resources: {
      uMask: maskRT.source,
      uMaskSoft: maskSoftRT.source,
      fogUniforms: {
        uTime: { value: 0, type: 'f32' },
        uWind: { value: DEFAULT_FOG_LOOK.wind, type: 'f32' },
        uNoise: { value: 1 / NOISE_CELLS, type: 'f32' },
        uWarp: { value: EDGE_WARP, type: 'f32' },
        uDense: { value: initialLook.dense, type: 'f32' },
        uMist: { value: initialLook.mist, type: 'f32' },
        uRim: { value: initialLook.rim, type: 'f32' },
        uFade: { value: DEFAULT_FOG_LOOK.fade, type: 'f32' },
        uSeamLobe: { value: SEAM_LOBE, type: 'f32' },
        uVeil: { value: DEFAULT_FOG_LOOK.veil, type: 'f32' },
        uGlow: { value: DEFAULT_FOG_LOOK.glow, type: 'f32' },
        uMaskRect: { value: [0, 0, 0, 0], type: 'vec4<f32>' },
        uCoverRect: { value: [0, 0, 1, 1], type: 'vec4<f32>' },
        uDeep: { value: [0, 0, 0], type: 'vec3<f32>' },
        uMid: { value: [0, 0, 0], type: 'vec3<f32>' },
        uWash: { value: [0, 0, 0], type: 'vec3<f32>' },
        uWashAlpha: { value: 0, type: 'f32' },
        uPools: { value: new Float32Array(MAX_POOLS * 4), type: 'vec4<f32>', size: MAX_POOLS },
        uPoolCount: { value: 0, type: 'i32' },
        uLayerA: { value: new Float32Array(3 * 4), type: 'vec4<f32>', size: 3 },
        uLayerB: { value: new Float32Array(3 * 4), type: 'vec4<f32>', size: 3 },
      },
    },
  });
  const uniforms = shader.resources.fogUniforms.uniforms as {
    uTime: number;
    uWind: number;
    uFade: number;
    uVeil: number;
    uGlow: number;
    uMist: number;
    uWashAlpha: number;
    uWash: Float32Array | number[];
    uPools: Float32Array;
    uPoolCount: number;
    uMaskRect: Float32Array | number[];
    uCoverRect: Float32Array | number[];
    uDeep: Float32Array | number[];
    uMid: Float32Array | number[];
    uLayerA: Float32Array;
    uLayerB: Float32Array;
  };

  const mesh = new Mesh({ geometry, shader });
  mesh.eventMode = 'none';

  // Dev-only instruments, on `__testProbe`'s rationale: the mask texture is the one thing
  // a browser walk cannot read off the DOM, and every fog bug so far has been "which half
  // is wrong — the geometry or the texture".
  if (import.meta.env.DEV) {
    const dbg = ((window as Window & { __livingFog?: unknown[] }).__livingFog ??= []);
    dbg.push({ rt: () => maskRT, soft: () => maskSoftRT, scene: maskScene, mesh });
  }

  let rect: { minX: number; minY: number; w: number; h: number } | null = null;
  /** Texels per world unit the mask textures are currently sized at — `maskTarget`'s. */
  let scale = 0;
  let time = 0;
  /** No grading until the scene hands one over — an identity shade so the first `setLook`,
   * called before the first `setPalette`, still paints real colours. */
  let palette: FogPalette = { shade: (hex) => rgb(hex) };
  let currentLook: FogLook = DEFAULT_FOG_LOOK;
  /** The mask blur radius in cells, live — `setMaskBounds` reads it on every resize, `setLook`
   * recomputes it from `FogLook.fade` (D1). Starts at the constructor's own cells so a mask
   * built before the first `setLook` still gets a sane blur. */
  let fadeCells = initialLook.fade;

  const setVec = (target: Float32Array | number[], values: readonly number[]): void => {
    for (let i = 0; i < values.length; i++) target[i] = values[i];
  };
  const distanceToMask = (p: { x: number; y: number }): number =>
    rect ? Math.hypot(p.x - (rect.minX + rect.w / 2), p.y - (rect.minY + rect.h / 2)) : 0;

  /** Re-shade the current look's base and layer tints and push every layer uniform — the one
   * place `setPalette` and `setLook` both land, so neither can leave the other stale. */
  const applyLookColors = (): void => {
    const base = palette.shade(currentLook.base);
    setVec(uniforms.uDeep, base);
    setVec(uniforms.uMid, base.map((v) => v + (1 - v) * 0.45));
    const layers = capLayers(currentLook.layers, currentLook.heavy ?? false);
    layers.forEach((layer, i) => {
      uniforms.uLayerA[i * 4 + 0] = TYPE_CODE[layer.type];
      uniforms.uLayerA[i * 4 + 1] = layer.strength;
      uniforms.uLayerA[i * 4 + 2] = layer.scale;
      uniforms.uLayerA[i * 4 + 3] = layer.speed;
      const tint = palette.shade(layer.tint);
      uniforms.uLayerB[i * 4 + 0] = (layer.angle * Math.PI) / 180;
      uniforms.uLayerB[i * 4 + 1] = tint[0];
      uniforms.uLayerB[i * 4 + 2] = tint[1];
      uniforms.uLayerB[i * 4 + 3] = tint[2];
    });
  };
  applyLookColors();

  return {
    mesh,
    maskPaint,
    fadePaint,
    setMaskBounds(bounds) {
      const w = bounds ? bounds.maxX - bounds.minX : 0;
      const h = bounds ? bounds.maxY - bounds.minY : 0;
      if (!bounds || w <= 0 || h <= 0 || Math.max(w, h) > COVERABLE_MAX) {
        rect = null;
        scale = 0;
        setVec(uniforms.uMaskRect, [0, 0, 0, 0]); // degenerate ⇒ maskAt answers hidden
        return;
      }
      rect = { minX: bounds.minX, minY: bounds.minY, w, h };
      const s = maskScale(w, h);
      scale = s;
      const [tw, th] = [Math.ceil(w * s), Math.ceil(h * s)];
      if (maskRT.width !== tw || maskRT.height !== th) {
        // Resize in place rather than recreate: the shader's bind group holds the texture
        // *source*, and a fresh RenderTexture is a fresh source the bind does not follow.
        maskRT.resize(tw, th);
        maskSoftRT.resize(tw, th);
      }
      soften.strength = fadeCells * s;
      maskScene.scale.set(tw / w, th / h);
      maskScene.position.set(-bounds.minX * (tw / w), -bounds.minY * (th / h));
      setVec(uniforms.uMaskRect, [bounds.minX, bounds.minY, 1 / w, 1 / h]);
    },
    maskTextures: { mask: maskRT, maskSoft: maskSoftRT },
    maskFit() {
      return rect
        ? {
            scale,
            bounds: {
              minX: rect.minX,
              minY: rect.minY,
              maxX: rect.minX + rect.w,
              maxY: rect.minY + rect.h,
            },
          }
        : null;
    },
    renderMask() {
      if (!rect) return;
      engine.renderToTexture(maskScene, maskRT, true);
      engine.renderToTexture(softScene, maskSoftRT, true);
    },
    setPalette(p) {
      palette = p;
      applyLookColors();
    },
    setLook(look) {
      currentLook = look;
      uniforms.uWind = look.wind;
      uniforms.uFade = look.fade;
      uniforms.uVeil = look.veil;
      uniforms.uGlow = look.glow;
      applyLookColors();
      fadeCells = FADE_BLUR_CELLS_PER_UNIT * look.fade;
      if (rect) {
        // The mask geometry has not changed, only how much the soft copy blurs it — so only
        // the soft render needs to run again, not the full `renderMask`.
        soften.strength = fadeCells * scale;
        engine.renderToTexture(softScene, maskSoftRT, true);
      }
    },
    setMist(mist) {
      uniforms.uMist = Math.min(1, Math.max(0, mist));
    },
    setWash(color, alpha) {
      setVec(uniforms.uWash, [
        ((color >> 16) & 0xff) / 255,
        ((color >> 8) & 0xff) / 255,
        (color & 0xff) / 255,
      ]);
      uniforms.uWashAlpha = Math.min(1, Math.max(0, alpha));
    },
    setPools(pools) {
      // Nearest the mask first when there are too many: the ones a seat can see are the ones
      // that matter, and the mask is where the seat is looking.
      const kept =
        pools.length <= MAX_POOLS
          ? pools
          : [...pools]
              .sort((a, b) => distanceToMask(a) - distanceToMask(b))
              .slice(0, MAX_POOLS);
      kept.forEach((p, i) => {
        uniforms.uPools[i * 4] = p.x;
        uniforms.uPools[i * 4 + 1] = p.y;
        // Warm packs as a negative inner radius (never negative on its own — a radius is
        // never below 0) rather than a fourth uniform array; see FRAGMENT's `uPools` comment.
        uniforms.uPools[i * 4 + 2] = p.warm ? -Math.max(p.inner, 1e-4) : p.inner;
        uniforms.uPools[i * 4 + 3] = p.outer;
      });
      uniforms.uPoolCount = kept.length;
    },
    cover(bounds) {
      const [w, h] = [bounds.maxX - bounds.minX, bounds.maxY - bounds.minY];
      mesh.position.set(bounds.minX, bounds.minY);
      mesh.scale.set(w, h);
      setVec(uniforms.uCoverRect, [bounds.minX, bounds.minY, w, h]);
    },
    advance(dtSeconds) {
      time += dtSeconds;
      uniforms.uTime = time;
    },
    destroy() {
      if (!mesh.destroyed) mesh.destroy();
      maskScene.destroy({ children: true });
      softScene.destroy({ children: true });
      soften.destroy();
      maskRT.destroy(true);
      maskSoftRT.destroy(true);
      geometry.destroy();
      shader.destroy();
    },
  };
}
