// D2's ring invariant, checked without a live GL context.
//
// The test lane's `renderToTexture` is a stub (see FogOverlay.test.ts/FogRenderer.test.ts —
// "the Pixi mount itself needs WebGL, so the browser gate owns 'does it look right'") and
// this repo has no headless-GL package, so there is no way to compile FRAGMENT and read real
// pixels back here. What follows is a *hand-written scalar mirror* of the shader's alpha
// math — every line below is a 1:1 port of the corresponding GLSL line in `livingFog.ts`'s
// FRAGMENT (main(), from "float mFog = ..." to the final gl_FragColor's alpha channel) — not
// a re-derivation. If that block of the shader changes, this mirror has to change with it or
// it is testing nothing.
//
// What it proves: the seam gate (D2) that replaced the flat `alpha *= 1 - smoothstep(0.5,
// 0.95, m)` is monotonic in `m` for any fixed cloud density, so it can fade but never ring —
// the exact failure PR #114's fix (5e3ce63, 7e48810) was for.
import { describe, expect, it } from 'vitest';

/** Mirrors GLSL's smoothstep exactly (the built-in's own definition). */
const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

interface SeamLook {
  fade: number;
  seamLobe: number;
  veil: number;
  dense: number;
  mist: number;
}

const PLAYER_LOOK: SeamLook = { fade: 2.5, seamLobe: 0.12, veil: 0.18, dense: 1, mist: 0.62 };

/**
 * The scalar mirror. `m` is the tier mask (0 hidden / 0.5 memory / 1 live, continuous through
 * the mask's own blur); `den` and `top` stand in for the layer stack's density and the third
 * layer's own noise — driven directly here rather than through the noise functions, since
 * the seam's monotonicity claim is about the alpha math alone, not about what the clouds
 * happen to roll on any given frame.
 *
 * Mirrors livingFog.ts FRAGMENT lines (as of this port): mFog, d, body, wisp, rim's hiddenness
 * reuse, aBody, alpha, seam/seamA/seamB/seamGate, veil, and the final clamp — rim's own colour
 * mix and the layer loop are colour-only and do not affect alpha, so they are left out.
 *
 * Returned in parts rather than pre-combined: `cloud` is the seam-gated body/wisp term D2 is
 * actually about, `veil` is item 6's separate live-sight floor (deliberately *rising* toward
 * live sight — "the fog never fully leaves, it thins"), and the shader's own alpha is
 * `clamp(max(cloud, veil), 0, 1)`. A falling curve maxed with a rising one can dip and then
 * follow the riser back up — that is a valley immediately absorbed into the intended veil
 * ramp, not a ring (a ring is a *local peak* — more cover in the middle than on both sides —
 * which the seam gate alone, tested below, is what has to stay clear of).
 */
function mirrorParts(
  m: number,
  den: number,
  top: number,
  look: SeamLook,
): { cloud: number; veil: number } {
  const { fade, seamLobe, veil, dense, mist } = look;
  const mFog = Math.min(m, 0.5) * 2.0;
  const d = den - (mFog * 0.85 - 0.42) + (top - 0.5) * 0.1;
  const body = smoothstep(-0.08 * fade, 0.14 * fade, d);
  const wisp = smoothstep(-0.2 * fade, -0.06 * fade, d) * (1 - body);
  const hiddenness = 1 - smoothstep(0.1, 0.62, m);
  const aBody = mist * (0.45 + 0.55 * den) * (1 - hiddenness) + dense * hiddenness;
  const cloudAlpha = body * aBody + wisp * aBody * 0.28;
  const seam = m + (den - 0.5) * seamLobe;
  const seamA = 1.0 - 0.5 * Math.min(1, Math.max(0.2, fade / 2.5));
  const seamB = 1.0 - 0.001;
  const seamGate = 1 - smoothstep(seamA, seamB, seam);
  const vl = veil * smoothstep(0.35, 0.95, den) * smoothstep(0.55, 1.0, m);
  return { cloud: cloudAlpha * seamGate, veil: vl };
}

/** The shader's actual output alpha: `clamp(max(cloud, veil), 0, 1)`. */
const mirrorAlpha = (m: number, den: number, top: number, look: SeamLook): number => {
  const { cloud, veil } = mirrorParts(m, den, top, look);
  const cover = Math.min(1, Math.max(cloud, veil));
  // The hidden floor, the shader's last line before output: m = 0 is uDense whatever else.
  return Math.max(cover, look.dense * (1 - smoothstep(0, 0.1, m)));
};

describe('living fog seam (D2, mirrors livingFog.ts FRAGMENT by hand)', () => {
  it('renders hidden ground at exactly alpha 1 (255) regardless of cloud density or fade width', () => {
    // fade sweeps the whole range the look dial will offer (1..4): past ~2.6 the body ramp no
    // longer saturates over a thin cloud, and only the hidden floor keeps the promise.
    for (let fade = 1; fade <= 4; fade += 0.5) {
      for (let den = 0; den <= 1; den += 0.1) {
        for (let top = 0; top <= 1; top += 0.5) {
          expect(mirrorAlpha(0, den, top, { ...PLAYER_LOOK, fade })).toBe(1);
        }
      }
    }
  });

  it('never rings: the seam-gated cloud term is monotone non-increasing from memory (m=0.5) to live (m=1) for any fixed cloud column', () => {
    // den/top held fixed per "column" — the physical picture is a world point whose local
    // cloud density does not jump as the mask's blur carries m from 0.5 up to 1 over it. This
    // is the term D2's wobbled seam is actually about — the veil (item 6) is checked
    // separately below, since it is a deliberately rising floor, not part of the seam.
    for (let den = 0; den <= 1; den += 0.05) {
      for (let top = 0; top <= 1; top += 0.25) {
        let prev = Infinity;
        for (let m = 0.5; m <= 1.0001; m += 0.01) {
          const { cloud } = mirrorParts(m, den, top, PLAYER_LOOK);
          expect(cloud).toBeLessThanOrEqual(prev + 1e-9);
          prev = cloud;
        }
      }
    }
  });

  it('the live-sight veil only ever rises toward live sight, by design (item 6) — never a source of a ring', () => {
    for (let den = 0; den <= 1; den += 0.1) {
      let prev = -Infinity;
      for (let m = 0.5; m <= 1.0001; m += 0.01) {
        const { veil } = mirrorParts(m, den, 0.5, PLAYER_LOOK);
        expect(veil).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = veil;
      }
    }
  });

  it('keeps live-sight alpha (m=1) at or under the veil ceiling', () => {
    for (let den = 0; den <= 1; den += 0.02) {
      for (let top = 0; top <= 1; top += 0.25) {
        expect(mirrorAlpha(1, den, top, PLAYER_LOOK)).toBeLessThanOrEqual(PLAYER_LOOK.veil + 1e-6);
      }
    }
  });

  it('widens the seam ramp as uFade grows, never the reverse', () => {
    const seamAOf = (fade: number) => 1.0 - 0.5 * Math.min(1, Math.max(0.2, fade / 2.5));
    const widths = [1, 1.5, 2, 2.5, 3, 4].map((fade) => (1 - 0.001) - seamAOf(fade));
    for (let i = 1; i < widths.length; i++) expect(widths[i]).toBeGreaterThanOrEqual(widths[i - 1]);
  });
});
