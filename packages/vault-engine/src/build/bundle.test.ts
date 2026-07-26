// packages/engine/src/build/bundle.test.ts
import { describe, it, expect, afterAll } from 'vitest';
import { writeBundle } from './bundle.js';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_DIR = join(tmpdir(), 'bundle-test-' + Date.now());

describe('writeBundle', () => {
  afterAll(async () => { await rm(TEST_DIR, { recursive: true, force: true }); });

  it('writes files to correct paths and returns them', async () => {
    const files = new Map([
      ['atlas.webp', Buffer.from('atlas-data')],
      ['sub/manifest.json', Buffer.from('{}')],
    ]);
    const written = await writeBundle({ packName: 'test', version: '1.0.0', outputDir: TEST_DIR, files });
    expect(written).toHaveLength(2);
    const content = await readFile(join(TEST_DIR, 'test', 'atlas.webp'), 'utf-8');
    expect(content).toBe('atlas-data');
  });
});
