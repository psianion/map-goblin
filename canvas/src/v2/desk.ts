import type { EditorDesk } from '@dnd/core/src/engine/editorDesk';

/** Fallbacks for each mode, matching v2.css, for when a token cannot be read. */
const FALLBACK: Record<'light' | 'dark', EditorDesk> = {
  light: { desk: '#f2f2f2', dot: '#c6c6c6', sheet: '#fbfbfb', ink: '#1b1b1b' },
  dark: { desk: '#2b2b2b', dot: '#4f4f4f', sheet: '#353535', ink: '#ececec' },
};

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * The editor desk from the v2 tokens (`--v2-bg`, `--v2-dot`, `--v2-sheet`, `--v2-ink`).
 * `read` returns a custom property's computed value; anything that is not a six-digit hex
 * falls back to the mode's default.
 */
export function readDesk(read: (name: string) => string, dark: boolean): EditorDesk {
  const fallback = FALLBACK[dark ? 'dark' : 'light'];
  const pick = (name: string, alt: string): string => {
    const raw = read(name).trim();
    return HEX.test(raw) ? raw.toLowerCase() : alt;
  };
  return {
    desk: pick('--v2-bg', fallback.desk),
    dot: pick('--v2-dot', fallback.dot),
    sheet: pick('--v2-sheet', fallback.sheet),
    ink: pick('--v2-ink', fallback.ink),
  };
}
