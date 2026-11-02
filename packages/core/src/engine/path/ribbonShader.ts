// The one shader every textured ribbon draws with: path strips, their edge strips, and the
// floor border strips. It samples a strip texture at (U, V) — U is arc length in cells, so
// the art tiles along the ribbon and never stretches — and shapes the alpha: a soft edge
// across V, fades over the ends' arc length, a round soft cap past a cut end, and, for a
// junction group, the group's shared feathered mask instead of its own edge.

import { Geometry, Mesh, Shader, Texture, type TextureSource } from 'pixi.js';
import type { RibbonMesh } from '../../geometry/ribbon';

export const RIBBON_VERTEX_SRC = `
  in vec2 aPosition;
  in vec2 aUV;
  in vec2 aExtra;
  out vec2 vUV;
  out vec2 vExtra;
  out vec2 vWorld;
  uniform mat3 uProjectionMatrix;
  uniform mat3 uWorldTransformMatrix;
  uniform mat3 uTransformMatrix;
  void main() {
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
    vUV = aUV;
    vExtra = aExtra;
    vWorld = aPosition;
  }
`;

/**
 * vUV: U = arc + offset (cells), V across 0..1. vExtra: arc length (cells), local width.
 * Textures are premultiplied, so the whole colour scales with the alpha.
 */
export const RIBBON_FRAGMENT_SRC = `
  in vec2 vUV;
  in vec2 vExtra;
  in vec2 vWorld;
  out vec4 finalColor;
  uniform sampler2D uStrip;
  uniform sampler2D uMask;
  uniform vec4 uFrame;
  uniform float uStripLen;
  uniform vec4 uTint;
  uniform vec4 uEnds;
  uniform vec2 uEdge;
  uniform float uFlip;
  uniform float uWater;
  uniform float uMasked;
  uniform vec4 uMaskRect;
  uniform vec4 uColor;
  uniform vec4 uWorldColorAlpha;

  void main() {
    float v = clamp(vUV.y, 0.0, 1.0);
    float sv = uFlip > 0.5 ? 1.0 - v : v;
    float u = fract(vUV.x / uStripLen);
    vec4 c = texture(uStrip, uFrame.xy + vec2(u, sv) * uFrame.zw);

    float arc = vExtra.x;
    float width = max(vExtra.y, 0.001);
    float a = 1.0;
    if (uMasked > 0.5) {
      vec2 m = (vWorld - uMaskRect.xy) / uMaskRect.zw;
      a *= smoothstep(0.5, 1.0, texture(uMask, m).r);
    } else if (uEdge.x > 0.5) {
      // Distance in from the nearer edge, cells; past a cut end, in from the cap's arc.
      float d = min(v, 1.0 - v) * width;
      float along = arc < 0.0 ? -arc : (arc > uEnds.w ? arc - uEnds.w : 0.0);
      if (along > 0.0) d = width * 0.5 - length(vec2(along, (v - 0.5) * width));
      a *= smoothstep(0.0, uEdge.y, d);
    }
    if (uEnds.x > 0.5) a *= smoothstep(0.0, uEnds.z, arc);
    if (uEnds.y > 0.5) a *= smoothstep(0.0, uEnds.z, uEnds.w - arc);

    vec3 rgb = c.rgb * uTint.rgb;
    // Water: shallow at the banks, deep down the middle.
    if (uWater > 0.5) rgb *= mix(1.0, 0.68, 1.0 - abs(v - 0.5) * 2.0);
    finalColor = vec4(rgb, c.a) * (a * uTint.a) * uColor * uWorldColorAlpha;
  }
`;

export interface RibbonLook {
  /** The strip's length along U, cells (its grid width). */
  stripLength: number;
  /** Multiplied into the art, 0xRRGGBB. */
  tint: number;
  opacity: number;
  soft: boolean;
  /** Soft edge width, cells. */
  edgeWidth: number;
  fadeStart: boolean;
  fadeEnd: boolean;
  /** Fade length, cells. */
  fadeLength: number;
  /** The ribbon's whole arc length, cells. */
  length: number;
  flip: boolean;
  water: boolean;
  /** A junction group's mask and its world rect; absent = the ribbon's own edge. */
  mask?: { source: TextureSource; rect: { x: number; y: number; width: number; height: number } };
}

export const DEFAULT_EDGE_WIDTH = 0.15;

/** The liquid tone across a ribbon (V 0..1): 1 at the banks, 0.68 down the middle. The shader's own curve. */
export function liquidShade(v: number): number {
  const deep = 1 - Math.abs(v - 0.5) * 2;
  return 1 + (0.68 - 1) * deep;
}

/** The uniform values a look sets, in the shader's own names and layouts. */
export function ribbonUniforms(look: RibbonLook, frame: { x: number; y: number; width: number; height: number }) {
  const r = ((look.tint >> 16) & 0xff) / 255;
  const g = ((look.tint >> 8) & 0xff) / 255;
  const b = (look.tint & 0xff) / 255;
  return {
    uFrame: new Float32Array([frame.x, frame.y, frame.width, frame.height]),
    uStripLen: Math.max(look.stripLength, 1e-3),
    uTint: new Float32Array([r, g, b, look.opacity]),
    uEnds: new Float32Array([look.fadeStart ? 1 : 0, look.fadeEnd ? 1 : 0, Math.max(look.fadeLength, 1e-3), look.length]),
    uEdge: new Float32Array([look.soft ? 1 : 0, Math.max(look.edgeWidth, 1e-3)]),
    uFlip: look.flip ? 1 : 0,
    uWater: look.water ? 1 : 0,
    uMasked: look.mask ? 1 : 0,
    uMaskRect: look.mask
      ? new Float32Array([look.mask.rect.x, look.mask.rect.y, look.mask.rect.width, look.mask.rect.height])
      : new Float32Array([0, 0, 1, 1]),
  };
}

/** A texture's frame inside its source, normalised: what `uFrame` takes. */
export function sourceFrame(texture: Texture): { x: number; y: number; width: number; height: number } {
  const w = texture.source.width || 1;
  const h = texture.source.height || 1;
  const f = texture.frame;
  return { x: f.x / w, y: f.y / h, width: f.width / w, height: f.height / h };
}

/** Interleaves arc and width per vertex: the shader's `aExtra`. */
function extraOf(mesh: RibbonMesh): Float32Array {
  const n = mesh.arc.length;
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    out[i * 2] = mesh.arc[i];
    out[i * 2 + 1] = mesh.width[i];
  }
  return out;
}

const UNIFORM_TYPES: Record<string, string> = {
  uFrame: 'vec4<f32>',
  uStripLen: 'f32',
  uTint: 'vec4<f32>',
  uEnds: 'vec4<f32>',
  uEdge: 'vec2<f32>',
  uFlip: 'f32',
  uWater: 'f32',
  uMasked: 'f32',
  uMaskRect: 'vec4<f32>',
};

/** A Pixi mesh drawing `mesh` with `texture` as its strip. Null for an empty ribbon. */
export function ribbonMeshObject(mesh: RibbonMesh, texture: Texture, look: RibbonLook): Mesh<Geometry, Shader> | null {
  if (mesh.indices.length === 0) return null;
  const geometry = new Geometry({
    attributes: {
      aPosition: { buffer: mesh.positions, format: 'float32x2' },
      aUV: { buffer: mesh.uvs, format: 'float32x2' },
      aExtra: { buffer: extraOf(mesh), format: 'float32x2' },
    },
    indexBuffer: mesh.indices,
  });
  const values = ribbonUniforms(look, sourceFrame(texture));
  const group: Record<string, { value: unknown; type: string }> = {};
  for (const [k, v] of Object.entries(values)) group[k] = { value: v, type: UNIFORM_TYPES[k] };
  const shader = Shader.from({
    gl: { vertex: RIBBON_VERTEX_SRC, fragment: RIBBON_FRAGMENT_SRC },
    resources: {
      ribbonUniforms: group,
      uStrip: texture.source,
      uMask: look.mask?.source ?? Texture.WHITE.source,
    },
  });
  return new Mesh({ geometry, shader });
}
