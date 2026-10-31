import { RenderTexture, type Renderer } from 'pixi.js';
import type { RenderEngine } from '../RenderEngine';
import type { SceneGraph } from '../sceneGraph';
import { getLayerEntry } from '../sceneGraph';
import type { Layer } from '../../store/types';
import { useStore } from '../../store/store';
import {
  EXPORT_RESOLUTION,
  computeExportDimensions,
  buildExportFilename,
  exportWorldOffset,
  worldBoundsToCells,
} from './exportMath';
import { computeContentBounds, computeMapFrame } from '../../shared/mapBounds';
import { holdAuthoredLook } from '../editorDesk';
import { isBandSet } from '../../assets/packCatalog';
import type { NightSky } from '../../shared/world';
import type { Weather } from '../../shared/prep';
import { skyFrame } from '../../shared/sky';

export interface ExportOptions {
  format: 'png' | 'jpeg';
  pxPerCell: number;   // 64 | 128 | 256
  includeGrid: boolean;
  mapName: string;
  /**
   * Apply the map's lighting (its moods and its lights) to the file, at the hour, night sky
   * and weather given — or, with `true`, under the sky the live preview stands at. `false`
   * is the map as the unlit editing view shows it. Defaults to on (`true`).
   */
  lighting?: boolean | { minutes: number; nightSky: NightSky; weather: Weather };
  /**
   * Which labels the file carries: none, only those marked visible to players, or all of
   * them (the default).
   */
  labels?: 'none' | 'players' | 'all';
}

/**
 * Editor-only containers that sit in the world container but never belong in a file: the
 * zone markers (canvas/zoneOverlay.ts labels its Graphics this) and the tool previews (a
 * label or door ghost left under the cursor).
 */
const EDITOR_ONLY = ['zoneOverlay', 'previewContainer'];

/**
 * Compute the axis-aligned bounding box of all dungeon layer floor geometry,
 * in world space (world units = grid cells). The walk itself lives in
 * shared/mapBounds (pixi-free, so the session server can use it); this keeps
 * the store-fed terrain default and the 10x10 export default.
 */
export function computeMapWorldBounds(
  layers: Layer[],
  terrainBounds = useStore.getState().mapSettings.terrain?.bounds ?? null,
  fixedSize = useStore.getState().mapSettings.fixedSize ?? null,
): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  // A pinned map exports its frame: the pinned size, grown wherever something was drawn
  // past it, so nothing on the map is ever cropped away.
  if (fixedSize) return computeMapFrame(layers, terrainBounds, fixedSize)!;
  const b = computeContentBounds(layers, terrainBounds);
  if (!b) return { minX: -5, minY: -5, maxX: 5, maxY: 5 };
  const band = bandPad(layers);
  return { minX: b.minX - band, minY: b.minY - band, maxX: b.maxX + band, maxY: b.maxY + band };
}

/**
 * How far cave band rock reaches past a floor edge, in cells. The content bounds pad a
 * wall by half its stroke width, but a band layer's rock is laid by the cave walk at
 * render time, pushed out past the ring and a good deal thicker than any stroke: about
 * 1.3 cells past the floor edge measured on a Cave Ink room. Without this the file cut
 * the outer rock off on every side.
 */
export const BAND_REACH = 1.5;

/** Extra pad the content bounds need on top of their stroke pad for band layers. */
function bandPad(layers: readonly Layer[]): number {
  let pad = 0;
  for (const layer of layers) {
    if (layer.type !== 'dungeon' || !isBandSet(layer.style?.wallTextureSetId)) continue;
    // computeContentBounds already padded half the wall width plus 0.05 of slack.
    pad = Math.max(pad, BAND_REACH - ((layer.style?.wallWidth ?? 0) / 2 + 0.05));
  }
  return pad;
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
  const { widthPx, heightPx, pxPerCell } = computeExportDimensions(
    cellWidth,
    cellHeight,
    opts.pxPerCell,
    EXPORT_RESOLUTION,
  );
  const lighting = opts.lighting !== false;

  const filename = buildExportFilename(
    opts.mapName,
    widthPx,
    heightPx,
    Math.round(pxPerCell),
    opts.format,
  );

  // An offscreen RenderTexture holding exactly the file's pixels. Not the screen's DPR: a
  // HiDPI texture came back DPR times too big and the file kept only its top-left corner.
  const exportRT = engine.createRenderTexture(widthPx, heightPx, EXPORT_RESOLUTION);

  let imgEl: HTMLImageElement;
  try {
    // Capture the live scene state the export borrows, so the finally below can hand
    // it back even when a render step throws.
    const gridVisible = sceneGraph.gridRenderer.container.visible;
    const savedGridSubVis: { id: string; visible: boolean }[] = [];
    const origX = sceneGraph.worldContainer.position.x;
    const origY = sceneGraph.worldContainer.position.y;
    const origScale = sceneGraph.worldContainer.scale.x;
    let releaseLook: (() => void) | null = null;
    // Everything hidden for the file, with the visibility it had, handed back in the finally.
    const hidden: { visible: boolean }[] = [];
    const hide = (node: { visible: boolean } | null | undefined) => {
      if (!node || !node.visible) return;
      hidden.push(node);
      node.visible = false;
    };

    try {
      for (const node of sceneGraph.worldContainer.children ?? []) {
        if (EDITOR_ONLY.includes(node.label)) hide(node);
      }
      const labels = opts.labels ?? 'all';
      if (labels !== 'all') {
        for (const layer of layers) {
          if (layer.type !== 'dungeon') continue;
          const sub = getLayerEntry(layer.id)?.sublayers?.labels;
          if (!sub) continue;
          if (labels === 'none') {
            hide(sub);
            continue;
          }
          // A DM-only label's text and its pill plate (`subscribeToTextLabels` names both).
          for (const child of layer.children) {
            if (child.childType !== 'text' || child.players) continue;
            for (const node of sub.children) {
              if (node.label === `label-${child.id}` || node.label === `label-pill-${child.id}`) hide(node);
            }
          }
        }
      }

      // Temporarily hide grids if requested — both the global grid renderer
      // AND per-layer grid sublayers inside each dungeon layer
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
      // The effective scale, so a map past the texture limit shrinks to fit instead of cropping.
      // The file is whole cells; the bounds sit in its middle, not its top-left corner.
      const zoom = pxPerCell;
      const { x: worldX, y: worldY } = exportWorldOffset(bounds, widthPx, heightPx, zoom);

      // An editor that lays the map on its own desk paints a presentation sheet; the file gets
      // the map as authored, so hold that look for the length of the (synchronous) render.
      // Unlit, the background is the plain one the unlit editing view shows.
      releaseLook = holdAuthoredLook({ lit: lighting });

      // Apply export transform
      sceneGraph.worldContainer.position.set(worldX, worldY);
      sceneGraph.worldContainer.scale.set(zoom);

      // Render world to export texture
      engine.renderToTexture(sceneGraph.worldContainer, exportRT);

      // The lighting pass rides on top, still under the export transform — it reads the light
      // positions back through `engine.worldToScreen`, which is that transform, so it has to run
      // before the restore below. Without it the file came out at the map's authored daylight
      // brightness whatever the hour was: the composite is a screen-space overlay sprite, and
      // the export only ever rendered the world container. Skipped for an unlit file.
      if (lighting) {
        const sky =
          typeof opts.lighting === 'object'
            ? skyFrame({
                ...useStore.getState().mapSettings,
                // The dialog's hour is the hour: a fixed map's own is only the seed.
                timeMode: 'clock',
                minutes: opts.lighting.minutes,
                nightSky: opts.lighting.nightSky,
                weather: opts.lighting.weather,
              })
            : undefined;
        sceneGraph.lightingRenderer.renderInto(exportRT, zoom, widthPx, heightPx, sky);
      }
    } finally {
      releaseLook?.();
      for (const node of hidden) node.visible = true;

      // Restore original transform and grid visibility
      sceneGraph.worldContainer.position.set(origX, origY);
      sceneGraph.worldContainer.scale.set(origScale);
      sceneGraph.gridRenderer.container.visible = gridVisible;
      for (const { id, visible } of savedGridSubVis) {
        const entry = getLayerEntry(id);
        if (entry?.sublayers?.grid) entry.sublayers.grid.visible = visible;
      }
    }

    // Extract pixels from the RenderTexture via PixiJS extract API
    const pixiRenderer = engine.renderer() as Renderer & {
      extract: {
        image(opts: { target: RenderTexture; format?: string; quality?: number }): Promise<HTMLImageElement>;
      };
    };

    imgEl = await pixiRenderer.extract.image({
      target: exportRT,
      format: opts.format === 'jpeg' ? 'image/jpeg' : 'image/png',
      quality: opts.format === 'jpeg' ? 0.85 : undefined,
    });
  } finally {
    exportRT.destroy(true);
  }

  // Convert HTMLImageElement → Blob via OffscreenCanvas
  const canvas = new OffscreenCanvas(widthPx, heightPx);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable');
  // Sized, not natural: should the texture ever come back at another resolution, the file
  // is scaled to fit rather than cropped to its top-left corner.
  ctx.drawImage(imgEl as CanvasImageSource, 0, 0, widthPx, heightPx);

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
