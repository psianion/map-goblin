import { Matrix, RenderTexture, type Container, type Renderer } from 'pixi.js';
import { getEngineSingleton } from '@/engine/engineSingleton';
import { getLayerEntry } from '@/engine/sceneGraph';
import { computeMapWorldBounds } from '@/engine/export/exportPipeline';
import { holdAuthoredLook } from '@dnd/core/src/engine/editorDesk';
import type { Layer } from '@/store/types';
import { TERRAIN_THUMB, fitFrame, thumbPixels, type ThumbPainter } from './layerThumbs';

/**
 * Paints one filmstrip tile from the live scene: the layer's own container rendered into a
 * small texture, framed to the whole map (the frame the export and the home cards use), then
 * read back as a PNG data URL. Nothing is redrawn from the document; the tile is exactly what
 * the canvas holds for that layer.
 */

let target: RenderTexture | null = null;
let targetOwner: Renderer | null = null;

function textureFor(renderer: Renderer, px: number): RenderTexture {
  if (target && (targetOwner !== renderer || target.width !== px || target.height !== px)) {
    disposeLayerThumbRenderer();
  }
  if (!target) {
    target = RenderTexture.create({ width: px, height: px, resolution: 1, antialias: true });
    targetOwner = renderer;
  }
  return target;
}

/** Free the shared render texture. Safe to call any time; the next paint makes a new one. */
export function disposeLayerThumbRenderer(): void {
  try {
    target?.destroy(true);
  } catch {
    // The renderer that owned it is already gone.
  }
  target = null;
  targetOwner = null;
}

/**
 * The terrain paint keeps a crisp copy of just the visible part of the map while zoomed in,
 * and hides its whole-map mesh meanwhile. A thumbnail needs the whole map, so swap back to
 * the whole-map meshes for the render. Returns the undo.
 */
function holdWholeTerrain(holders: Container[]): () => void {
  const saved: { node: Container; visible: boolean }[] = [];
  const set = (node: Container, visible: boolean) => {
    saved.push({ node, visible: node.visible });
    node.visible = visible;
  };
  for (const holder of holders) {
    const kids = holder.children as Container[];
    const windowed = kids.some(
      (c) => c.visible && (c.label === 'terrainWindowMesh' || c.label === 'terrainFloorWindowMesh'),
    );
    if (!windowed) continue;
    for (const c of kids) {
      if (c.label === 'terrainWindowMesh' || c.label === 'terrainFloorWindowMesh') set(c, false);
      else if (c.label === 'terrainMesh' || c.label === 'terrainFloorMesh') set(c, true);
    }
  }
  return () => {
    for (let i = saved.length - 1; i >= 0; i--) saved[i].node.visible = saved[i].visible;
  };
}

/** Painter for `startLayerThumbs`. */
export const renderLayerThumb: ThumbPainter = (key: string, layers: Layer[]) => {
  const scene = getEngineSingleton();
  if (!scene) return undefined;
  let renderer: Renderer;
  try {
    renderer = scene.engine.renderer();
  } catch {
    return undefined; // not initialised yet, or torn down
  }
  const { sceneGraph } = scene;

  const layer = key === TERRAIN_THUMB ? undefined : layers.find((l) => l.id === key);
  let container: Container | undefined;
  if (key === TERRAIN_THUMB) container = sceneGraph.terrainRenderer.container;
  else if (layer?.type === 'background') container = sceneGraph.backgroundLayer;
  else if (layer) container = getLayerEntry(key)?.container;
  if (!layer && key !== TERRAIN_THUMB) return null;
  if (!container || container.destroyed) return undefined;

  const px = thumbPixels(typeof window === 'undefined' ? 1 : window.devicePixelRatio);
  const rt = textureFor(renderer, px);
  const { scale, tx, ty } = fitFrame(computeMapWorldBounds(layers), px);
  const transform = new Matrix(scale, 0, 0, scale, tx, ty);

  const wasVisible = container.visible;
  let releaseLook: (() => void) | null = null;
  let releaseTerrain: (() => void) | null = null;
  let fill: Container | null = null;
  let fillVisible = true;
  try {
    // A hidden or soloed-away layer still gets its picture; the tile dims it.
    container.visible = true;
    if (key === TERRAIN_THUMB) {
      releaseTerrain = holdWholeTerrain([container]);
    } else if (layer?.type === 'dungeon') {
      const floor = getLayerEntry(key)?.sublayers?.floor;
      const wrappers = (floor?.children ?? []).filter((c) => c.label === 'terrainFloorMeshWrapper');
      releaseTerrain = holdWholeTerrain(wrappers as Container[]);
    } else {
      // The background as authored, without the editor's sheet clip; the solid fill only
      // covers the area around the camera, so leave it out and let the texture carry it.
      releaseLook = holdAuthoredLook();
      fill = (container.children as Container[]).find((c) => c.label === 'bgFill') ?? null;
      if (fill) {
        fillVisible = fill.visible;
        fill.visible = false;
      }
    }
    renderer.render({ container, target: rt, clear: true, clearColor: [0, 0, 0, 0], transform });
  } finally {
    if (fill) fill.visible = fillVisible;
    releaseLook?.();
    releaseTerrain?.();
    container.visible = wasVisible;
  }

  const canvas = renderer.extract.canvas({ target: rt }) as HTMLCanvasElement;
  return canvas.toDataURL('image/png');
};
