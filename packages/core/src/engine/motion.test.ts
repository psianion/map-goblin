import { describe, it, expect, afterEach, vi } from 'vitest';
import { prefersReducedMotion } from './motion';

describe('prefersReducedMotion', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads the OS preference through matchMedia', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
    }));
    expect(prefersReducedMotion()).toBe(true);
  });

  it('is false when the OS has no such preference', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    expect(prefersReducedMotion()).toBe(false);
  });
});
