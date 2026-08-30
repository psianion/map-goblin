import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { Assets } from 'pixi.js';

vi.mock('@/lib/toast', () => ({
  notify: {
    subtle: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

import { notify } from '@/lib/toast';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import type { DungeonLayer } from '@/store/types';
import type { RenderEngine } from '@/engine/RenderEngine';
import { handleImageImport, importImageFile, normalizeImageFile } from './importImage';

function layer(): DungeonLayer {
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon');
  if (!l) throw new Error('default state has no dungeon layer');
  return l;
}

function pngFile(): File {
  return new File(['not-really-a-png'], 'note.png', { type: 'image/png' });
}

// The guard refuses before the engine is ever touched — a bare stub proves it.
const engine = {} as RenderEngine;

// Drag-and-drop, clipboard paste and the Ctrl+I picker all funnel through
// handleImageImport, so this one guard is what stands between all three and a
// locked layer.
describe('handleImageImport — layer lock', () => {
  beforeEach(() => {
    undoManager.clear();
    useStore.getState().resetToDefault();
    vi.clearAllMocks();
    useStore.getState().setActiveLayerId(layer().id);
  });

  it('refuses on a locked layer', async () => {
    useStore.getState().updateLayer(layer().id, { locked: true });

    await handleImageImport(pngFile(), engine);

    expect(notify.warning).toHaveBeenCalledWith('Layer is locked');
    expect(layer().children).toHaveLength(0);
    expect(undoManager.canUndo()).toBe(false);
  });

  it('refuses on a hidden layer', async () => {
    useStore.getState().updateLayer(layer().id, { visible: false });

    await handleImageImport(pngFile(), engine);

    expect(notify.warning).toHaveBeenCalledWith('Layer is hidden');
    expect(layer().children).toHaveLength(0);
    expect(undoManager.canUndo()).toBe(false);
  });
});

// `width`/`height` are the footprint and `scale` multiplies them — every consumer
// reads `width * scale` (sprite sync, hit test, child bounds). Baking the factor
// into both squared it and the import rendered at ~1/200th of its intended size,
// so these assert the product, never the raw field.
describe('importImageFile — world footprint', () => {
  const SRC = { width: 736, height: 1035 };

  beforeEach(() => {
    useStore.getState().resetToDefault();
    vi.spyOn(Assets, 'load').mockResolvedValue({});
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ ...SRC, close: () => {} })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('lands a prop at AUTO_SCALE_CELLS on its longest side', async () => {
    const child = await importImageFile(pngFile(), { x: 0, y: 0 });
    expect(child.height * child.scale).toBeCloseTo(5, 6);
    expect(child.width * child.scale).toBeCloseTo((5 * SRC.width) / SRC.height, 6);
  });

  it('lands a battlemap at the size its assumed printed grid implies', async () => {
    const child = await importImageFile(pngFile(), { x: 0, y: 0 }, { asBattlemap: true });
    // 70px per cell — a 736x1035 map is ~10.5 x 14.8 cells, not a 5-cell prop.
    expect(child.width * child.scale).toBeCloseTo(736 / 70, 6);
    expect(child.height * child.scale).toBeCloseTo(1035 / 70, 6);
  });
});

describe('normalizeImageFile', () => {
  const jpegHead = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46];
  const pngHead = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];
  const webpHead = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];

  function fileOf(bytes: number[], name: string, type: string) {
    return new File([new Uint8Array(bytes)], name, { type });
  }

  it('trusts the bytes when the OS mislabels a JPEG (the .jfif case)', async () => {
    // Chrome on Windows saves web JPEGs as .jfif; a machine with no mapping for that
    // extension reports application/octet-stream, and the DM's battlemap gets refused.
    const out = await normalizeImageFile(
      fileOf(jpegHead, 'battlemap.jfif', 'application/octet-stream'),
    );
    expect(out).not.toBeNull();
    expect(out!.type).toBe('image/jpeg');
    expect(out!.name).toBe('battlemap.jfif');
  });

  it('corrects an empty type too', async () => {
    const out = await normalizeImageFile(fileOf(pngHead, 'map', ''));
    expect(out?.type).toBe('image/png');
  });

  it('recognises png, jpeg, webp and svg by signature', async () => {
    expect((await normalizeImageFile(fileOf(pngHead, 'a', '')))?.type).toBe('image/png');
    expect((await normalizeImageFile(fileOf(jpegHead, 'b', '')))?.type).toBe('image/jpeg');
    expect((await normalizeImageFile(fileOf(webpHead, 'c', '')))?.type).toBe('image/webp');
    const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'd', { type: '' });
    expect((await normalizeImageFile(svg))?.type).toBe('image/svg+xml');
  });

  it('passes a correctly typed file straight through, unwrapped', async () => {
    const original = fileOf(pngHead, 'e.png', 'image/png');
    expect(await normalizeImageFile(original)).toBe(original);
  });

  it('rejects something that is not an image', async () => {
    const notAnImage = new File(['just some text, not a map'], 'notes.txt', { type: '' });
    expect(await normalizeImageFile(notAnImage)).toBeNull();
  });

  it('still accepts a file the OS typed correctly even if the signature is unreadable', async () => {
    // A tiny/odd file we cannot sniff should not become less importable than it was.
    const stub = new File([new Uint8Array([1, 2])], 'f.png', { type: 'image/png' });
    expect(await normalizeImageFile(stub)).toBe(stub);
  });
});
