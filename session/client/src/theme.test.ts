// The chrome's secondary text is a token, not a per-component choice, so its contrast is
// checked here once rather than trusted 27 times over. WCAG 2.1 SC 1.4.3 wants 4.5:1 for
// anything under 18px, and every line this shade carries — "(you)", the token meta line,
// the empty-log placeholder — is 12–14px.

import { describe, expect, it } from 'vitest';
import resolveConfig from 'tailwindcss/resolveConfig';
import config from '../tailwind.config';

/** WCAG relative luminance of an #rrggbb colour. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** WCAG contrast ratio, lighter over darker. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const theme = resolveConfig(config).theme;
const neutral = theme.colors.neutral as Record<string, string>;
const surface0 = theme.colors['surface-0'] as string;

describe('secondary text contrast', () => {
  it('clears AA for small text on the deepest surface', () => {
    expect(contrastRatio(neutral['500'], surface0)).toBeGreaterThanOrEqual(4.5);
  });

  // The panels are darker than surface-2, so this is the brightest ground the shade ever
  // sits on. Pinned so a future surface tweak cannot quietly take the text back under AA.
  it('clears AA on the panel surfaces too', () => {
    expect(contrastRatio(neutral['500'], theme.colors['surface-2'] as string)).toBeGreaterThanOrEqual(4.5);
  });

  // Overriding one shade must extend Tailwind's scale, not replace it: `neutral-400`,
  // `neutral-800` and friends are load-bearing all over the chrome.
  it('keeps the rest of the neutral scale', () => {
    expect(neutral['400']).toBe('#a3a3a3');
    expect(neutral['800']).toBe('#262626');
  });

  it('stays quieter than the tier above it', () => {
    expect(luminance(neutral['500'])).toBeLessThan(luminance(neutral['400']));
  });
});
