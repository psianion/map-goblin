import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readMapFile } from './mapFile';

const MAP = { version: '3.0', mapSettings: { name: 'Emberhold Crypt' }, grid: {}, layers: [] };
const JSON_TEXT = JSON.stringify(MAP);

/** The editor's container, built the way canvas/src/io/saveLoad.ts writes it. */
function container(json: string): Blob {
  return new Blob([Buffer.from('MPBLD\0', 'latin1'), gzipSync(Buffer.from(json, 'utf8'))]);
}

describe('readMapFile', () => {
  it('unwraps the editor’s gzipped container back to its JSON', async () => {
    const text = await readMapFile(container(JSON_TEXT));
    expect(JSON.parse(text)).toEqual(MAP);
  });

  it('passes a plain-JSON fixture straight through', async () => {
    expect(await readMapFile(new Blob([JSON_TEXT]))).toBe(JSON_TEXT);
  });

  /**
   * The actual bug: `file.text()` UTF-8-decodes gzip bytes, replacing every invalid sequence
   * with U+FFFD. The result is unparseable, which is how the editor's own save reached the
   * server as "not valid JSON".
   */
  it('does not mangle the container the way file.text() did', async () => {
    const file = container(JSON_TEXT);
    expect(() => JSON.parse(String.fromCharCode(0))).toThrow();
    await expect(file.text().then((t) => JSON.parse(t))).rejects.toThrow();
    expect(JSON.parse(await readMapFile(file))).toEqual(MAP);
  });

  it('treats a file too short to carry the magic as plain text', async () => {
    expect(await readMapFile(new Blob(['{}']))).toBe('{}');
  });
});
