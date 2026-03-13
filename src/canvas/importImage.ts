/**
 * Image import pipeline — file validation, base64 conversion, resize-if-oversized,
 * PIXI.Assets registration, and PlaceObjectCommand dispatch.
 *
 * All three entry points (file picker, drag-and-drop, clipboard paste) call
 * handleImageImport(file, engine).
 */

import { Assets } from 'pixi.js';
import { toast } from 'sonner';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import { PlaceObjectCommand, AddLayerCommand } from '@/store/commands';
import { createImagesLayer } from '@/store/factories';
import type { PlacedObject } from '@/store/types';
import type { RenderEngine } from '@/engine/RenderEngine';

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

/**
 * Core import pipeline. Validates format, checks dimensions, resizes if >4096px,
 * registers the image in the store and PIXI.Assets, returns a PlacedObject.
 *
 * The caller must set `obj.layerId` before creating the command.
 */
export async function importImageFile(
  file: File,
  viewportCenter: { x: number; y: number },
): Promise<PlacedObject> {
  if (!VALID_TYPES.includes(file.type)) {
    throw new Error(`Unsupported image format: ${file.type}. Use PNG, JPEG, SVG, or WebP.`);
  }

  // Read dimensions
  const bitmap = await createImageBitmap(file);
  let finalWidth = bitmap.width;
  let finalHeight = bitmap.height;
  bitmap.close();

  let base64 = await fileToBase64(file);

  // Warn and resize if oversized
  if (finalWidth > MAX_IMPORT_PX || finalHeight > MAX_IMPORT_PX) {
    toast.warning(
      `Image is ${finalWidth}×${finalHeight}px — resizing to max ${RESIZE_TARGET_PX}px for performance.`,
    );
    base64 = await resizeImageToMax(base64, RESIZE_TARGET_PX);
    // Recalculate dimensions after resize
    const resizeScale = Math.min(1, RESIZE_TARGET_PX / Math.max(finalWidth, finalHeight));
    finalWidth = Math.floor(finalWidth * resizeScale);
    finalHeight = Math.floor(finalHeight * resizeScale);
  }

  // Stable IDs
  const assetId = crypto.randomUUID();
  const objectId = crypto.randomUUID();

  // Register in store for save/load embedding
  useStore.getState().addCustomImage(assetId, base64);

  // Register with PIXI.Assets
  await Assets.load({ alias: assetId, src: base64 });

  // Scale so the longest side spans AUTO_SCALE_CELLS world units (grid cells).
  // PixiJS Sprite scale is a pixel multiplier, so divide desired world size by texture size.
  const worldScale = AUTO_SCALE_CELLS / Math.max(finalWidth, finalHeight);

  const obj: PlacedObject = {
    id: objectId,
    layerId: '',          // caller fills this in
    objectType: 'image',
    assetId,
    position: { x: viewportCenter.x, y: viewportCenter.y },
    rotation: 0,
    scale: worldScale,
    tint: '#ffffff',
    groupId: null,
    flipX: false,
    flipY: false,
  };

  return obj;
}

/**
 * Shared handler called by all three import entry points.
 * Validates the active layer is an images layer, imports the image, and places it.
 */
export async function handleImageImport(file: File, engine: RenderEngine): Promise<void> {
  const store = useStore.getState();

  // Find or auto-create an images layer
  let targetLayerId = store.layers.find((l) => l.type === 'images')?.id;
  if (!targetLayerId) {
    const newLayer = createImagesLayer('Images');
    undoManager.execute(new AddLayerCommand('Add images layer', newLayer));
    useStore.getState().setActiveLayerId(newLayer.id);
    targetLayerId = newLayer.id;
  }

  try {
    const vp = engine.viewport();
    const center = engine.screenToWorld(vp.width / 2, vp.height / 2);

    const obj = await importImageFile(file, center);
    obj.layerId = targetLayerId;

    const cmd = new PlaceObjectCommand('Import image', targetLayerId, obj);
    undoManager.execute(cmd);

    toast.success(`Image imported`);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    toast.error(`Import failed: ${message}`);
  }
}

/**
 * Immediately place an asset at the viewport center without entering placement mode.
 * Creates a PlaceObjectCommand and executes via undoManager.
 */
export function placeAssetAtViewCenter(assetId: string, engine: RenderEngine): void {
  const store = useStore.getState();

  // Find or auto-create an images layer
  let targetLayerId = store.layers.find((l) => l.type === 'images')?.id;
  if (!targetLayerId) {
    const newLayer = createImagesLayer('Images');
    undoManager.execute(new AddLayerCommand('Add images layer', newLayer));
    useStore.getState().setActiveLayerId(newLayer.id);
    targetLayerId = newLayer.id;
  }

  const vp = engine.viewport();
  const center = engine.screenToWorld(vp.width / 2, vp.height / 2);
  const snapped = { x: Math.round(center.x), y: Math.round(center.y) };

  const texture = Assets.get(assetId) as { width?: number } | undefined;
  const scale = texture?.width ? texture.width / 256 : 1;

  const obj: PlacedObject = {
    id: crypto.randomUUID(),
    layerId: targetLayerId,
    objectType: 'image',
    assetId,
    position: snapped,
    rotation: 0,
    scale,
    tint: '#ffffff',
    groupId: null,
    flipX: false,
    flipY: false,
  };

  const cmd = new PlaceObjectCommand('Place at center', targetLayerId, obj);
  undoManager.execute(cmd);
}
