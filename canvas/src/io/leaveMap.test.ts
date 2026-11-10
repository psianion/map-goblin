import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const toast = vi.hoisted(() => ({ subtle: vi.fn(), error: vi.fn() }));
vi.mock('@dnd/ui/toast', () => ({ notify: toast }));

const { saveThenLeave, SAVING_NOTICE_MS } = await import('./leaveMap');

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

/** A save the test finishes by hand. */
function pendingSave() {
  let finish!: (err?: Error) => void;
  const promise = new Promise<void>((resolve, reject) => (finish = (err) => (err ? reject(err) : resolve())));
  return { save: () => promise, finish };
}

describe('goHome resolves after the save settles', () => {
  it('leaves only once the save is written', async () => {
    const { save, finish } = pendingSave();
    const leave = vi.fn();
    const done = saveThenLeave(save, leave);
    await vi.advanceTimersByTimeAsync(50);
    expect(leave).not.toHaveBeenCalled();
    finish();
    await done;
    expect(leave).toHaveBeenCalledOnce();
    expect(toast.subtle).not.toHaveBeenCalled();
  });

  it('a slow save says Saving… while it finishes', async () => {
    const { save, finish } = pendingSave();
    const leave = vi.fn();
    const done = saveThenLeave(save, leave);
    await vi.advanceTimersByTimeAsync(SAVING_NOTICE_MS + 1);
    expect(toast.subtle).toHaveBeenCalledWith('Saving…', { icon: 'save' });
    expect(leave).not.toHaveBeenCalled();
    finish();
    await done;
    expect(leave).toHaveBeenCalledOnce();
  });

  it('a failed save still leaves, with a toast', async () => {
    const { save, finish } = pendingSave();
    const leave = vi.fn();
    const done = saveThenLeave(save, leave);
    finish(new Error('quota'));
    await done;
    expect(toast.error).toHaveBeenCalledOnce();
    expect(leave).toHaveBeenCalledOnce();
  });
});
