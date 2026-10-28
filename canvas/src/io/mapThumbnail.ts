import { getEngineSingleton } from '@/engine/engineSingleton';
import { runExportPipeline, computeMapWorldBounds } from '@/engine/export/exportPipeline';
import { worldBoundsToCells } from '@/engine/export/exportMath';
import { editorShowsLighting } from '@dnd/core/src/engine/editorDesk';
import { useStore } from '@/store/store';

/** Longest side of a stored thumbnail, in pixels. Cards show it at under half this. */
const THUMBNAIL_PX = 480;

/**
 * Render the open map to a small JPEG for its card on the home page. Same offscreen pass
 * the export dialog runs, scaled so the longer side lands at THUMBNAIL_PX, grid off, lit or
 * unlit as the editor is showing it, so the card looks like the map the DM just left.
 * Resolves to null when there is no canvas to render from.
 */
export async function captureMapThumbnail(): Promise<Blob | null> {
  const singleton = getEngineSingleton();
  if (!singleton) return null;
  const state = useStore.getState();
  const bounds = computeMapWorldBounds(state.layers);
  const { cellWidth, cellHeight } = worldBoundsToCells(bounds);
  const longest = Math.max(1, Math.ceil(cellWidth), Math.ceil(cellHeight));
  const { blob } = await runExportPipeline(singleton.engine, singleton.sceneGraph, state.layers, {
    format: 'jpeg',
    pxPerCell: THUMBNAIL_PX / longest,
    includeGrid: false,
    mapName: state.mapSettings.name,
    lighting: editorShowsLighting(),
  });
  return blob;
}
