import { describe, it, expect } from 'vitest';
import { strToU8 as encode, zipSync, type Zippable } from 'fflate';
import { packIdOf, PackFileError, PACK_FILE_MAX_BYTES, readPackFile } from './packFile';

// fflate tells a file from a folder with `instanceof Uint8Array`, and under jsdom the
// encoder's bytes come from another realm, so they are copied into this one.
const strToU8 = (s: string) => new Uint8Array(encode(s));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

function manifest(over: Record<string, unknown> = {}) {
  return {
    name: 'Fixture Crates',
    description: 'Two test props',
    version: '1.0.0',
    bundleSize: 16,
    entries: {
      crate_1x1_object_A: { type: 'object', material: 'crate', gridSize: '1x1', pieceType: 'object', variant: 'A', tags: [] },
    },
    atlases: {},
    files: { 'crate_1x1_A-0000.png': { checksum: 'sha256:00', size: PNG.length } },
    theme: ['fantasy'],
    ...over,
  };
}

function zip(files: Zippable): Uint8Array {
  return zipSync(files);
}

function reason(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(PackFileError);
    return (err as Error).message;
  }
  throw new Error('expected a PackFileError');
}

describe('readPackFile', () => {
  it('builds the id, manifest and blob map from a valid zip', () => {
    const pack = readPackFile(zip({ 'manifest.json': strToU8(JSON.stringify(manifest())), 'crate_1x1_A-0000.png': PNG }));
    expect(pack.packId).toBe('fixture-crates');
    expect(pack.manifest.name).toBe('Fixture Crates');
    expect(pack.manifest.theme).toEqual(['fantasy']);
    expect([...pack.blobs.keys()]).toEqual(['crate_1x1_A-0000.png']);
    expect(pack.blobs.get('crate_1x1_A-0000.png')).toEqual(PNG);
  });

  it('reads files at nested paths and leaves out what the manifest does not list', () => {
    const m = manifest({
      files: { 'props/crate_1x1_A-0000.png': { checksum: '', size: 8 } },
      atlases: { 'atlas/a.json': { checksum: '', size: 2 }, 'atlas/a.webp': { checksum: '', size: 8 } },
    });
    const pack = readPackFile(
      zip({
        'manifest.json': strToU8(JSON.stringify(m)),
        props: { 'crate_1x1_A-0000.png': PNG },
        atlas: { 'a.json': strToU8('{}'), 'a.webp': PNG },
        'notes.txt': strToU8('not part of the pack'),
      }),
    );
    expect([...pack.blobs.keys()].sort()).toEqual(['atlas/a.json', 'atlas/a.webp', 'props/crate_1x1_A-0000.png']);
  });

  it('refuses a zip with no manifest', () => {
    expect(reason(() => readPackFile(zip({ 'crate.png': PNG })))).toBe('No manifest.json at the root of the zip');
  });

  it('names the folder when the manifest is one level down', () => {
    const r = reason(() => readPackFile(zip({ crates: { 'manifest.json': strToU8(JSON.stringify(manifest())) } })));
    expect(r).toBe('manifest.json must be at the root of the zip, not in crates/');
  });

  it('refuses a manifest that is not JSON', () => {
    expect(reason(() => readPackFile(zip({ 'manifest.json': strToU8('{ name: nope') })))).toBe('manifest.json is not valid JSON');
  });

  it('refuses a manifest without a name, a version or entries', () => {
    const bad = (over: Record<string, unknown>) =>
      reason(() => readPackFile(zip({ 'manifest.json': strToU8(JSON.stringify(manifest(over))), 'crate_1x1_A-0000.png': PNG })));
    expect(bad({ name: '' })).toBe('manifest.json has no name');
    expect(bad({ version: undefined })).toBe('manifest.json has no version');
    expect(bad({ entries: {} })).toBe('manifest.json lists no entries');
  });

  it('refuses a zip missing a file the manifest references', () => {
    const m = manifest({ files: { 'a.png': { checksum: '', size: 1 }, 'b.png': { checksum: '', size: 1 }, 'c.png': { checksum: '', size: 1 } } });
    const r = reason(() => readPackFile(zip({ 'manifest.json': strToU8(JSON.stringify(m)), 'a.png': PNG })));
    expect(r).toBe('The zip is missing b.png and 1 more');
  });

  it('refuses a file over the size cap before reading it', () => {
    const big = { length: PACK_FILE_MAX_BYTES + 1 } as Uint8Array;
    expect(reason(() => readPackFile(big))).toBe('The file is over 512 MB');
  });

  it('refuses bytes that are not a zip', () => {
    expect(reason(() => readPackFile(strToU8('just some text')))).toBe('Not a zip file');
  });
});

describe('packIdOf', () => {
  it('lowercases and turns anything outside a-z, 0-9 and "-" into "-"', () => {
    expect(packIdOf('GG Forge')).toBe('gg-forge');
    expect(packIdOf('gg_forge')).toBe('gg-forge');
    expect(packIdOf('Crates & Barrels v2')).toBe('crates---barrels-v2');
    expect(packIdOf('already-ok-9')).toBe('already-ok-9');
  });

  it('a name with no letter or digit is refused', () => {
    const r = reason(() => readPackFile(zip({ 'manifest.json': strToU8(JSON.stringify(manifest({ name: '***' }))), 'crate_1x1_A-0000.png': PNG })));
    expect(r).toBe('The pack name needs a letter or a digit');
  });
});
