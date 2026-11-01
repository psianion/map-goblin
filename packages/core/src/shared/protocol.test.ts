import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

// From process.cwd() (packages/core under vitest), not import.meta.url: the jsdom
// environment hands that back as an http URL.
const ROOT = resolve(process.cwd(), '../..');
const SOURCES = ['packages', 'session', 'bot', 'canvas'];
const SKIP = new Set(['node_modules', 'dist', 'build', 'coverage', 'public']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return SKIP.has(entry.name) || entry.name.startsWith('.') ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe('MapDelta', () => {
  it('is declared once, in protocol.ts, for the server and the client both', () => {
    // Declarations only: an interface, or a type alias. An `import type` names it too.
    const declares = /\binterface\s+MapDelta(?:Layer)?\b|\btype\s+MapDelta(?:Layer)?\s*=/;
    const found = SOURCES.flatMap((top) => sourceFiles(join(ROOT, top)))
      .filter((file) => declares.test(readFileSync(file, 'utf8')))
      .map((file) => relative(ROOT, file).split(sep).join('/'));
    expect(found).toEqual(['packages/core/src/shared/protocol.ts']);
  });
});
