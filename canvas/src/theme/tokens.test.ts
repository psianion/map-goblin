import { describe, expect, it } from 'vitest';

// Vitest runs from canvas/, and the app tsconfig carries no node types, so fs comes in
// untyped the way the other file-reading tests take it.
type Entry = { name: string; isDirectory(): boolean };
type Fs = {
  readFileSync(path: string, encoding: 'utf8'): string;
  readdirSync(path: string, options: { withFileTypes: true }): Entry[];
};
const loadFs = async () => (await import('node:fs' as string)) as Fs;
const SELF = 'src/theme/tokens.test.ts';

/** The 16 tokens of the plan's table (docs/plans/canvas-v2-shell, 4.1), light then dark. */
const TOKENS: Record<string, [string, string]> = {
  bg: ['#f2f2f2', '#2b2b2b'],
  dot: ['#c6c6c6', '#4f4f4f'],
  sheet: ['#fbfbfb', '#353535'],
  panel: ['#ffffff', '#333333'],
  'panel-2': ['#f7f7f7', '#383838'],
  'panel-3': ['#ebebeb', '#444444'],
  line: ['#e0e0e0', '#474747'],
  'line-strong': ['#c2c2c2', '#5c5c5c'],
  text: ['#1b1b1b', '#ececec'],
  'text-2': ['#4d4d4d', '#bdbdbd'],
  'text-3': ['#6b6b6b', '#9c9c9c'],
  ink: ['#1b1b1b', '#ececec'],
  'on-ink': ['#ffffff', '#1b1b1b'],
  'ink-hover': ['#383838', '#ffffff'],
  focus: ['rgb(27 27 27 / 0.14)', 'rgb(236 236 236 / 0.18)'],
  danger: ['#b3261e', '#f08a7e'],
};

function block(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`\n${selector} {`);
  expect(start, `${selector} block`).toBeGreaterThan(-1);
  const body = css.slice(start, css.indexOf('}', start));
  const vars: Record<string, string> = {};
  for (const m of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
}

function sourceFiles(fs: Fs, dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(fs, path);
    return /\.(tsx?|css)$/.test(entry.name) && path !== SELF ? [path] : [];
  });
}

// The Moss theme's colour names, its shadcn vocabulary, its other utilities, and its serif.
const MOSS_COLOURS = [
  'surface-[0-3]', 'text-primary', 'text-secondary', 'text-muted', 'text-dim',
  'border-structure', 'border-default', 'border-subtle', 'border-focus',
  'accent-active', 'accent-dim', 'on-accent', 'warning', 'success', 'info',
  'background', 'foreground', 'card(?:-foreground)?', 'popover(?:-foreground)?',
  'primary(?:-foreground)?', 'secondary(?:-foreground)?', 'muted(?:-foreground)?',
  'accent(?:-foreground)?', 'destructive', 'border', 'input', 'ring',
].join('|');
const MOSS_VAR = new RegExp(`(?<![\\w-])--(?:${MOSS_COLOURS}|hover-tint|hover-glow|panel-shadow|radius(?:-md|-sm)?)(?![\\w-])`, 'g');
const MOSS_CLASS = new RegExp(
  `(?<![\\w-])(?:bg|text|border|ring|ring-offset|outline|fill|stroke|divide|placeholder|from|via|to|shadow|caret|decoration)-(?:${MOSS_COLOURS})(?:/\\d+)?(?![\\w-])`,
  'g',
);
const MOSS_OTHER = /(?<![\w-])(?:gg-grain|gg-row|shadow-panel|font-display|text-(?:panel-(?:heading|label|body|small)|tab-label|strip-label)|Newsreader)(?![\w-])/g;

describe('theme tokens', () => {
  it('defines the 16 tokens with the plan values, light on :root and dark on .dark', async () => {
    const css = (await loadFs()).readFileSync('../packages/ui/src/theme/tokens.css', 'utf8');
    const light = block(css, ':root');
    const dark = block(css, '.dark');
    for (const [name, [l, d]] of Object.entries(TOKENS)) {
      expect(light[name], `--${name} light`).toBe(l);
      expect(dark[name], `--${name} dark`).toBe(d);
    }
  });

  it('leaves no Moss token name anywhere in canvas/src', async () => {
    const fs = await loadFs();
    const hits: string[] = [];
    for (const file of sourceFiles(fs, 'src')) {
      const text = fs.readFileSync(file, 'utf8');
      for (const re of [MOSS_VAR, MOSS_CLASS, MOSS_OTHER]) {
        for (const m of text.matchAll(re)) hits.push(`${file}: ${m[0]}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
