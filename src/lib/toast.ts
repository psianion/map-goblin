import { toast } from 'sonner';
import { resolveIcon, type ToastIconKey } from '@/components/toast/AnimatedIcons';

export const notify = {
  subtle(message: string, opts?: { icon?: ToastIconKey }): void {
    const icon = opts?.icon ? resolveIcon(opts.icon) : undefined;
    toast(message, { duration: 1500, ...(icon ? { icon } : {}) });
  },

  info(message: string): void {
    toast.info(message, { duration: 2000, icon: resolveIcon('info') });
  },

  success(message: string): void {
    toast.success(message, { duration: 2000, icon: resolveIcon('check') });
  },

  warning(message: string): void {
    toast.warning(message, { duration: 4000, icon: resolveIcon('warning') });
  },

  error(message: string, opts?: { persistent?: boolean }): void {
    toast.error(message, {
      duration: opts?.persistent ? Infinity : 6000,
      icon: resolveIcon('error'),
    });
  },

  action(
    message: string,
    opts: { label: string; onClick: () => void; icon?: ToastIconKey },
  ): void {
    const icon = opts.icon ? resolveIcon(opts.icon) : undefined;
    toast(message, {
      duration: 5000,
      action: { label: opts.label, onClick: opts.onClick },
      ...(icon ? { icon } : {}),
    });
  },
};

const coalesceMap = new Map<string, { toastId: string | number; count: number; timer: number }>();

/** @internal — exposed only for test cleanup */
export function _resetCoalesceMap(): void {
  for (const entry of coalesceMap.values()) {
    clearTimeout(entry.timer);
  }
  coalesceMap.clear();
}

export function notifyCoalesce(
  key: string,
  message: string,
  opts: { duration: number; icon?: ToastIconKey },
): void {
  const icon = opts.icon ? resolveIcon(opts.icon) : undefined;
  const existing = coalesceMap.get(key);
  if (existing) {
    clearTimeout(existing.timer);
    existing.count++;
    toast.dismiss(existing.toastId);
    const id = toast(`${message} \u00d7${existing.count}`, { duration: opts.duration, ...(icon ? { icon } : {}) });
    existing.toastId = id;
    existing.timer = window.setTimeout(() => coalesceMap.delete(key), 600);
  } else {
    const id = toast(message, { duration: opts.duration, ...(icon ? { icon } : {}) });
    coalesceMap.set(key, {
      toastId: id,
      count: 1,
      timer: window.setTimeout(() => coalesceMap.delete(key), 600),
    });
  }
}
