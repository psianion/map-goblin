// Table fix pass F20 — a scene imported at the table (or published before thumbnails existed)
// has no picture, so its card is a letter tile. The DM's table has the map loaded and the same
// engine the canvas exports with, so it renders the picture itself and sends it over the route
// the canvas publish already uses (`PUT /api/maps/:mapId/thumbnail`).

import { getEngineSingleton } from '@dnd/core/src/engine/engineSingleton';
import { computeMapWorldBounds, runExportPipeline } from '@dnd/core/src/engine/export/exportPipeline';
import { worldBoundsToCells } from '@dnd/core/src/engine/export/exportMath';
import { useStore } from '@dnd/core/src/store/store';
import type { Role } from '@dnd/core/src/shared/protocol';
import { endpoints } from '../endpoints';
import { listScenes, type SceneMeta } from '../session/auth';
import { useSessionStore } from '../session/store';
import { useSceneLibrary } from '../modules/scene/store';

/** Longest side of the picture, in pixels: the canvas's own `THUMBNAIL_PX`. */
const THUMBNAIL_PX = 480;

/** How long a freshly loaded map is given to draw before it is pictured. */
export const THUMBNAIL_SETTLE_MS = 2000;

/**
 * The loaded scene's row when the DM's table owes it a picture, or null: DM only, the scene
 * has none, and this tab has not already tried it (a failed try is not repeated).
 */
export function sceneNeedingThumbnail(
  scenes: readonly SceneMeta[],
  loaded: { sceneId: string; mapId: string } | null,
  role: Role | undefined,
  tried: ReadonlySet<string>,
): SceneMeta | null {
  if (role !== 'dm' || !loaded || tried.has(loaded.mapId)) return null;
  const scene = scenes.find((s) => s.id === loaded.sceneId && s.mapId === loaded.mapId);
  return scene && !scene.thumbnail ? scene : null;
}

/** The loaded map as a small JPEG: unlit and without labels, as the canvas sends it. */
export async function captureSceneThumbnail(): Promise<Blob | null> {
  const singleton = getEngineSingleton();
  if (!singleton) return null;
  const state = useStore.getState();
  const { cellWidth, cellHeight } = worldBoundsToCells(computeMapWorldBounds(state.layers));
  const longest = Math.max(1, Math.ceil(cellWidth), Math.ceil(cellHeight));
  const { blob } = await runExportPipeline(singleton.engine, singleton.sceneGraph, state.layers, {
    format: 'jpeg',
    pxPerCell: THUMBNAIL_PX / longest,
    includeGrid: false,
    mapName: state.mapSettings.name,
    lighting: false,
    labels: 'none',
  });
  return blob;
}

/** `PUT /api/maps/:mapId/thumbnail`, DM only, raw image bytes. */
export async function uploadSceneThumbnail(mapId: string, token: string, image: Blob): Promise<void> {
  const res = await fetch(`${endpoints.httpBase}/api/maps/${encodeURIComponent(mapId)}/thumbnail`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': image.type || 'image/jpeg' },
    body: image,
  });
  if (!res.ok) throw new Error(`Thumbnail upload failed: ${res.status}`);
}

/**
 * Watches the DM's loaded scene and pictures it once when it has no picture. Returns the
 * detach function. Every failure is quiet: a missing picture is a letter tile, not an error.
 */
export function watchSceneThumbnails(): () => void {
  const tried = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last: string | null = null;

  const check = async (loaded: { sceneId: string; mapId: string }): Promise<void> => {
    const { you, session, token } = useSessionStore.getState();
    if (you?.role !== 'dm' || !session || !token || tried.has(loaded.mapId)) return;
    const { scenes } = await listScenes(session.campaignId, token);
    const scene = sceneNeedingThumbnail(scenes, useSessionStore.getState().loadedScene, you.role, tried);
    if (!scene) return;
    tried.add(scene.mapId);
    const image = await captureSceneThumbnail();
    if (!image) return;
    await uploadSceneThumbnail(scene.mapId, token, image);
    await useSceneLibrary.getState().refresh();
  };

  const onChange = (): void => {
    const { loadedScene, you } = useSessionStore.getState();
    const key = loadedScene ? `${loadedScene.sceneId}/${loadedScene.mapId}` : null;
    if (key === last) return;
    last = key;
    if (timer) clearTimeout(timer);
    timer = null;
    if (!loadedScene || you?.role !== 'dm') return;
    timer = setTimeout(() => {
      timer = null;
      check(loadedScene).catch(() => {});
    }, THUMBNAIL_SETTLE_MS);
  };

  onChange();
  const unsubscribe = useSessionStore.subscribe(onChange);
  return () => {
    unsubscribe();
    if (timer) clearTimeout(timer);
  };
}
