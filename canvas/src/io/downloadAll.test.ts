import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { buildMapsZip, zipEntryNames } from './downloadAll';

describe('download all maps', () => {
  it('names every map as a .ggvtt, numbering repeats', () => {
    expect(zipEntryNames(['Crypt', 'crypt', 'Keep: level 2', '  '])).toEqual([
      'Crypt.ggvtt',
      'crypt (2).ggvtt',
      'Keep_ level 2.ggvtt',
      'Untitled map.ggvtt',
    ]);
  });

  it('zips each map byte for byte', () => {
    const a = new Uint8Array([77, 80, 66, 76, 68, 0, 1, 2]);
    const b = new Uint8Array([123, 125]);
    const files = unzipSync(buildMapsZip([{ name: 'Crypt', bytes: a }, { name: 'Keep', bytes: b }]));
    expect(Object.keys(files)).toEqual(['Crypt.ggvtt', 'Keep.ggvtt']);
    expect(files['Crypt.ggvtt']).toEqual(a);
    expect(files['Keep.ggvtt']).toEqual(b);
  });
});
