import { Container, Graphics, Matrix, RenderTexture, type Renderer } from 'pixi.js';
import { getEngineSingleton } from '@/engine/engineSingleton';
import { getLayerEntry } from '@/engine/sceneGraph';
import { computeMapWorldBounds } from '@/engine/export/exportPipeline';
import { holdAuthoredLook } from '@dnd/core/src/engine/editorDesk';
import { useStore } from '@/store/store';
import type { Layer } from '@/store/types';
import { deskPalette, fillHeightDim, strokeHeightRings } from '@/canvas/heightOverlay';
import { TERRAIN_THUMB, THUMB_ASPECT, THUMB_CSS_PX, fitFrame, levelThumbFrame, thumbFrame, thumbPixels, type ThumbPainter } from './layerThumbs';
import { heightFocus, parseHeightThumbKey } from './heightModel';
import { levelDungeons } from './roomModel';

/**
 * Paints one filmstrip tile from the live scene: the layer's own container rendered into a
 * small texture, framed to the layer's own content (`thumbFrame`; the whole map for the
 * background, terrain and an empty layer), then read back as a PNG data URL. Nothing is redrawn from the document; the tile is exactly what
 * the canvas holds for that layer.
 */

let target: RenderTexture | null = null;
let targetOwner: Renderer | null = null;

function textureFor(renderer: Renderer, px: number, pxH: number): RenderTexture {
  if (target && (targetOwner !== renderer || target.width !== px || target.height !== pxH)) {
    disposeLayerThumbRenderer();
  }
  if (!target) {
    target = RenderTexture.create({ width: px, height: pxH, resolution: 1, antialias: true });
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

/** How much of what is not at a Heights card's height is erased from its picture. */
const HEIGHT_DIM = 0.85;
/** The card's own rings: the map highlight's ink outline, this many CSS px wide at card size. */
const HEIGHT_OUTLINE_PX = 1.5;

/**
 * A Heights card: the level's layers drawn as their own tiles draw them, together, framed to
 * the level's content; then everything not at the card's height erased most of the way, so
 * the tile's own ground shows through it, and the height's rings outlined as the map
 * highlight outlines them (the ground's card has no outline).
 */
function renderHeightThumb(renderer: Renderer, levelId: string, height: number, layers: Layer[]): string | null | undefined {
  const level = levelDungeons(layers, useStore.getState().levels, levelId);
  if (level.length === 0) return null;
  const containers = level.map((l) => getLayerEntry(l.id)?.container);
  if (containers.some((c) => !c || c.destroyed)) return undefined;

  const pxH = thumbPixels(typeof window === 'undefined' ? 1 : window.devicePixelRatio);
  const px = Math.round(pxH * THUMB_ASPECT);
  const rt = textureFor(renderer, px, pxH);
  const { scale, tx, ty } = fitFrame(levelThumbFrame(level, computeMapWorldBounds(layers)), px, pxH);
  const transform = new Matrix(scale, 0, 0, scale, tx, ty);

  level.forEach((layer, i) => {
    const container = containers[i]!;
    const wasVisible = container.visible;
    const wrappers = (getLayerEntry(layer.id)?.sublayers?.floor?.children ?? []).filter((c) => c.label === 'terrainFloorMeshWrapper');
    const releaseTerrain = holdWholeTerrain(wrappers as Container[]);
    try {
      container.visible = true;
      renderer.render({ container, target: rt, clear: i === 0, clearColor: [0, 0, 0, 0], transform });
    } finally {
      releaseTerrain();
      container.visible = wasVisible;
    }
  });

  // The whole picture in world units, so the wash reaches its edges whatever the frame's shape.
  const seen = { minX: -tx / scale, minY: -ty / scale, maxX: (px - tx) / scale, maxY: (pxH - ty) / scale };
  const focus = heightFocus(level, height);
  const dim = new Container();
  const g = new Graphics();
  g.blendMode = 'erase';
  fillHeightDim(g, seen, focus, 0xffffff, HEIGHT_DIM);
  const outline = new Graphics();
  // World units to a CSS px of the card: the texture holds pxH / THUMB_CSS_PX of its pixels per CSS px.
  strokeHeightRings(outline, focus, deskPalette(), HEIGHT_OUTLINE_PX, pxH / THUMB_CSS_PX / scale);
  dim.addChild(g, outline);
  try {
    renderer.render({ container: dim, target: rt, clear: false, transform });
  } finally {
    dim.destroy({ children: true });
  }

  const canvas = renderer.extract.canvas({ target: rt }) as HTMLCanvasElement;
  return canvas.toDataURL('image/png');
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
  const height = parseHeightThumbKey(key);
  if (height) return renderHeightThumb(renderer, height.levelId, height.height, layers);
  const { sceneGraph } = scene;

  const layer = key === TERRAIN_THUMB ? undefined : layers.find((l) => l.id === key);
  let container: Container | undefined;
  if (key === TERRAIN_THUMB) container = sceneGraph.terrainRenderer.container;
  else if (layer?.type === 'background') container = sceneGraph.backgroundLayer;
  else if (layer) container = getLayerEntry(key)?.container;
  if (!layer && key !== TERRAIN_THUMB) return null;
  if (!container || container.destroyed) return undefined;

  const pxH = thumbPixels(typeof window === 'undefined' ? 1 : window.devicePixelRatio);
  const px = Math.round(pxH * THUMB_ASPECT);
  const rt = textureFor(renderer, px, pxH);
  // A map layer framed to what it holds; the background, terrain and an empty layer to the map.
  const { scale, tx, ty } = fitFrame(thumbFrame(layer, computeMapWorldBounds(layers)), px, pxH);
  const transform = new Matrix(scale, 0, 0, scale, tx, ty);

  const wasVisible = container.visible;
  // Rendering a container on its own makes it a render group; the masked background then
  // stops drawing in the scene, so it is handed back as it was.
  const wasRenderGroup = container.isRenderGroup;
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
    if (layer?.type === 'background' && !wasRenderGroup && container.isRenderGroup) container.disableRenderGroup();
  }

  const canvas = renderer.extract.canvas({ target: rt }) as HTMLCanvasElement;
  return canvas.toDataURL('image/png');
};
