import { RenderTexture, type Renderer } from 'pixi.js';
import type { RenderEngine } from '../RenderEngine';
import type { SceneGraph } from '../sceneGraph';
import { getLayerEntry } from '../sceneGraph';
import type { Layer } from '../../store/types';
import { useStore } from '../../store/store';
import { computeExportDimensions, buildExportFilename, worldBoundsToCells } from './exportMath';
import { computeContentBounds } from '../../shared/mapBounds';

export interface ExportOptions {
  format: 'png' | 'jpeg';
  pxPerCell: number;   // 64 | 128 | 256
  includeGrid: boolean;
  mapName: string;
}

/**
 * Compute the axis-aligned bounding box of all dungeon layer floor geometry,
 * in world space (world units = grid cells). The walk itself lives in
 * shared/mapBounds (pixi-free, so the session server can use it); this keeps
 * the store-fed terrain default and the 10x10 export default.
 */
export function computeMapWorldBounds(
  layers: Layer[],
  terrainBounds = useStore.getState().mapSettings.terrain?.bounds ?? null,
): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  return (
    computeContentBounds(layers, terrainBounds) ?? { minX: -5, minY: -5, maxX: 5, maxY: 5 }
  );
}

/**
 * Render the current map to a Blob (PNG or JPEG) at the requested resolution.
 */
export async function runExportPipeline(
  engine: RenderEngine,
  sceneGraph: SceneGraph,
  layers: Layer[],
  opts: ExportOptions,
): Promise<{ blob: Blob; filename: string }> {
  const bounds = computeMapWorldBounds(layers);
  const { cellWidth, cellHeight } = worldBoundsToCells(bounds);
  const { widthPx, heightPx } = computeExportDimensions(cellWidth, cellHeight, opts.pxPerCell);

  const filename = buildExportFilename(
    opts.mapName,
    widthPx,
    heightPx,
    opts.pxPerCell,
    opts.format,
  );

  // Create an offscreen RenderTexture at export resolution
  const exportRT = engine.createRenderTexture(widthPx, heightPx);

  // Temporarily hide grids if requested — both the global grid renderer
  // AND per-layer grid sublayers inside each dungeon layer
  const gridVisible = sceneGraph.gridRenderer.container.visible;
  const savedGridSubVis: { id: string; visible: boolean }[] = [];
  if (!opts.includeGrid) {
    sceneGraph.gridRenderer.container.visible = false;
    for (const layer of layers) {
      if (layer.type !== 'dungeon') continue;
      const entry = getLayerEntry(layer.id);
      if (entry?.sublayers?.grid) {
        savedGridSubVis.push({ id: layer.id, visible: entry.sublayers.grid.visible });
        entry.sublayers.grid.visible = false;
      }
    }
  }

  // Compute export-space transform: scale world container so that
  // pxPerCell world units map to pxPerCell pixels, centered on bounds
  const zoom = opts.pxPerCell;
  const worldX = -bounds.minX * zoom;
  const worldY = -bounds.minY * zoom;

  // Capture original transform
  const origX = sceneGraph.worldContainer.position.x;
  const origY = sceneGraph.worldContainer.position.y;
  const origScale = sceneGraph.worldContainer.scale.x;

  // Apply export transform
  sceneGraph.worldContainer.position.set(worldX, worldY);
  sceneGraph.worldContainer.scale.set(zoom);

  // Render world to export texture
  engine.renderToTexture(sceneGraph.worldContainer, exportRT);

  // Restore original transform and grid visibility
  sceneGraph.worldContainer.position.set(origX, origY);
  sceneGraph.worldContainer.scale.set(origScale);
  sceneGraph.gridRenderer.container.visible = gridVisible;
  for (const { id, visible } of savedGridSubVis) {
    const entry = getLayerEntry(id);
    if (entry?.sublayers?.grid) entry.sublayers.grid.visible = visible;
  }

  // Extract pixels from the RenderTexture via PixiJS extract API
  const pixiRenderer = engine.renderer() as Renderer & {
    extract: {
      image(opts: { target: RenderTexture; format?: string; quality?: number }): Promise<HTMLImageElement>;
    };
  };

  const imgEl = await pixiRenderer.extract.image({
    target: exportRT,
    format: opts.format === 'jpeg' ? 'image/jpeg' : 'image/png',
    quality: opts.format === 'jpeg' ? 0.85 : undefined,
  });

  exportRT.destroy(true);

  // Convert HTMLImageElement → Blob via OffscreenCanvas
  const canvas = new OffscreenCanvas(widthPx, heightPx);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable');
  ctx.drawImage(imgEl as CanvasImageSource, 0, 0);

  const mimeType = opts.format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const quality = opts.format === 'jpeg' ? 0.85 : undefined;
  const blob = await canvas.convertToBlob({ type: mimeType, quality });

  return { blob, filename };
}

/**
 * Trigger a browser file download for the given blob.
 */
export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.type = blob.type;  // helps browsers infer file extension
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
