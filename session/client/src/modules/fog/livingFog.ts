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
// each other is what reads as weather rather than as a scrolling texture. The noise is
// billow (|2n-1| — puffy plateaus with soft creases); warped FBM was tried first and reads
// as smoke streaks, which the reference explicitly is not.
//
// The coastline rule is the one security-shaped line in here: the mask is sampled twice,
// once straight and once displaced by the cloud field, and the two are combined with
// `min()`. A cloud lobe can therefore eat *inward* over ground the player has earned, but
// a bay can never open *outward* over ground they have not — the organic edge only ever
// covers more than the geometry says, never less. Whatever this shader does, the flat
// scrim beneath it (FogRenderer) still covers everything unearned on its own.
//
// ponytail: pixi through @dnd/core, the same reach-through TokenRenderer documents.
import { Container, Geometry, Graphics, Mesh, RenderTexture, Shader } from 'pixi.js';
import type { RenderEngine } from '@dnd/core/src/engine/RenderEngine';
import type { Bounds } from './FogRenderer';

/** Mask texel value for the memory tier — must match what the shader's tier ramp expects. */
export const MASK_MEMORY = 0x808080;

/**
 * How far the coastline may wander, in world units (= grid cells).
 *
 * This is the *inward* reach of a cloud lobe over revealed ground — the `min()` above means
 * it is never an outward reveal. Held under the mask's own margin-plus-feather so a lobe
 * plays in the dark past a room's claim and does not lap over the outer stones of a wall
 * the room has paid for: a revealed room shows its complete wall, and a light inside it
 * pools to the wall's far face rather than to half the band.
 */
const EDGE_WARP = 0.7;

/** One noise unit ≈ this many cells — the drift and billow scales below are tuned to it. */
const NOISE_CELLS = 28;

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
  precision mediump float;
  in vec2 vWorld;
  uniform sampler2D uMask;
  uniform float uTime;
  uniform float uNoise;
  uniform float uWarp;
  uniform float uDense;
  uniform float uMist;
  uniform float uRim;
  uniform vec4 uMaskRect;
  uniform vec3 uDeep;
  uniform vec3 uMid;
  uniform vec3 uHigh;

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
  float maskAt(vec2 world) {
    vec2 uv = (world - uMaskRect.xy) * uMaskRect.zw;
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
    return texture(uMask, uv).r;
  }

  void main() {
    float t = uTime;
    vec2 uv = vWorld * uNoise;

    // Shared gentle warp keeps every stratum organic without reading as smoke.
    vec2 wp = uv * 1.6 + vec2(t * 0.012, -t * 0.004);
    vec2 w = vec2(fbm(wp), fbm(wp + vec2(5.2, 1.3))) - 0.5;

    // Three light strata with independent drift — the layering is the motion.
    float deck = billow(uv * 1.05 + vec2(t * 0.008, t * 0.003) + 0.55 * w);
    float mid1 = billow(uv * 2.10 + vec2(-t * 0.016, t * 0.007) + 0.75 * w);
    float top  = billow(uv * 3.80 + vec2(t * 0.026, -t * 0.012) + 0.55 * w);
    float den = clamp(0.50 * deck + 0.32 * mid1 + 0.18 * top, 0.0, 1.0);

    // Opaque deck below, lighter translucent strata stacked above.
    vec3 col = mix(uDeep, uMid, 0.30 + 0.50 * smoothstep(0.15, 0.90, deck));
    col = mix(col, mix(uMid, uHigh, 0.45), 0.40 * smoothstep(0.40, 0.85, mid1));
    col = mix(col, uHigh, 0.32 * smoothstep(0.50, 0.95, top));

    // The coastline. min() is the security half — lobes eat inward, bays never open outward.
    float m = min(maskAt(vWorld), maskAt(vWorld + w * uWarp));

    // The steeper slope holds the contour to the outer half of the mask's feather ramp, so
    // the fog spends itself past the margin instead of on the wall band inside it. The wide
    // smoothstep is the felt softness: the contour stays put, the alpha across it breathes
    // over a broad band — a crisp POSITION with a soft RAMP, never a hard line.
    float d = den - (m * 2.0 - 0.42) + (top - 0.5) * 0.10;
    float body = smoothstep(-0.26, 0.20, d);
    float wisp = smoothstep(-0.40, -0.22, d) * (1.0 - body);

    // The fog is denser and darker right at its cut edge.
    float rim = smoothstep(0.0, 0.12, d) * (1.0 - smoothstep(0.12, 0.36, d));
    col = mix(col, uDeep * 0.6, rim * uRim);

    // Hidden ground renders at exactly uDense, flat — the player seat passes 1.0, so
    // nothing beneath the cover (map bounds included) can telegraph through it.
    float hiddenness = 1.0 - smoothstep(0.10, 0.62, m);
    float aBody = mix(uMist * (0.45 + 0.55 * den), uDense, hiddenness);
    float alpha = clamp(body * aBody + wisp * aBody * 0.28, 0.0, 1.0);

    // Sight running out is LIGHT running out. The mask's radial fade (the light-pool
    // curve, painted per eye) reaches the shader as the top half of the mask range; here
    // it becomes a veil of pure darkness beneath the cloud — no fog colour, exactly how
    // a lamp's pool dims to nothing. It rises to the local mist level so the hand-off to
    // the tier fog beyond the sweep is seamless, and (1 - body) retires it wherever the
    // cloud itself already covers.
    float veil = uMist * (0.45 + 0.55 * den) * clamp((1.0 - m) * 2.0, 0.0, 1.0) * (1.0 - body);
    float outA = alpha + veil * (1.0 - alpha);
    col = col * (alpha / max(outA, 0.001));
    alpha = outA;

    // Thin cover dims, thick cover clouds. Translucent fog painted in the strata's own
    // light colours over dark ground reads as a glowing halo (the sight fade's ring at
    // night); shading it toward deep shadow as coverage thins makes an edge read as sight
    // running out rather than as fog lighting up.
    col = mix(uDeep * 0.55, col, smoothstep(0.05, 0.90, alpha / max(uDense, 0.001)));
    gl_FragColor = vec4(col * alpha, alpha);
  }
`;

/** '#rrggbb' → [r, g, b] in 0..1; anything unparseable answers as mid grey. */
const rgb = (hex: string): [number, number, number] => {
  const n = /^#([0-9a-f]{6})$/i.exec(hex)?.[1];
  const v = n ? parseInt(n, 16) : 0x808080;
  return [((v >> 16) & 0xff) / 255, ((v >> 8) & 0xff) / 255, (v & 0xff) / 255];
};

export interface FogPalette {
  deep: [number, number, number];
  mid: [number, number, number];
  high: [number, number, number];
}

/** The night-default identity: cold smoke. Tuned in docs/mockups/fog-living-mockup.html. */
const SMOKE: FogPalette = {
  deep: rgb('#0c1118'),
  mid: rgb('#27333f'),
  high: rgb('#5e7689'),
};

/**
 * The seat's fog colours: the cold-smoke identity pulled toward the scene's composed grade.
 *
 * The grade is a mood colour, often near-black at night — multiplying by it would kill the
 * fog outright, so the pull is by the grade's *hue at unit luminance*: a torchlit scene fogs
 * warm and a night forest fogs cold while the fog keeps its own brightness. `bite` then
 * settles the whole cover a step darker on a scene the DM has turned dark, because darkness
 * should feel heavier, not merely be labelled so.
 */
export function fogPalette(grade: string, bite: number): FogPalette {
  const g = rgb(grade);
  const lum = Math.max(0.02, 0.2126 * g[0] + 0.7152 * g[1] + 0.0722 * g[2]);
  const tint = g.map((c) => Math.min(2.2, c / lum)) as [number, number, number];
  const T = 0.55;
  const dim = 1 - 0.25 * bite;
  const shade = (c: [number, number, number]): [number, number, number] =>
    [0, 1, 2].map((i) => c[i] * (1 - T + T * tint[i]) * dim) as [number, number, number];
  return { deep: shade(SMOKE.deep), mid: shade(SMOKE.mid), high: shade(SMOKE.high) };
}

export interface LivingFogLook {
  /** Cover over never-explored ground. The player seat passes exactly 1 — see the shader. */
  dense: number;
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
  /** Rasterise `maskPaint` + `fadePaint` into the mask texture. */
  renderMask(): void;
  setPalette(palette: FogPalette): void;
  /** Stretch the cover quad over a world rect (the visible viewport, plus margin). */
  cover(bounds: Bounds): void;
  /** Advance the clock. The caller decides whether reduced motion freezes it. */
  advance(dtSeconds: number): void;
  destroy(): void;
}

export function createLivingFog(engine: RenderEngine, look: LivingFogLook): LivingFog {
  // A unit quad; `cover` moves and stretches it. The transform is what the vertex shader
  // reads the world position back out of, so the fragment works in world units.
  const geometry = new Geometry({
    attributes: { aPosition: [0, 0, 1, 0, 1, 1, 0, 1] },
    indexBuffer: [0, 1, 2, 0, 2, 3],
  });

  let maskRT = RenderTexture.create({ width: 4, height: 4 });
  const maskScene = new Container();
  const maskPaint = new Graphics();
  const fadePaint = new Container();
  maskScene.addChild(maskPaint, fadePaint);

  const shader = Shader.from({
    gl: { vertex: VERTEX, fragment: FRAGMENT },
    resources: {
      uMask: maskRT.source,
      fogUniforms: {
        uTime: { value: 0, type: 'f32' },
        uNoise: { value: 1 / NOISE_CELLS, type: 'f32' },
        uWarp: { value: EDGE_WARP, type: 'f32' },
        uDense: { value: look.dense, type: 'f32' },
        uMist: { value: look.mist, type: 'f32' },
        uRim: { value: look.rim, type: 'f32' },
        uMaskRect: { value: [0, 0, 0, 0], type: 'vec4<f32>' },
        uCoverRect: { value: [0, 0, 1, 1], type: 'vec4<f32>' },
        uDeep: { value: [...SMOKE.deep], type: 'vec3<f32>' },
        uMid: { value: [...SMOKE.mid], type: 'vec3<f32>' },
        uHigh: { value: [...SMOKE.high], type: 'vec3<f32>' },
      },
    },
  });
  const uniforms = shader.resources.fogUniforms.uniforms as {
    uTime: number;
    uMaskRect: Float32Array | number[];
    uCoverRect: Float32Array | number[];
    uDeep: Float32Array | number[];
    uMid: Float32Array | number[];
    uHigh: Float32Array | number[];
  };

  const mesh = new Mesh({ geometry, shader });
  mesh.eventMode = 'none';

  // Dev-only instruments, on `__testProbe`'s rationale: the mask texture is the one thing
  // a browser walk cannot read off the DOM, and every fog bug so far has been "which half
  // is wrong — the geometry or the texture".
  if (import.meta.env.DEV) {
    const dbg = ((window as Window & { __livingFog?: unknown[] }).__livingFog ??= []);
    dbg.push({ rt: () => maskRT, scene: maskScene, mesh });
  }

  let rect: { minX: number; minY: number; w: number; h: number } | null = null;
  let time = 0;

  const setVec = (target: Float32Array | number[], values: readonly number[]): void => {
    for (let i = 0; i < values.length; i++) target[i] = values[i];
  };

  return {
    mesh,
    maskPaint,
    fadePaint,
    setMaskBounds(bounds) {
      const w = bounds ? bounds.maxX - bounds.minX : 0;
      const h = bounds ? bounds.maxY - bounds.minY : 0;
      if (!bounds || w <= 0 || h <= 0 || Math.max(w, h) > COVERABLE_MAX) {
        rect = null;
        setVec(uniforms.uMaskRect, [0, 0, 0, 0]); // degenerate ⇒ maskAt answers hidden
        return;
      }
      rect = { minX: bounds.minX, minY: bounds.minY, w, h };
      const s = maskScale(w, h);
      const [tw, th] = [Math.ceil(w * s), Math.ceil(h * s)];
      if (maskRT.width !== tw || maskRT.height !== th) {
        // Resize in place rather than recreate: the shader's bind group holds the texture
        // *source*, and a fresh RenderTexture is a fresh source the bind does not follow.
        maskRT.resize(tw, th);
      }
      maskScene.scale.set(tw / w, th / h);
      maskScene.position.set(-bounds.minX * (tw / w), -bounds.minY * (th / h));
      setVec(uniforms.uMaskRect, [bounds.minX, bounds.minY, 1 / w, 1 / h]);
    },
    renderMask() {
      if (rect) engine.renderToTexture(maskScene, maskRT, true);
    },
    setPalette(palette) {
      setVec(uniforms.uDeep, palette.deep);
      setVec(uniforms.uMid, palette.mid);
      setVec(uniforms.uHigh, palette.high);
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
      maskRT.destroy(true);
      geometry.destroy();
      shader.destroy();
    },
  };
}
