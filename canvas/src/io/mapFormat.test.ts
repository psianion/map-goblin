import { describe, expect, it } from 'vitest';
import { gzipSync, strToU8 } from 'fflate';
import type { SerializedMapData } from '@/store/types';
import { SPLAT_IMAGE_KEYS } from '@dnd/core/src/engine/terrain/terrainShared';
import { MAGIC_HEADER, bytesToBase64, decodeMapFile, encodeMapFile } from './mapFormat';

function doc(customImages: Record<string, string> = {}): SerializedMapData {
  return {
    version: '3.0',
    mapSettings: { name: 'T', gridType: 'square', cellScale: { value: 5, unit: 'ft' }, ambientLight: '#000000' },
    grid: { visible: true, snapDivision: 2 },
    layers: [],
    customImages,
  };
}

describe('mapFormat', () => {
  it('round-trips a document', () => {
    const data = doc({ pic: 'data:image/png;base64,aGk=' });
    expect(decodeMapFile(encodeMapFile(data))).toEqual(data);
  });

  it('injects splat PNGs as data URLs under the legacy keys', () => {
    const png = new Uint8Array([137, 80, 78, 71]);
    const out = decodeMapFile(encodeMapFile(doc(), [png, null]));
    expect(out.customImages[SPLAT_IMAGE_KEYS[0]]).toBe(
      `data:image/png;base64,${bytesToBase64(png)}`,
    );
    expect(out.customImages[SPLAT_IMAGE_KEYS[1]]).toBeUndefined();
  });

  it('does not mutate the input document when injecting', () => {
    const data = doc();
    encodeMapFile(data, [new Uint8Array([1]), null]);
    expect(data.customImages).toEqual({});
  });

  it('rejects bytes without the magic header', () => {
    expect(() => decodeMapFile(strToU8('not a map'))).toThrow(/unrecognized header/);
  });

  it('rejects incompatible versions', () => {
    const bad = { ...doc(), version: '1.0' };
    const bytes = new Uint8Array([
      ...new TextEncoder().encode(MAGIC_HEADER),
      ...gzipSync(strToU8(JSON.stringify(bad))),
    ]);
    expect(() => decodeMapFile(bytes)).toThrow(/Incompatible file version/);
  });

  it('bytesToBase64 survives multi-chunk input', () => {
    const big = new Uint8Array(0x8000 * 2 + 3).fill(65);
    expect(atob(bytesToBase64(big)).length).toBe(big.length);
  });
});
