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

import { serializeToBytes, deserializeFromBytes, MAGIC_HEADER } from './saveLoad.ts';
import type { SerializedMapData } from '@/store/types';

const SAMPLE_DATA: SerializedMapData = {
  version: '1.1',
  mapSettings: {
    name: 'Test Dungeon',
    gridType: 'square',
    cellScale: { value: 5, unit: 'ft' },
    ambientLight: '#1a1a2e',
  },
  grid: { visible: true, snapDivision: 2, style: 'clean' },
  layers: [],
  lights: [],
  placedObjects: [],
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
    expect(result.version).toBe('1.1');
    expect(result.mapSettings.name).toBe('Test Dungeon');
    expect(result.lights).toEqual([]);
    expect(result.placedObjects).toEqual([]);
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
