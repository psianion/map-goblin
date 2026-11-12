// Draws a layer's paths into its paths sublayer: each path's units laid along its line by
// shared/pathway's layPathUnits, one sprite a unit, at the unit's own size times the width,
// never stretched along the line. A piece tagged `soft` is drawn instead as one mesh along the
// line (drawSoftPath), its own alpha feathering the sides. The PNG export renders the same sublayer.

import { Container, Mesh, MeshGeometry, Shader, Sprite, type Texture } from 'pixi.js';
import type { DungeonLayer, PathwayChild } from '../../store/types';
import { useStore } from '../../store/store';
import { getLayerEntry } from '../sceneGraph';
import { load, resolveTexture } from '../../assets/textureLoader';
import { pathPieceOf, unitSizeOf } from '../../assets/pathKit';
import { layPathUnits, pathwayLine, softPathStrip, type UnitSize } from '../../shared/pathway';
import { getAssetPackManager } from '../assetPackInstance';

/** Layers waiting on a unit's art, and the art already asked for. */
const waiting = new Set<string>();
const asked = new Set<string>();

/** Art can land later than one wait: a decode clears `asked` so the next draw asks again. */
let watching = false;
function watchTextures(): void {
  if (watching) return;
  watching = true;
  getAssetPackManager().subscribeTextures(() => asked.clear());
}

const pathsOf = (layer: DungeonLayer): PathwayChild[] =>
  layer.children.filter((c): c is PathwayChild => c.childType === 'pathway');

function awaitArt(layer: DungeonLayer, ids: string[]): void {
  watchTextures();
  const missing = ids.filter((id) => !asked.has(id));
  if (missing.length === 0 || waiting.has(layer.id)) return;
  waiting.add(layer.id);
  for (const id of missing) asked.add(id);
  void Promise.all(missing.map((id) => load(id))).then(() => {
    waiting.delete(layer.id);
    const now = useStore.getState().layers.find((l): l is DungeonLayer => l.id === layer.id && l.type === 'dungeon');
    if (now) drawLayerPaths(now);
  });
}

/** A soft band's shader: the art at the strip's uv, times each vertex's opacity and the mesh's own alpha. */
const SOFT_VERTEX = `
  in vec2 aPosition;
  in vec2 aUV;
  in float aAlpha;
  out vec2 vUV;
  out float vAlpha;
  uniform mat3 uProjectionMatrix;
  uniform mat3 uWorldTransformMatrix;
  uniform mat3 uTransformMatrix;
  void main() {
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
    vUV = aUV;
    vAlpha = aAlpha;
  }
`;
const SOFT_FRAGMENT = `
  in vec2 vUV;
  in float vAlpha;
  out vec4 finalColor;
  uniform sampler2D uTexture;
  uniform vec4 uColor;
  uniform vec4 uWorldColorAlpha;
  void main() {
    finalColor = texture(uTexture, vUV) * vAlpha * uColor * uWorldColorAlpha;
  }
`;

/**
 * A soft piece's path: one mesh along its line (shared/pathway's softPathStrip), the art's
 * frame mapped onto each repeat. The mesh's geometry and shader go with it when it is destroyed.
 */
function drawSoftPath(path: PathwayChild, tex: Texture, unit: UnitSize): Container | null {
  const repeat = unit.length * (path.width / unit.width);
  const strip = softPathStrip(pathwayLine(path), repeat, path.width, path.transitionIn, path.transitionOut);
  if (strip.indices.length === 0) return null;
  // The strip's uv is one repeat of the art; the art may be a frame of a larger source.
  const f = tex.frame;
  const sw = tex.source.width || 1;
  const sh = tex.source.height || 1;
  const uvs = new Float32Array(strip.uvs.length);
  for (let i = 0; i < strip.uvs.length; i += 2) {
    uvs[i] = (f.x + strip.uvs[i] * f.width) / sw;
    uvs[i + 1] = (f.y + strip.uvs[i + 1] * f.height) / sh;
  }
  const geometry = new MeshGeometry({
    positions: new Float32Array(strip.positions),
    uvs,
    indices: new Uint32Array(strip.indices),
  });
  geometry.addAttribute('aAlpha', { buffer: new Float32Array(strip.alphas), format: 'float32' });
  const shader = Shader.from({ gl: { vertex: SOFT_VERTEX, fragment: SOFT_FRAGMENT }, resources: { uTexture: tex.source } });
  const mesh = new Mesh({ geometry, shader });
  mesh.label = 'path-soft';
  mesh.once('destroyed', () => {
    geometry.destroy();
    shader.destroy();
  });
  const piece = new Container();
  piece.label = `path-${path.id}`;
  piece.addChild(mesh);
  return piece;
}

/** One path's units, as sprites in a container of their own; a soft piece as one band. */
function drawPath(path: PathwayChild, missing: string[]): Container | null {
  const entry = pathPieceOf(path.pieceId);
  if (!entry) return null;
  const tex = resolveTexture(entry.id);
  if (tex.width <= 1) {
    missing.push(entry.id);
    return null;
  }
  const unit = unitSizeOf(entry);
  if (entry.tags.includes('soft')) return drawSoftPath(path, tex, unit);
  const units = layPathUnits(pathwayLine(path), unit, path.width, path.transitionIn, path.transitionOut);
  const piece = new Container();
  piece.label = `path-${path.id}`;
  const cr = entry.contentRect;
  // World cells per texture pixel, either way: the art at its authored size, as the band's is.
  const perPxX = unit.length / tex.width;
  const perPxY = unit.width / tex.height;
  for (const u of units) {
    const s = new Sprite(tex);
    if (cr) s.anchor.set((entry.naturalWidth / 2 - cr.x) / cr.w, (entry.naturalHeight / 2 - cr.y) / cr.h);
    else s.anchor.set(0.5, 0.5);
    s.position.set(u.x, u.y);
    s.rotation = u.rotation;
    s.scale.set(perPxX * u.scaleAlong, perPxY * u.scaleAcross);
    s.alpha = u.alpha;
    piece.addChild(s);
  }
  return piece;
}

/** Draws a layer's paths, replacing what was drawn. */
export function drawLayerPaths(layer: DungeonLayer): void {
  const host = getLayerEntry(layer.id)?.sublayers?.paths;
  if (!host) return;
  for (const child of host.removeChildren()) child.destroy({ children: true });
  const missing: string[] = [];
  for (const path of pathsOf(layer)) {
    if (!path.visible) continue;
    const piece = drawPath(path, missing);
    if (piece) host.addChild(piece);
  }
  if (missing.length > 0) awaitArt(layer, [...new Set(missing)]);
}

/** What a layer's paths draw from, as a key: each path child's identity. */
export function pathsKey(layer: DungeonLayer): PathwayChild[] {
  return pathsOf(layer);
}
