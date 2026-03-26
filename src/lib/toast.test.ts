import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { toast } from 'sonner';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(() => 'toast-id-1'), {
    success: vi.fn(() => 'toast-id-2'),
    error: vi.fn(() => 'toast-id-3'),
    warning: vi.fn(() => 'toast-id-4'),
    info: vi.fn(() => 'toast-id-5'),
    dismiss: vi.fn(),
  }),
}));

describe('notify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('subtle calls toast() with 1500ms duration', async () => {
    const { notify } = await import('./toast');
    notify.subtle('Undo');
    expect(toast).toHaveBeenCalledWith('Undo', expect.objectContaining({ duration: 1500 }));
  });

  it('success calls toast.success with 2000ms duration', async () => {
    const { notify } = await import('./toast');
    notify.success('Map saved');
    expect(toast.success).toHaveBeenCalledWith('Map saved', expect.objectContaining({ duration: 2000 }));
  });

  it('error calls toast.error with 6000ms duration', async () => {
    const { notify } = await import('./toast');
    notify.error('Save failed');
    expect(toast.error).toHaveBeenCalledWith('Save failed', expect.objectContaining({ duration: 6000 }));
  });

  it('error with persistent flag uses Infinity duration', async () => {
    const { notify } = await import('./toast');
    notify.error('Engine failed', { persistent: true });
    expect(toast.error).toHaveBeenCalledWith('Engine failed', expect.objectContaining({ duration: Infinity }));
  });

  it('warning calls toast.warning with 4000ms duration', async () => {
    const { notify } = await import('./toast');
    notify.warning('Image resized');
    expect(toast.warning).toHaveBeenCalledWith('Image resized', expect.objectContaining({ duration: 4000 }));
  });

  it('info calls toast.info with 2000ms duration', async () => {
    const { notify } = await import('./toast');
    notify.info('Switched map');
    expect(toast.info).toHaveBeenCalledWith('Switched map', expect.objectContaining({ duration: 2000 }));
  });

  it('action calls toast() with action button config and 5000ms duration', async () => {
    const { notify } = await import('./toast');
    const onClick = vi.fn();
    notify.action('Layer deleted', { label: 'Undo', onClick });
    expect(toast).toHaveBeenCalledWith('Layer deleted', expect.objectContaining({
      duration: 5000,
      action: expect.objectContaining({ label: 'Undo', onClick }),
    }));
  });
});

describe('coalesce', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    const { _resetCoalesceMap } = await import('./toast');
    _resetCoalesceMap();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('first call shows message without count', async () => {
    const { notifyCoalesce } = await import('./toast');
    notifyCoalesce('undo', 'Undo', { duration: 1500 });
    expect(toast).toHaveBeenCalledWith('Undo', expect.objectContaining({ duration: 1500 }));
  });

  it('rapid repeat increments count badge', async () => {
    const { notifyCoalesce } = await import('./toast');
    notifyCoalesce('undo', 'Undo', { duration: 1500 });
    notifyCoalesce('undo', 'Undo', { duration: 1500 });
    notifyCoalesce('undo', 'Undo', { duration: 1500 });
    expect(toast.dismiss).toHaveBeenCalledTimes(2);
    expect(toast).toHaveBeenLastCalledWith('Undo \u00d73', expect.objectContaining({ duration: 1500 }));
  });

  it('coalesce map resets after 600ms timeout', async () => {
    const { notifyCoalesce } = await import('./toast');
    notifyCoalesce('undo', 'Undo', { duration: 1500 });
    vi.advanceTimersByTime(700);
    notifyCoalesce('undo', 'Undo', { duration: 1500 });
    // After timeout, count resets — second call is fresh (no ×2)
    expect(toast).toHaveBeenLastCalledWith('Undo', expect.objectContaining({ duration: 1500 }));
  });

  it('different keys coalesce independently', async () => {
    const { notifyCoalesce } = await import('./toast');
    notifyCoalesce('undo', 'Undo', { duration: 1500 });
    notifyCoalesce('redo', 'Redo', { duration: 1500 });
    notifyCoalesce('undo', 'Undo', { duration: 1500 });
    // undo should be ×2, redo should be ×1
    expect(toast).toHaveBeenCalledWith('Undo \u00d72', expect.objectContaining({ duration: 1500 }));
  });
});
