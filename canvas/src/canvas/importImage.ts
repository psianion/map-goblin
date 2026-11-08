/**
 * Image import pipeline — file validation, base64 conversion, resize-if-oversized,
 * PIXI.Assets registration, and AddChildCommand dispatch.
 *
 * All three entry points (file picker, drag-and-drop, clipboard paste) call
 * handleImageImport(file, engine).
 */

import { Assets } from 'pixi.js';
import { notify } from '@dnd/ui/toast';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import { AddChildCommand } from '@/store/commands';
import type { AssetChild } from '@/store/types';
import type { RenderEngine } from '@/engine/RenderEngine';
import { blockedLayerReason } from '@dnd/core/src/engine/tools/layerGuard';
import { AddTraceLayerCommand } from '@dnd/core/src/store/layerCommands';
import { createImageLayer } from '@dnd/core/src/store/factories';
import { shownLevelId } from '@/store/selectors';
import { keyCaption } from '@/shortcuts/formatCombo';
import { GUESS_PX_PER_CELL } from '@/canvas/battlemapSize';

const VALID_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];
const MAX_IMPORT_PX = 4096;
const RESIZE_TARGET_PX = 2048;
const AUTO_SCALE_CELLS = 5;

/**
 * What the file actually is, read from its first bytes rather than its name.
 *
 * `file.type` is the OS's guess from the extension, and it is wrong often enough to
 * matter: Chrome on Windows saves web JPEGs as `.jfif`, and any extension the machine
 * has no mapping for arrives as `application/octet-stream` or an empty string. A DM's
 * downloaded battlemap is exactly that file, so trusting `file.type` turns away images
 * that decode perfectly well.
 */
function sniffImageType(head: Uint8Array, text: string): string | null {
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
    return 'image/png';
  }
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  const riff = head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46;
  const webp = head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50;
  if (riff && webp) return 'image/webp';
  // SVG is text; it may open with a BOM, a declaration, a doctype, or a comment.
  if (/^[\s\uFEFF]*(<\?xml|<!--|<!doctype svg|<svg)/i.test(text)) {
    return 'image/svg+xml';
  }
  return null;
}

/**
 * A supported image carrying a MIME type we can trust, or null if the bytes are not an
 * image at all. Re-wraps the file when the OS mislabelled it, because the type travels:
 * `fileToBase64` bakes it into the data URL, and `data:application/octet-stream` will
 * not render no matter how good the pixels are.
 */
export async function normalizeImageFile(file: File): Promise<File | null> {
  const slice = file.slice(0, 16);
  const head = new Uint8Array(await slice.arrayBuffer());
  const sniffed = sniffImageType(head, await slice.text());
  if (sniffed) return file.type === sniffed ? file : new File([file], file.name, { type: sniffed });
  // Unreadable signature: fall back to a type the OS was confident about, so anything
  // that used to import still does.
  return VALID_TYPES.includes(file.type) ? file : null;
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Shrink a data URL so its long edge is at most `maxPx`. PNG keeps alpha for props;
 * a battlemap has none and is many times smaller as WebP.
 */
export async function resizeImageToMax(
  base64: string,
  maxPx: number,
  type: 'image/png' | 'image/webp' = 'image/png',
): Promise<string> {
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
  const outputBlob = await canvas.convertToBlob(type === 'image/webp' ? { type, quality: 0.9 } : { type });
  return fileToBase64(new File([outputBlob], 'resized', { type }));
}

/** Room-note handouts stay small — they ride the map file as base64 and only ever render
 *  inside a panel, never on the canvas. */
const NOTE_IMAGE_MAX_PX = 1024;

/**
 * A room note's image: validate, downscale to panel size, store in `customImages`, hand
 * back the key the note references. No PIXI registration and no AssetChild — a note image
 * is never drawn on the map.
 */
export async function importNoteImage(input: File): Promise<string> {
  const file = await normalizeImageFile(input);
  if (!file) {
    throw new Error(`Unsupported image format: ${input.type}. Use PNG, JPEG, SVG, or WebP.`);
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

/** How big the imported picture should land. See `ImportOptions.asBattlemap`. */
export interface ImportOptions {
  /**
   * The picture IS the map, not a prop dropped on one: size it from the grid a
   * battlemap is assumed to be drawn at, rather than shrinking it to a few cells.
   */
  asBattlemap?: boolean;
  /**
   * For a battlemap: the image pixels one grid square measures, from the New map dialog's
   * size. The 70 px guess when absent; the line-up makes it exact either way.
   */
  pxPerCell?: number;
}

/**
 * A picture for a placed image: validated, shrunk past the import limit, stored in
 * `customImages` and registered with PIXI under a new key, which comes back with the
 * picture's file name and its own pixel size. Throws for a file that is not an image.
 */
export async function readPictureFile(input: File): Promise<{ assetId: string; imageSource: NonNullable<AssetChild['imageSource']> }> {
  const file = await normalizeImageFile(input);
  if (!file) {
    throw new Error(`Unsupported image format: ${input.type}. Use PNG, JPEG, SVG, or WebP.`);
  }

  const bitmap = await createImageBitmap(file);
  const srcWidth = bitmap.width;
  const srcHeight = bitmap.height;
  bitmap.close();

  let base64 = await fileToBase64(file);

  // The downscale only thins the texture out; it shrinks the printed grid with
  // everything else, so the world footprint below stays on the source pixels.
  if (srcWidth > MAX_IMPORT_PX || srcHeight > MAX_IMPORT_PX) {
    notify.warning(
      `Image is ${srcWidth}\u00d7${srcHeight}px \u2014 resizing to max ${RESIZE_TARGET_PX}px for performance.`,
    );
    base64 = await resizeImageToMax(base64, RESIZE_TARGET_PX);
  }

  const assetId = crypto.randomUUID();

  useStore.getState().addCustomImage(assetId, base64);
  await Assets.load({ alias: assetId, src: base64 });
  return { assetId, imageSource: { fileName: input.name, width: srcWidth, height: srcHeight } };
}

/**
 * Core import pipeline: the picture read by `readPictureFile`, as an AssetChild sized as a
 * prop or a battlemap.
 */
export async function importImageFile(
  input: File,
  viewportCenter: { x: number; y: number },
  { asBattlemap = false, pxPerCell }: ImportOptions = {},
): Promise<AssetChild> {
  const { assetId, imageSource } = await readPictureFile(input);
  const srcWidth = imageSource.width;
  const srcHeight = imageSource.height;

  // World cells per source pixel. `width`/`height` are the footprint in cells and
  // `scale` is the multiplier on top - the convention every consumer reads as
  // `width * scale` (sprite sync, hit test, bounds), so the factor belongs in one
  // of the two, never both.
  const cellsPerPx = asBattlemap
    ? 1 / (pxPerCell && pxPerCell > 0 ? pxPerCell : GUESS_PX_PER_CELL)
    : AUTO_SCALE_CELLS / Math.max(srcWidth, srcHeight);
  const width = srcWidth * cellsPerPx;
  const height = srcHeight * cellsPerPx;

  const child: AssetChild = {
    id: crypto.randomUUID(),
    name: `Image ${assetId.slice(0, 4)}`,
    childType: 'asset',
    visible: true,
    objectType: 'image',
    assetId,
    // A battlemap is the map: its top-left corner on the map origin, where a fixed size is
    // anchored, rather than wherever the camera happened to be.
    position: asBattlemap ? { x: width / 2, y: height / 2 } : { x: viewportCenter.x, y: viewportCenter.y },
    rotation: 0,
    scale: 1,
    width,
    height,
    tint: '#ffffff',
    flipX: false,
    flipY: false,
    // The texture may be a downscale; the line-up and the Battlemap sheet read the original.
    imageSource,
  };

  return child;
}

/**
 * Shared handler called by all three import entry points.
 * Places the imported image as an AssetChild on the active dungeon layer.
 *
 * Returns the new child's id, or null if nothing was placed — the three
 * shortcut entry points ignore it; a caller that wants to follow the import
 * with grid calibration (`startGridCalibration`) needs it.
 */
export async function handleImageImport(
  file: File,
  engine: RenderEngine,
  options: ImportOptions = {},
): Promise<string | null> {
  const store = useStore.getState();

  const targetLayerId = store.ui.activeLayerId;
  const layer = store.layers.find((l) => l.id === targetLayerId);
  if (!layer || layer.type !== 'dungeon') {
    notify.error('Select a dungeon layer to import images.');
    return null;
  }
  // File picker, drag-and-drop and clipboard paste all funnel through here, so
  // this one guard closes all three against a locked or hidden target layer.
  const blocked = blockedLayerReason(layer);
  if (blocked) {
    notify.warning(blocked);
    return null;
  }

  try {
    const vp = engine.viewport();
    const center = engine.screenToWorld(vp.width / 2, vp.height / 2);

    const child = await importImageFile(file, center, options);
    undoManager.execute(new AddChildCommand('Import image', targetLayerId, child));
    // An imported picture is an asset the user is likely to place again, and the
    // browser's Recent tab is where they would look for it. Nothing on the
    // import path recorded the use, so imports never showed up there.
    store.trackRecentUse(child.assetId);

    notify.success('Image imported');
    return child.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    notify.error(`Import failed: ${message}`);
    return null;
  }
}

/**
 * A picture for a trace layer, stored in `customImages`: validated, shrunk only past the
 * import limit (a trace is drawn over, so it keeps its detail), and its key handed back with
 * the file's name. Null, with a toast, when the file is not an image.
 */
export async function readTraceFile(input: File): Promise<{ imageKey: string; fileName: string } | null> {
  const file = await normalizeImageFile(input);
  if (!file) {
    notify.error(`Unsupported image format: ${input.type}. Use PNG, JPEG, SVG, or WebP.`);
    return null;
  }
  let base64 = await fileToBase64(file);
  const bitmap = await createImageBitmap(file);
  const oversized = bitmap.width > MAX_IMPORT_PX || bitmap.height > MAX_IMPORT_PX;
  bitmap.close();
  if (oversized) base64 = await resizeImageToMax(base64, MAX_IMPORT_PX, 'image/webp');
  const imageKey = crypto.randomUUID();
  useStore.getState().addCustomImage(imageKey, base64);
  return { imageKey, fileName: input.name };
}

/**
 * The More menu's Import as trace: the picture as a background image layer at the bottom of
 * the level on show, at 40%, one undo step. Returns the new layer's id, or null.
 */
export async function importTraceImage(file: File): Promise<string | null> {
  try {
    const picture = await readTraceFile(file);
    if (!picture) return null;
    const layer = createImageLayer(shownLevelId(useStore.getState()), picture.imageKey, picture.fileName);
    undoManager.execute(new AddTraceLayerCommand(layer));
    notify.success(`Trace added · ${keyCaption('view.traceToggle')} hides and shows it`);
    return layer.id;
  } catch (err) {
    notify.error(`Import failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    return null;
  }
}
