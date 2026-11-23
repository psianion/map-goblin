// A soft piece's natural edge. A ground piece with a soft edge blends into what is under it
// the way the Terrain brush's paint does: not fading in even steps, but breaking up along the
// texture's own detail, its bright texels coming through first.
//
// The piece gets an edge mask, a small texture holding a ramp from 0 at its outline to 1
// `soft` cells inside, worked out from each texel's distance to the outline (softMask.ts), so
// it rises smoothly however wide the edge. A mesh over the piece samples the tiling texture
// at each pixel's world position and the mask, and shapes the ramp by the texture's luminance
// with the terrain shader's `ragged` formula. The mask is kept per piece and worked out again
// only when its outline, softness or fades change, since the layer is rebuilt on every step
// of a drag; a piece only moved keeps its mask, laid where it now is.
//
// A piece's fades (soft erases, shared/pieceFades.ts) go into the same mask in a channel of
// their own: the edge ramp is red, what the fades leave is green (1 with none), each fade
// multiplying it by what it leaves, eased across its feather. The shader shapes the edge by
// `ragged` and multiplies the fades in plainly after it, so an erase reads as a true
// gradient: half strength covers half, the feather falls off smoothly from rim to core. A
// crisp piece with fades has its edge channel full, and is cut to its outline the way a
// crisp fill is, so its edge stays as sharp.
//
// The engine's other fades (rampMask.ts) are drawn here too, by `paintRamp`: the same mesh
// over the same kind of mask, its ramp read as it is, with no luminance.
//
// Without GL (a test, a lost context) the texture is tiled as a floor is and masked by a sprite
// of the same ramp, and a piece's fades are not drawn.

import { BufferImageSource, Container, Graphics, Mesh, MeshGeometry, RenderTexture, Shader, Sprite, Texture } from 'pixi.js';
import type { Polygon } from '../types/geometry';
import type { PieceFade } from '../store/types';
import type { RenderEngine } from './RenderEngine';
import { fillPolygonsWithHoles, paintTiled, type TiledLook } from './floorWallRenderer';
import { maskGridFor, movedBy, softMaskPixels, type MaskGrid } from './softMask';
import type { Ramp, RampField } from './rampMask';

/**
 * Mask texels per cell, at most. A distance ramp is smooth, so it filters up cleanly; at this
 * a 20-cell piece with five fades is worked out in a few milliseconds, inside a drag's frame.
 */
const MASK_TEXELS_PER_CELL = 16;
/** The mask's largest side, texels: a piece wider than this many cells gets a coarser ramp. */
const MASK_MAX_DIM = 1024;
/** The mask reaches this far past the outline, cells, so the edge texels filter down to nothing. */
const MASK_PAD = 0.25;
/** Texture pixels per cell at tile scale 1, as `paintTiled` lays them. */
const PX_PER_GRID_CELL = 200;

const VERTEX = `
  in vec2 aPosition;
  out vec2 vWorld;
  uniform mat3 uProjectionMatrix;
  uniform mat3 uWorldTransformMatrix;
  uniform mat3 uTransformMatrix;
  void main() {
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
    vWorld = aPosition;
  }
`;

// The alpha is the terrain shader's: a ramp steepest at nothing, then `ragged`, which lets
// the bright texels through first. Full inside for any texel, nothing at the outline. Then
// times the fades' channel as it is: no luminance, no curve. A plain ramp (`uPlain`) is the
// edge channel as it is.
const FRAGMENT = `
  in vec2 vWorld;
  out vec4 finalColor;
  uniform sampler2D uTexture;
  uniform sampler2D uMask;
  uniform vec4 uMaskRect;
  uniform vec4 uTile;
  uniform float uRot;
  uniform float uPlain;
  uniform vec4 uColor;
  uniform vec4 uWorldColorAlpha;

  float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec4 mask = texture(uMask, (vWorld - uMaskRect.xy) / uMaskRect.zw);
    float edge = mask.r;
    float fade = mask.g;
    if (edge < 0.004 || fade < 0.004) {
      finalColor = vec4(0.0);
      return;
    }
    vec2 p = vWorld - uTile.zw;
    float c = cos(uRot);
    float s = sin(uRot);
    vec2 q = vec2(c * p.x + s * p.y, c * p.y - s * p.x);
    vec3 col = texture(uTexture, fract(q / uTile.xy)).rgb;
    float r = 1.0 - min(edge, 1.0);
    float ramp = 1.0 - r * r;
    float ragged = clamp((ramp - (1.0 - lum(col)) * 0.5) * 2.0, 0.0, 1.0);
    float a = mix(ragged, min(edge, 1.0), uPlain) * min(fade, 1.0);
    finalColor = vec4(col * a, a) * uColor * uWorldColorAlpha;
  }
`;

let engine: RenderEngine | null = null;
/** Bumped when the GL context comes back: every mask and tile drawn before is gone. */
let generation = 0;

/** The engine the masks are rendered with; null (the default, and in tests) paints soft pieces in steps. */
export function setSoftPieceEngine(next: RenderEngine | null, onRestored?: () => void): void {
  engine = next;
  dropAllSoftMasks();
  if (!next) return;
  try {
    next.canvas().addEventListener('webglcontextrestored', () => {
      generation++;
      dropAllSoftMasks();
      onRestored?.();
    });
  } catch {
    // No canvas yet: nothing to listen on, and nothing drawn to lose.
  }
}

/** Whether a piece's mask can be drawn now: false paints it through a sprite mask, with no fades. */
export function softPieceReady(): boolean {
  return glReady();
}

function glReady(): boolean {
  if (!engine) return false;
  try {
    const gl = (engine.renderer() as unknown as { gl?: { isContextLost?: () => boolean } }).gl;
    return !gl?.isContextLost?.();
  } catch {
    return false;
  }
}

interface MaskEntry {
  /** What the outline is made from, as stored: a new contours, tangents or transform means a new outline. */
  shape: readonly unknown[];
  soft: number;
  generation: number;
  /** The outline and fades the mask was worked out for, to tell a piece only moved. */
  outline: Polygon[];
  fades: readonly PieceFade[];
  texture: Texture;
  rect: { x: number; y: number; w: number; h: number };
}

/** Per layer, per piece id. */
const masks = new Map<string, Map<string, MaskEntry>>();

/** A texture's one tile on a target of its own, so the shader can wrap it; kept per texture. */
const tiles = new Map<Texture, { rt: RenderTexture; generation: number }>();

function tileOf(texture: Texture): RenderTexture {
  const hit = tiles.get(texture);
  if (hit && hit.generation === generation && !hit.rt.destroyed) return hit.rt;
  hit?.rt.destroy(true);
  const rt = RenderTexture.create({ width: Math.max(1, Math.round(texture.width)), height: Math.max(1, Math.round(texture.height)), resolution: 1 });
  const sprite = new Sprite(texture);
  sprite.width = rt.width;
  sprite.height = rt.height;
  const holder = new Container();
  holder.addChild(sprite);
  engine!.renderToTexture(holder, rt, true);
  holder.destroy({ children: true });
  tiles.set(texture, { rt, generation });
  return rt;
}

/**
 * Works out a piece's mask (softMask.ts) and uploads it: its edge ramp in red (full throughout
 * with no `soft`), what its fades leave in green, filtered linearly and clamped at its sides.
 */
function buildMask(outline: Polygon[], soft: number, fades: readonly PieceFade[]): Pick<MaskEntry, 'texture' | 'rect'> | null {
  const grid = maskGridFor(outline, MASK_PAD, MASK_TEXELS_PER_CELL, MASK_MAX_DIM);
  if (!grid) return null;
  return { texture: texelTexture(softMaskPixels(outline, soft, fades, grid), grid, false), rect: rectOf(grid) };
}

/** RGBA bytes on `grid` as a texture filtered linearly and clamped at its sides; `premultiplied` for a sprite's own colour. */
function texelTexture(pixels: Uint8Array, grid: MaskGrid, premultiplied: boolean): Texture {
  const source = new BufferImageSource({
    resource: pixels,
    width: grid.width,
    height: grid.height,
    format: 'rgba8unorm',
    alphaMode: premultiplied ? 'premultiplied-alpha' : 'no-premultiply-alpha',
    scaleMode: 'linear',
    addressMode: 'clamp-to-edge',
    autoGenerateMipmaps: false,
  });
  return new Texture({ source });
}

/** The box a grid covers, cells. */
function rectOf(grid: MaskGrid): { x: number; y: number; w: number; h: number } {
  return { x: grid.x, y: grid.y, w: grid.width / grid.res, h: grid.height / grid.res };
}

function maskFor(layerId: string, pieceId: string, shape: readonly unknown[], outline: Polygon[], soft: number, fades: readonly PieceFade[]): MaskEntry | null {
  let byPiece = masks.get(layerId);
  if (!byPiece) masks.set(layerId, (byPiece = new Map()));
  const hit = byPiece.get(pieceId);
  const live = hit && hit.generation === generation && !hit.texture.destroyed;
  if (live && hit.shape.length === shape.length && hit.shape.every((v, i) => v === shape[i]) && hit.soft === soft) return hit;
  // Only moved (a drag): the same mask, laid where the piece now is.
  const moved = live && hit.soft === soft ? movedBy(hit, { outline, fades }) : null;
  if (hit && moved) {
    const entry: MaskEntry = { ...hit, shape, outline, fades, rect: { ...hit.rect, x: hit.rect.x + moved[0], y: hit.rect.y + moved[1] } };
    byPiece.set(pieceId, entry);
    return entry;
  }
  hit?.texture.destroy(true);
  byPiece.delete(pieceId);
  const built = buildMask(outline, soft, fades);
  if (!built) return null;
  const entry: MaskEntry = { shape, soft, generation, outline, fades, ...built };
  byPiece.set(pieceId, entry);
  return entry;
}

/** Lets go of the masks of pieces no longer soft or no longer on the layer. Called once a rebuild has drawn its pieces. */
export function pruneSoftMasks(layerId: string, drawn: ReadonlySet<string>): void {
  const byPiece = masks.get(layerId);
  if (!byPiece) return;
  for (const [id, entry] of byPiece) {
    if (drawn.has(id)) continue;
    entry.texture.destroy(true);
    byPiece.delete(id);
  }
  if (byPiece.size === 0) masks.delete(layerId);
}

/** A removed layer's masks. */
export function dropSoftMasks(layerId: string): void {
  pruneSoftMasks(layerId, new Set());
}

function dropAllSoftMasks(): void {
  for (const id of [...masks.keys()]) dropSoftMasks(id);
  for (const t of tiles.values()) t.rt.destroy(true);
  tiles.clear();
}

/** The piece a soft fill is drawn for: where its mask is kept. */
export interface SoftPieceKey {
  layerId: string;
  pieceId: string;
  /** The piece's stored contours, tangents, transform and fades, by identity. */
  shape: readonly unknown[];
}

/**
 * Paints `texture` over `outline` (Clipper rings: outers one way, holes the other) with a
 * natural soft edge `soft` cells wide and `fades` (in the outline's space) faded out, laid as
 * `look` lays a floor's. True when the mesh drew it; false when it fell back to a fill masked
 * by a sprite of its edge's ramp, or a crisp fill with no soft edge, without the fades (no GL).
 */
export function paintSoftPiece(
  parent: Container,
  key: SoftPieceKey,
  outline: Polygon[],
  texture: Texture,
  look: TiledLook,
  soft: number,
  fades: readonly PieceFade[] = [],
): boolean {
  const fallback = () => {
    const grid = soft > 0 ? maskGridFor(outline, MASK_PAD, MASK_TEXELS_PER_CELL, MASK_MAX_DIM) : null;
    if (grid) maskedBySprite(parent, outline, texelTexture(softMaskPixels(outline, soft, [], grid), grid, false), grid, texture, look);
    else paintTiled(parent, outline, texture, { ...look, holes: true });
  };
  if (!glReady()) {
    fallback();
    return false;
  }
  let mask: MaskEntry | null;
  let tile: RenderTexture;
  try {
    mask = maskFor(key.layerId, key.pieceId, key.shape, outline, soft, fades);
    tile = tileOf(texture);
  } catch (err) {
    console.warn('[softPiece] edge mask failed, masking by sprite:', err);
    fallback();
    return false;
  }
  if (!mask) return true;
  const mesh = maskedMesh(mask.texture, mask.rect, tile, texture, look, false);
  mesh.label = 'piece-soft';
  if (soft > 0) {
    parent.addChild(mesh);
    return true;
  }
  // Crisp, with fades: cut to the outline as `paintTiled` cuts a crisp fill, not by the mask.
  clipped(parent, outline, mesh);
  return true;
}

/**
 * A mesh over `rect` (cells) that tiles `texture` (its tile on a target of its own, `tile`) as
 * `look` lays a floor's and shows it through `mask`: shaped by the texture's luminance, or with
 * `plain`, by the mask's ramp as it is.
 */
function maskedMesh(mask: Texture, rect: { x: number; y: number; w: number; h: number }, tile: RenderTexture, texture: Texture, look: TiledLook, plain: boolean): Mesh<MeshGeometry, Shader> {
  const { x, y, w, h } = rect;
  const geometry = new MeshGeometry({
    positions: new Float32Array([x, y, x + w, y, x + w, y + h, x, y + h]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  });
  const scale = look.scale / PX_PER_GRID_CELL;
  const shader = Shader.from({
    gl: { vertex: VERTEX, fragment: FRAGMENT },
    resources: {
      softUniforms: {
        uMaskRect: { value: new Float32Array([x, y, w, h]), type: 'vec4<f32>' },
        uTile: { value: new Float32Array([texture.width * scale, texture.height * scale, look.offsetX ?? 0, look.offsetY ?? 0]), type: 'vec4<f32>' },
        uRot: { value: look.rotation ?? 0, type: 'f32' },
        uPlain: { value: plain ? 1 : 0, type: 'f32' },
      },
      uTexture: tile.source,
      uMask: mask.source,
    },
  });
  const mesh = new Mesh({ geometry, shader });
  if (look.tint !== undefined) mesh.tint = look.tint;
  if (look.alpha !== undefined) mesh.alpha = look.alpha;
  mesh.once('destroyed', () => {
    geometry.destroy();
    shader.destroy();
  });
  return mesh;
}

/** `child` into `parent`, cut to `rings` (Clipper rings: holes cut out) by a crisp mask. */
function clipped(parent: Container, rings: Polygon[], child: Container): void {
  const cut = new Graphics();
  fillPolygonsWithHoles(cut, rings, { color: 0xffffff });
  const holder = new Container();
  holder.addChild(child);
  holder.addChild(cut);
  holder.mask = cut;
  parent.addChild(holder);
}

/** `texture` tiled over `rings` as `look` lays a floor, shown through a sprite of `mask` (its ramp in red) laid over `grid`. */
function maskedBySprite(parent: Container, rings: Polygon[], mask: Texture, grid: MaskGrid, texture: Texture, look: TiledLook): void {
  const holder = new Container();
  paintTiled(holder, rings, texture, { ...look, holes: true });
  const sprite = new Sprite(mask);
  sprite.position.set(grid.x, grid.y);
  sprite.scale.set(1 / grid.res);
  sprite.once('destroyed', () => mask.destroy(true));
  holder.addChild(sprite);
  holder.mask = sprite;
  parent.addChild(holder);
}

/** A ramp's field as mask texels: its opacity in red (the edge channel, blue the same), green full (nothing faded), alpha full. */
function rampPixels(field: RampField): Uint8Array {
  const out = new Uint8Array(field.alpha.length * 4);
  for (let k = 0; k < field.alpha.length; k++) {
    const v = Math.round(255 * field.alpha[k]);
    out[k * 4] = v;
    out[k * 4 + 1] = 255;
    out[k * 4 + 2] = v;
    out[k * 4 + 3] = 255;
  }
  return out;
}

/** A ramp's field as a sprite's own texels: white, premultiplied by its opacity. */
function colorPixels(field: RampField): Uint8Array {
  const out = new Uint8Array(field.alpha.length * 4);
  for (let k = 0; k < field.alpha.length; k++) out.fill(Math.round(255 * field.alpha[k]), k * 4, k * 4 + 4);
  return out;
}

/** The box a grid covers, as a ring. */
function boxRing(grid: MaskGrid): Polygon {
  const { x, y, w, h } = rectOf(grid);
  return [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
}

/** What a ramp is painted with: a texture laid as a floor's, or a plain colour at an opacity. */
export type RampFill = { texture: Texture; look: TiledLook } | { color: number; alpha?: number };

/**
 * Paints `fill` through `ramp` (rampMask.ts) into `parent`: over its field's box at the field's
 * opacity, cut to its clip. A texture is drawn through the piece mesh with the ramp read
 * plainly (with no GL, tiled and masked by a sprite of the ramp); a colour as a sprite of the
 * ramp, tinted. Never in steps.
 */
export function paintRamp(parent: Container, ramp: Ramp, fill: RampFill): void {
  const { field, clip } = ramp;
  const { grid } = field;
  if ('texture' in fill) {
    let tile: RenderTexture | null = null;
    if (glReady()) {
      try {
        tile = tileOf(fill.texture);
      } catch (err) {
        console.warn('[softPiece] ramp tile failed, masking by sprite:', err);
      }
    }
    const mask = texelTexture(rampPixels(field), grid, false);
    if (!tile) {
      maskedBySprite(parent, clip ?? [boxRing(grid)], mask, grid, fill.texture, fill.look);
      return;
    }
    const mesh = maskedMesh(mask, rectOf(grid), tile, fill.texture, fill.look, true);
    mesh.label = 'ramp';
    mesh.once('destroyed', () => mask.destroy(true));
    if (clip) clipped(parent, clip, mesh);
    else parent.addChild(mesh);
    return;
  }
  const texture = texelTexture(colorPixels(field), grid, true);
  const sprite = new Sprite(texture);
  sprite.label = 'ramp';
  sprite.position.set(grid.x, grid.y);
  sprite.scale.set(1 / grid.res);
  sprite.tint = fill.color;
  sprite.alpha = fill.alpha ?? 1;
  sprite.once('destroyed', () => texture.destroy(true));
  if (clip) clipped(parent, clip, sprite);
  else parent.addChild(sprite);
}


/** A sprite of a ramp's field laid over its box, for a container to be masked by: it shows that much of what it masks. */
export function rampMaskSprite(field: RampField): Sprite {
  const texture = texelTexture(rampPixels(field), field.grid, false);
  const sprite = new Sprite(texture);
  sprite.label = 'ramp-mask';
  sprite.position.set(field.grid.x, field.grid.y);
  sprite.scale.set(1 / field.grid.res);
  sprite.once('destroyed', () => texture.destroy(true));
  return sprite;
}
