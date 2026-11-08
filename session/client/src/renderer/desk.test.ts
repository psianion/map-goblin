import { afterEach, describe, expect, it, vi } from 'vitest';
import { installTableDesk, readDesk } from './desk';

describe('readDesk', () => {
  it('takes hex tokens and falls back per mode', () => {
    const desk = readDesk((n) => (n === '--bg' ? '#ABCDEF' : 'nope'), true);
    expect(desk).toEqual({ desk: '#abcdef', dot: '#4f4f4f', sheet: '#353535', ink: '#ececec' });
  });
});

describe('installTableDesk', () => {
  afterEach(() => document.documentElement.classList.remove('dark'));

  it('installs a lit desk and re-reads it when the dark class flips', async () => {
    const set = vi.fn();
    const undo = installTableDesk(set);
    expect(set).toHaveBeenLastCalledWith(expect.objectContaining({ lit: true, wallMarks: false, desk: '#f2f2f2' }));
    document.documentElement.classList.add('dark');
    await new Promise((r) => setTimeout(r, 0));
    expect(set).toHaveBeenLastCalledWith(expect.objectContaining({ lit: true, desk: '#2b2b2b' }));
    undo();
    expect(set).toHaveBeenLastCalledWith(null);
  });
});
