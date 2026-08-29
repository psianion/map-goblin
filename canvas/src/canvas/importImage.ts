/**
 * Image import pipeline — file validation, base64 conversion, resize-if-oversized,
 * PIXI.Assets registration, and AddChildCommand dispatch.
 *
 * All three entry points (file picker, drag-and-drop, clipboard paste) call
 * handleImageImport(file, engine).
 */

import { Assets } from 'pixi.js';
import { notify } from '@/lib/toast';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import { AddChildCommand } from '@/store/commands';
import type { AssetChild } from '@/store/types';
import type { RenderEngine } from '@/engine/RenderEngine';
import { blockedLayerReason } from '@dnd/core/src/engine/tools/layerGuard';

const VALID_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];
const MAX_IMPORT_PX = 4096;
const RESIZE_TARGET_PX = 2048;
const AUTO_SCALE_CELLS = 5;

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function resizeImageToMax(base64: string, maxPx: number): Promise<string> {
  const response = await fetch(base64);
  const blob = await response.blob();
  const img = await createImageBitmap(blob);
  const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
  const w = Math.floor(img.width * scale);
  const h = Math.floor(img.height * scale);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, w, h);
  img.close();
  const outputBlob = await canvas.convertToBlob({ type: 'image/png' });
  return fileToBase64(new File([outputBlob], 'resized.png', { type: 'image/png' }));
}

/** Room-note handouts stay small — they ride the map file as base64 and only ever render
 *  inside a panel, never on the canvas. */
const NOTE_IMAGE_MAX_PX = 1024;

/**
 * A room note's image: validate, downscale to panel size, store in `customImages`, hand
 * back the key the note references. No PIXI registration and no AssetChild — a note image
 * is never drawn on the map.
 */
export async function importNoteImage(file: File): Promise<string> {
  if (!VALID_TYPES.includes(file.type)) {
    throw new Error(`Unsupported image format: ${file.type}. Use PNG, JPEG, SVG, or WebP.`);
  }
  let base64 = await fileToBase64(file);
  const bitmap = await createImageBitmap(file);
  const oversized = bitmap.width > NOTE_IMAGE_MAX_PX || bitmap.height > NOTE_IMAGE_MAX_PX;
  bitmap.close();
  if (oversized) base64 = await resizeImageToMax(base64, NOTE_IMAGE_MAX_PX);

  const key = crypto.randomUUID();
  useStore.getState().addCustomImage(key, base64);
  return key;
}

/**
 * Core import pipeline. Validates format, checks dimensions, resizes if >4096px,
 * registers the image in the store and PIXI.Assets, returns an AssetChild.
 */
export async function importImageFile(
  file: File,
  viewportCenter: { x: number; y: number },
): Promise<AssetChild> {
  if (!VALID_TYPES.includes(file.type)) {
    throw new Error(`Unsupported image format: ${file.type}. Use PNG, JPEG, SVG, or WebP.`);
  }

  const bitmap = await createImageBitmap(file);
  let finalWidth = bitmap.width;
  let finalHeight = bitmap.height;
  bitmap.close();

  let base64 = await fileToBase64(file);

  if (finalWidth > MAX_IMPORT_PX || finalHeight > MAX_IMPORT_PX) {
    notify.warning(
      `Image is ${finalWidth}\u00d7${finalHeight}px \u2014 resizing to max ${RESIZE_TARGET_PX}px for performance.`,
    );
    base64 = await resizeImageToMax(base64, RESIZE_TARGET_PX);
    const resizeScale = Math.min(1, RESIZE_TARGET_PX / Math.max(finalWidth, finalHeight));
    finalWidth = Math.floor(finalWidth * resizeScale);
    finalHeight = Math.floor(finalHeight * resizeScale);
  }

  const assetId = crypto.randomUUID();

  useStore.getState().addCustomImage(assetId, base64);
  await Assets.load({ alias: assetId, src: base64 });

  const worldScale = AUTO_SCALE_CELLS / Math.max(finalWidth, finalHeight);

  const child: AssetChild = {
    id: crypto.randomUUID(),
    name: `Image ${assetId.slice(0, 4)}`,
    childType: 'asset',
    visible: true,
    objectType: 'image',
    assetId,
    position: { x: viewportCenter.x, y: viewportCenter.y },
    rotation: 0,
    scale: worldScale,
    width: finalWidth * worldScale,
    height: finalHeight * worldScale,
    tint: '#ffffff',
    flipX: false,
    flipY: false,
  };

  return child;
}

/**
 * Shared handler called by all three import entry points.
 * Places the imported image as an AssetChild on the active dungeon layer.
 */
export async function handleImageImport(file: File, engine: RenderEngine): Promise<void> {
  const store = useStore.getState();

  const targetLayerId = store.ui.activeLayerId;
  const layer = store.layers.find((l) => l.id === targetLayerId);
  if (!layer || layer.type !== 'dungeon') {
    notify.error('Select a dungeon layer to import images.');
    return;
  }
  // File picker, drag-and-drop and clipboard paste all funnel through here, so
  // this one guard closes all three against a locked or hidden target layer.
  const blocked = blockedLayerReason(layer);
  if (blocked) {
    notify.warning(blocked);
    return;
  }

  try {
    const vp = engine.viewport();
    const center = engine.screenToWorld(vp.width / 2, vp.height / 2);

    const child = await importImageFile(file, center);
    undoManager.execute(new AddChildCommand('Import image', targetLayerId, child));
    // An imported picture is an asset the user is likely to place again, and the
    // browser's Recent tab is where they would look for it. Nothing on the
    // import path recorded the use, so imports never showed up there.
    store.trackRecentUse(child.assetId);

    notify.success('Image imported');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    notify.error(`Import failed: ${message}`);
  }
}
