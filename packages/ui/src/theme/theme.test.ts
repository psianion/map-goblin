import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, initTheme, readThemeChoice, toggleTheme } from './theme';

const isDark = () => document.documentElement.classList.contains('dark');

afterEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  vi.unstubAllGlobals();
});

describe('theme', () => {
  it('is light with nothing stored', () => {
    initTheme();
    expect(readThemeChoice()).toBe('light');
    expect(isDark()).toBe(false);
  });

  it('moves a v2-theme value to gg-theme on first read', () => {
    localStorage.setItem('v2-theme', 'dark');
    initTheme();
    expect(isDark()).toBe(true);
    expect(localStorage.getItem('gg-theme')).toBe('dark');
    expect(localStorage.getItem('v2-theme')).toBeNull();
  });

  it('prefers gg-theme over a leftover v2-theme', () => {
    localStorage.setItem('gg-theme', 'light');
    localStorage.setItem('v2-theme', 'dark');
    expect(readThemeChoice()).toBe('light');
  });

  it('toggles and stores the choice', () => {
    toggleTheme();
    expect(isDark()).toBe(true);
    expect(localStorage.getItem('gg-theme')).toBe('dark');
    toggleTheme();
    expect(isDark()).toBe(false);
    expect(localStorage.getItem('gg-theme')).toBe('light');
  });

  it('follows the OS when the choice is system', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('dark'), addEventListener: () => {} }));
    applyTheme('system');
    expect(readThemeChoice()).toBe('system');
    expect(isDark()).toBe(true);
  });
});
