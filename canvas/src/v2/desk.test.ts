import { describe, expect, it } from 'vitest';
import { readDesk } from './desk';

describe('readDesk', () => {
  it('reads the desk, dot, sheet and ink tokens', () => {
    const tokens: Record<string, string> = {
      '--v2-bg': '#F2F2F2',
      '--v2-dot': '#c6c6c6',
      '--v2-sheet': ' #FFFFFF',
      '--v2-ink': '#1b1b1b ',
    };
    expect(readDesk((n) => tokens[n] ?? '', false)).toEqual({
      desk: '#f2f2f2',
      dot: '#c6c6c6',
      sheet: '#ffffff',
      ink: '#1b1b1b',
    });
  });

  it("falls back to the mode's defaults when a token is missing", () => {
    expect(readDesk(() => '', true)).toEqual({
      desk: '#2b2b2b',
      dot: '#4f4f4f',
      sheet: '#353535',
      ink: '#ececec',
    });
    expect(readDesk(() => 'rgb(0 0 0)', false).sheet).toBe('#fbfbfb');
  });
});
