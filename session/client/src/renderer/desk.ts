import type { EditorDesk } from '@dnd/core/src/engine/editorDesk';

/** Fallbacks for each mode, matching tokens.css, for when a token cannot be read. */
const FALLBACK: Record<'light' | 'dark', EditorDesk> = {
  light: { desk: '#f2f2f2', dot: '#c6c6c6', sheet: '#fbfbfb', ink: '#1b1b1b' },
  dark: { desk: '#2b2b2b', dot: '#4f4f4f', sheet: '#353535', ink: '#ececec' },
};

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * The editor desk from the design-system tokens (`--bg`, `--dot`, `--sheet`, `--ink`).
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
    desk: pick('--bg', fallback.desk),
    dot: pick('--dot', fallback.dot),
    sheet: pick('--sheet', fallback.sheet),
    ink: pick('--ink', fallback.ink),
  };
}

/**
 * Lay the table's map on the theme's desk, lit (the table always shows the map's lighting),
 * and follow the `dark` class on <html> as the theme changes. Returns the undo.
 */
export function installTableDesk(setDesk: (desk: EditorDesk | null) => void): () => void {
  const root = document.documentElement;
  const apply = (): void => {
    const css = getComputedStyle(root);
    setDesk({ ...readDesk((name) => css.getPropertyValue(name), root.classList.contains('dark')), lit: true, wallMarks: false, gridSubdivisions: false });
  };
  apply();
  const observer = new MutationObserver(apply);
  observer.observe(root, { attributes: true, attributeFilter: ['class'] });
  return () => {
    observer.disconnect();
    setDesk(null);
  };
}
