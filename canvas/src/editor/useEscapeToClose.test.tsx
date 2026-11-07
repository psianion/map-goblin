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

  it('leaves a press inside an open menu or popover to it, so the sheet under it stays', () => {
    const onClose = vi.fn();
    renderHook(() => useEscapeToClose(true, onClose, false, true));
    const menu = document.createElement('div');
    menu.setAttribute('data-slot', 'dropdown-menu-content');
    const item = document.createElement('div');
    menu.appendChild(item);
    document.body.appendChild(menu);
    try {
      expect(press('Escape', item).defaultPrevented).toBe(false);
      expect(onClose).not.toHaveBeenCalled();
      press('Escape');
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      menu.remove();
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

  it('closes only what was opened last, one per press', () => {
    const sheet = vi.fn();
    const popover = vi.fn();
    renderHook(() => useEscapeToClose(true, sheet));
    const { unmount } = renderHook(() => useEscapeToClose(true, popover));
    press('Escape');
    expect(popover).toHaveBeenCalledTimes(1);
    expect(sheet).not.toHaveBeenCalled();
    unmount();
    press('Escape');
    expect(sheet).toHaveBeenCalledTimes(1);
    expect(popover).toHaveBeenCalledTimes(1);
  });

  it('leaves a field its own Escape where the top entry asks for that', () => {
    const onClose = vi.fn();
    renderHook(() => useEscapeToClose(true, onClose, false, true));
    const field = document.body.appendChild(document.createElement('input'));
    expect(press('Escape', field).defaultPrevented).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
    press('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
    field.remove();
  });

  it('lets go of the window when unmounted', () => {
    const onClose = vi.fn();
    const { unmount } = renderHook(() => useEscapeToClose(true, onClose));
    unmount();
    press('Escape');
    expect(onClose).not.toHaveBeenCalled();
  });
});
