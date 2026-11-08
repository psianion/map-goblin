import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { PROTOCOL_VERSION, type ClientMessage, type Mark, type ServerMessage } from './protocol';

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

describe('protocol v6 (table v2)', () => {
  it('is version 6, and the server and the bot say so too', () => {
    expect(PROTOCOL_VERSION).toBe(6);
    for (const file of ['session/server/src/config.ts', 'bot/src/goblin/observer.ts']) {
      expect(readFileSync(join(ROOT, file), 'utf8')).toMatch(/PROTOCOL_VERSION[^=]*= 6\b/);
    }
  });

  it('carries marks both ways, roll request nudges and ended effects', () => {
    const marks: Mark[] = [
      { kind: 'ping', x: 1, y: 2, pull: true },
      { kind: 'ruler', from: { x: 0, y: 0 }, to: { x: 3, y: 4 } },
      { kind: 'template', shape: 'cone', origin: { x: 0, y: 0 }, size: 3, toward: { x: 1, y: 0 } },
      { kind: 'draw', points: [[0, 0], [1, 1]], ttl: 5000 },
    ];
    const out: ClientMessage[] = marks.map((mark) => ({ type: 'mark', mark }));
    const back: ServerMessage[] = [
      { type: 'mark', event: { id: 'm', from: 'p1', at: 0, sceneId: null, ttlMs: 3000, mark: marks[0] } },
      { type: 'roll-requested', request: { requestId: 'q', label: 'Perception check', dc: 14, targets: ['p1'] } },
      { type: 'effects-ended', sceneId: 's', ended: [{ tokenId: 't', tokenName: 'Bram', name: 'Bless' }] },
    ];
    // Round-trips as JSON: the wire is JSON and nothing here may need more than that.
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
    expect(back.map((m) => m.type)).toEqual(['mark', 'roll-requested', 'effects-ended']);
  });
});
