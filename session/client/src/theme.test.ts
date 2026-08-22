// The chrome's secondary/muted text is a token, not a per-component choice, so its contrast
// is checked here once rather than trusted dozens of times over. WCAG 2.1 SC 1.4.3 wants
// 4.5:1 for anything under 18px, and every line text-muted carries — "(you)", the token meta
// line, the empty-log placeholder — is 12–14px.
//
// M0 moved every colour off literal raw Tailwind grey classes and onto the Moss semantic
// tokens (`surface-*`, `text-*`, ...), declared in `src/index.css` as raw RGB CSS custom
// properties (`--surface-0: 15 16 14`) so `tailwind.config.ts` can wire `/opacity` support via
// `rgb(var(--x) / <alpha-value>)`. `resolveConfig` only ever returns that literal string, not a
// concrete colour — the variable is resolved by the browser, not by Tailwind — so this test
// pins the same RGB triplets index.css declares rather than reading through the theme. If a
// token value in index.css moves, this file needs the matching update; that coupling is the
// point.

import { describe, expect, it } from 'vitest';

/** WCAG relative luminance from a "R G B" raw-channel triplet, the format index.css uses. */
function luminance(rgb: string): number {
  const channels = rgb.trim().split(/\s+/).map((n) => {
    const c = Number(n) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

/** WCAG contrast ratio, lighter over darker. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Pinned to the `:root` block in `src/index.css` — night, the table's only theme.
const surface0 = '15 16 14';
const surface2 = '35 37 34';
const surface3 = '48 51 46';
const textSecondary = '182 188 179';
const textMuted = '151 158 148';

describe('secondary text contrast', () => {
  it('clears AA for small text on the deepest surface', () => {
    expect(contrastRatio(textMuted, surface0)).toBeGreaterThanOrEqual(4.5);
  });

  // Selected rows raise their surface to surface-3 (chrome-style-guide.md: "selection is a
  // raised surface") — the brightest ground text-muted ever sits on, and where the naive ramp
  // fails first.
  it('clears AA on the raised selection surface too', () => {
    expect(contrastRatio(textMuted, surface3)).toBeGreaterThanOrEqual(4.5);
  });

  it('clears AA on the card surface', () => {
    expect(contrastRatio(textMuted, surface2)).toBeGreaterThanOrEqual(4.5);
  });

  it('stays quieter than the tier above it', () => {
    expect(luminance(textMuted)).toBeLessThan(luminance(textSecondary));
  });
});
