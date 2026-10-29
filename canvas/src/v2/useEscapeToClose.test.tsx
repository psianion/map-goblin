import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { useEscapeToClose } from './useEscapeToClose';

const press = (key: string, target: EventTarget = document.body) => {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
};

describe('useEscapeToClose', () => {
  afterEach(() => cleanup());

  it('closes on Escape and keeps the key from the document', () => {
    const onClose = vi.fn();
    const heard = vi.fn();
    document.addEventListener('keydown', heard, true);
    try {
      renderHook(() => useEscapeToClose(true, onClose));
      const e = press('Escape');
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(e.defaultPrevented).toBe(true);
      expect(heard).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', heard, true);
    }
  });

  it('ignores other keys and does nothing while closed', () => {
    const onClose = vi.fn();
    const { rerender } = renderHook(({ open }) => useEscapeToClose(open, onClose), { initialProps: { open: true } });
    expect(press('Enter').defaultPrevented).toBe(false);
    rerender({ open: false });
    expect(press('Escape').defaultPrevented).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('swallows Escape without closing while blocked', () => {
    const onClose = vi.fn();
    const { rerender } = renderHook(({ blocked }) => useEscapeToClose(true, onClose, blocked), {
      initialProps: { blocked: true },
    });
    expect(press('Escape').defaultPrevented).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    rerender({ blocked: false });
    press('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('lets go of the window when unmounted', () => {
    const onClose = vi.fn();
    const { unmount } = renderHook(() => useEscapeToClose(true, onClose));
    unmount();
    press('Escape');
    expect(onClose).not.toHaveBeenCalled();
  });
});
