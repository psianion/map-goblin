// src/io/saveLoad.test.ts
// NOTE: Tests run in Vitest (jsdom/node) — FSA API is not available.
// We test the compression/decompression and serialization logic only.
// E2E Playwright tests cover the full browser save/load flow.
import { describe, it, expect, vi } from 'vitest';

// Mock the store to avoid loading the full Zustand chain (layers slice
// imports commands.ts which may not exist in all branch states).
vi.mock('@/store/store', () => ({
  useStore: { getState: vi.fn(() => ({ getSerializableState: vi.fn(), assets: { customUploads: [] } })) },
}));

import {
  serializeToBytes,
  deserializeFromBytes,
  downloadMapFile,
  MAGIC_HEADER,
} from './saveLoad.ts';
import { useStore } from '@/store/store';
import type { SerializedMapData } from '@/store/types';

const SAMPLE_DATA: SerializedMapData = {
  version: '2.0',
  mapSettings: {
    name: 'Test Dungeon',
    gridType: 'square',
    cellScale: { value: 5, unit: 'ft' },
    ambientLight: '#1a1a2e',
  },
  grid: { visible: true, snapDivision: 2, style: 'clean' },
  layers: [],
  customImages: {},
};

describe('saveLoad — serializeToBytes / deserializeFromBytes', () => {
  it('serializeToBytes returns a Uint8Array starting with the magic header', async () => {
    const bytes = await serializeToBytes(SAMPLE_DATA);
    expect(bytes).toBeInstanceOf(Uint8Array);
    const header = new TextDecoder().decode(bytes.slice(0, MAGIC_HEADER.length));
    expect(header).toBe(MAGIC_HEADER);
  });

  it('deserializeFromBytes round-trips the data correctly', async () => {
    const bytes = await serializeToBytes(SAMPLE_DATA);
    const result = await deserializeFromBytes(bytes);
    expect(result.version).toBe('2.0');
    expect(result.mapSettings.name).toBe('Test Dungeon');
    expect(result.layers).toEqual([]);
    expect(result.customImages).toEqual({});
  });

  it('deserializeFromBytes rejects v1.x files with an incompatible version error', async () => {
    const oldData = {
      version: '1.4',
      mapSettings: { name: 'Old Map', gridType: 'square', cellScale: { value: 5, unit: 'ft' }, ambientLight: '#000' },
      grid: { visible: true, snapDivision: 2, style: 'clean' },
      layers: [],
      lights: [],
      placedObjects: [],
      customImages: {},
    };
    const bytes = await serializeToBytes(oldData as unknown as SerializedMapData);
    await expect(deserializeFromBytes(bytes)).rejects.toThrow(/incompatible file version/i);
  });

  it('deserializeFromBytes throws on invalid magic header', async () => {
    const bad = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
    await expect(deserializeFromBytes(bad)).rejects.toThrow(/invalid.*file/i);
  });

  it('serialized bytes are smaller than raw JSON for non-trivial data', async () => {
    const bigData: SerializedMapData = {
      ...SAMPLE_DATA,
      mapSettings: { ...SAMPLE_DATA.mapSettings, name: 'Big Map '.repeat(50) },
    };
    const bytes = await serializeToBytes(bigData);
    const rawJson = new TextEncoder().encode(JSON.stringify(bigData));
    // Gzip should compress repetitive data significantly
    expect(bytes.length).toBeLessThan(rawJson.length);
  });
});

describe('saveLoad — downloadMapFile', () => {
  /** Runs the download and hands back the bytes the blob anchor was given. */
  async function captureDownload(data: SerializedMapData) {
    vi.mocked(useStore.getState).mockReturnValue({
      getSerializableState: () => data,
    } as unknown as ReturnType<typeof useStore.getState>);

    let blob: Blob | undefined;
    const createObjectURL = vi.fn((b: Blob) => {
      blob = b;
      return 'blob:stub';
    });
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL,
      revokeObjectURL: vi.fn(),
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    try {
      const filename = await downloadMapFile();
      return {
        filename,
        anchorClicked: click.mock.calls.length,
        bytes: new Uint8Array(await blob!.arrayBuffer()),
      };
    } finally {
      click.mockRestore();
      vi.unstubAllGlobals();
    }
  }

  it('downloads MPBLD-container bytes that round-trip back to the same map', async () => {
    const { filename, anchorClicked, bytes } = await captureDownload(SAMPLE_DATA);

    // Same container Ctrl+S writes: magic header, then gzip.
    expect(new TextDecoder().decode(bytes.slice(0, MAGIC_HEADER.length))).toBe(MAGIC_HEADER);
    expect(Array.from(bytes.slice(MAGIC_HEADER.length, MAGIC_HEADER.length + 2))).toEqual([
      0x1f, 0x8b,
    ]);
    await expect(deserializeFromBytes(bytes)).resolves.toEqual(SAMPLE_DATA);

    // Byte-identical to the shortcut path, and delivered without a native picker.
    expect(bytes).toEqual(await serializeToBytes(SAMPLE_DATA));
    expect(anchorClicked).toBe(1);
    expect(filename).toBe('Test Dungeon.mapbuilder');
  });

  it('sanitises the map name into the filename', async () => {
    const { filename } = await captureDownload({
      ...SAMPLE_DATA,
      mapSettings: { ...SAMPLE_DATA.mapSettings, name: 'Crypt: level 2/3' },
    });
    expect(filename).toBe('Crypt_ level 2_3.mapbuilder');
  });
});
