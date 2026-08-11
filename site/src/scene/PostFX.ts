// Cheap single-pass grade: subtle bloom and a gentle vignette, combined in
// one fragment shader so the whole post chain is exactly one extra pass over
// the scene's own RenderPass — the art-brief perf guardrail rules out
// SSAO/bloom *chains*, not a single cheap pass. Grain is a full-viewport DOM
// .grain layer (see global.css), not this shader — a shader-space speckle is
// under one quantisation step at these resolutions and was invisible.
// This pass owns the whole transfer curve for the site: everything upstream of
// it renders into a linear HalfFloat target (see render/renderSplit below), so
// linearToSRGB() here is the one and only encode. Renderer tonemapping is
// deliberately unset (Canvas3D's onCreated) — three only applies it when the
// render target is null, which no path here ever is.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const GradeShader = {
  name: 'GradeShader',
  uniforms: {
    tDiffuse: { value: null },
    resolution: { value: new THREE.Vector2(1, 1) },
    bloomStrength: { value: 0.35 },
    // D2 art pass: SceneRenderer.tsx's NORMAL_BG is now the light parchment
    // field (#e8dfc6), which decodes to a linear R channel of ~0.807 (three's
    // ColorManagement sRGB→linear on the scene.background Color). At the old
    // threshold (0.72) that flat, uniform field exceeded it on every pixel —
    // the 8-tap ring below samples neighboring background pixels of the SAME
    // color, so a flat field blooms itself, adding a uniform warm haze over
    // the whole page rather than "bloom on torch emitters". Raised past the
    // field's own linear value (with margin) so only genuinely bright
    // things — torch-hot additive glow, ACES-saturated highlights — still
    // cross it.
    bloomThreshold: { value: 0.85 },
    vignetteStrength: { value: 0.35 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float bloomStrength;
    uniform float bloomThreshold;
    uniform float vignetteStrength;
    varying vec2 vUv;

    // EffectComposer renders the scene into an offscreen target, which three.js
    // never sRGB-encodes (that only happens for the default framebuffer) — so
    // tDiffuse arrives here still linear. This is the last pass (composer
    // writes straight to the canvas), so this shader is the only place left to
    // do that encode; skipping it was crushing every mid/low tone toward black
    // while leaving pure white/black (the curve's fixed points) untouched —
    // exactly the "floor reads near-void" symptom. Matches three's own
    // sRGBTransferOETF (colorspace_pars_fragment.glsl.js) so the grade matches
    // what a plain (non-composited) render would have produced.
    vec3 linearToSRGB(vec3 value) {
      return mix(pow(value, vec3(0.41666)) * 1.055 - vec3(0.055), value * 12.92, vec3(lessThanEqual(value, vec3(0.0031308))));
    }

    void main() {
      vec4 base = texture2D(tDiffuse, vUv);

      // Poor-man's bloom: one fixed 8-tap ring, no downsample/blur mip
      // chain. Torch-hot pixels are the only thing usually past
      // bloomThreshold, so this reads as "bloom on the torch emitters".
      vec2 texel = 1.0 / resolution;
      vec3 bloom = vec3(0.0);
      for (int i = 0; i < 8; i++) {
        float a = float(i) * 0.7853981634; // 2*PI/8
        vec2 offset = vec2(cos(a), sin(a)) * texel * 3.0;
        vec3 c = texture2D(tDiffuse, vUv + offset).rgb;
        bloom += max(c - bloomThreshold, 0.0);
      }
      bloom *= 0.125;
      vec3 color = base.rgb + bloom * bloomStrength;

      vec2 centered = vUv - 0.5;
      float vignette = 1.0 - dot(centered, centered) * vignetteStrength;
      color *= clamp(vignette, 0.0, 1.0);

      vec3 encoded = linearToSRGB(clamp(color, 0.0, 1.0));

      gl_FragColor = vec4(clamp(encoded, 0.0, 1.0), base.a);
    }
  `,
};

export interface PostFX {
  /** Renders the graded frame — call instead of gl.render(scene, camera). */
  render(delta: number): void;
  /**
   * Same grade, but `draw` supplies the scene render itself — beat 4's two
   * scissored gl.render calls (SceneRenderer.tsx). It runs with the composer's
   * OWN linear target bound, so transparent content blends in linear space and
   * the single grade pass below does the linear→sRGB encode once, at the end,
   * exactly as on the normal path. Drawing straight to the canvas instead made
   * three sRGB-encode each fragment BEFORE fixed-function blending, which
   * darkened every transparent thing in the frame (~30 sRGB levels in the
   * shadows) and popped visibly at both of this beat's boundaries.
   *
   * `draw` gets a `pane(x, y, w, h)` to crop each render to — call it INSTEAD
   * of renderer.setViewport/setScissor. Renderer-level viewport state is only
   * honoured while the target is null: with one bound, every internal re-bind
   * (each light's shadow pass does one per gl.render) restores the viewport
   * from the target's own rect, so a renderer-level half-viewport silently
   * became a full one — the pane's crop stretched to 2x across the frame.
   * These are device pixels, matching the target, with no pixel-ratio scaling.
   *
   * `clearColor` paints the full-frame clear (i.e. whatever `draw`'s pane
   * rects don't cover — the inter-pane gap) opaque in that colour. It MUST be
   * set here, after the target is bound, not by the caller beforehand: three's
   * setClearColor converts through the CURRENTLY bound target's colorspace at
   * call time (getUnlitUniformColorSpace), so a caller-side set — issued while
   * the canvas is still bound — bakes sRGB components into this linear target
   * and the grade pass encodes them a second time (measured: #3a2717 came out
   * #836955, a pale stripe brighter than the wood on both sides — W4).
   */
  renderSplit(
    draw: (pane: (x: number, y: number, w: number, h: number) => void) => void,
    delta: number,
    clearColor?: THREE.Color
  ): void;
}

const _size = new THREE.Vector2();
const _prevClearColor = new THREE.Color();

export function createPostFX(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): PostFX {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const gradePass = new ShaderPass(GradeShader);
  composer.addPass(gradePass);

  let lastW = -1;
  let lastH = -1;
  let lastRatio = -1;
  // composer.setSize takes logical pixels and applies a pixel ratio itself —
  // but the ratio it applies is CAPTURED at construction and only updated by
  // composer.setPixelRatio, so a runtime dpr change (page zoom, dragging the
  // window between monitors, display-scaling change) must resync the ratio
  // too or the targets silently stop matching the drawing buffer (W2 fix
  // round — the grade pass then rescales a mis-sized frame). Guarded on
  // (w, h, ratio), with setPixelRatio pushed before setSize.
  function syncSize() {
    const size = renderer.getSize(_size);
    const ratio = renderer.getPixelRatio();
    if (size.width === lastW && size.height === lastH && ratio === lastRatio) return;
    lastW = size.width;
    lastH = size.height;
    lastRatio = ratio;
    composer.setPixelRatio(ratio);
    composer.setSize(lastW, lastH);
    gradePass.uniforms.resolution.value.set(lastW * ratio, lastH * ratio);
  }

  return {
    render(delta) {
      syncSize();
      composer.render(delta);
    },
    renderSplit(draw, delta, clearColor) {
      syncSize();
      // One of the composer's own two HalfFloat targets — same size and
      // format as the buffer RenderPass uses, so the grade pass reads the
      // same colorspace from the same kind of place. WHICH of the two it is
      // alternates between composer frames (RenderPass.needsSwap is false,
      // so composer.render() swaps exactly once), and that's fine: this
      // path writes and reads the same one within a single call (W5).
      const target = composer.readBuffer;
      const full = () => {
        target.viewport.set(0, 0, target.width, target.height);
        target.scissor.set(0, 0, target.width, target.height);
        target.scissorTest = false;
      };
      full();
      renderer.setRenderTarget(target);
      if (clearColor) {
        // Set while the target is bound so three bakes the colour's LINEAR
        // components (see the interface comment — set before binding, it
        // bakes sRGB and the grade pass double-encodes).
        renderer.getClearColor(_prevClearColor);
        const prevClearAlpha = renderer.getClearAlpha();
        renderer.setClearColor(clearColor, 1);
        renderer.clear();
        renderer.setClearColor(_prevClearColor, prevClearAlpha);
      } else {
        renderer.clear();
      }
      draw((x, y, w, h) => {
        target.viewport.set(x, y, w, h);
        target.scissor.set(x, y, w, h);
        target.scissorTest = true;
        // Re-binding is what applies the rect — and what every internal
        // re-bind inside gl.render then restores it from.
        renderer.setRenderTarget(target);
      });
      // Hand the target back to the normal composer path unscissored.
      full();
      renderer.setRenderTarget(null);
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, lastW, lastH);
      gradePass.renderToScreen = true;
      // writeBuffer is unused when renderToScreen is set; pass the target
      // twice rather than a null the addon types don't accept.
      gradePass.render(renderer, target, target, delta, false);
    },
  };
}
