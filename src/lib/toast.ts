// src/lib/toast.ts
import { toast } from 'sonner';
import type { ReactNode } from 'react';

export const notify = {
  subtle(message: string, opts?: { icon?: ReactNode }): void {
    toast(message, { duration: 1500, ...(opts?.icon ? { icon: opts.icon } : {}) });
  },
  info(message: string): void {
    toast.info(message, { duration: 2000 });
  },
  success(message: string): void {
    toast.success(message, { duration: 2000 });
  },
  warning(message: string): void {
    toast.warning(message, { duration: 4000 });
  },
  error(message: string, opts?: { persistent?: boolean }): void {
    toast.error(message, { duration: opts?.persistent ? Infinity : 6000 });
  },
  action(message: string, opts: { label: string; onClick: () => void }): void {
    toast(message, { duration: 5000, action: { label: opts.label, onClick: opts.onClick } });
  },
};

const coalesceMap = new Map<string, { toastId: string | number; count: number; timer: number }>();

export function notifyCoalesce(key: string, message: string, opts: { duration: number }): void {
  const existing = coalesceMap.get(key);
  if (existing) {
    clearTimeout(existing.timer);
    existing.count++;
    toast.dismiss(existing.toastId);
    const id = toast(`${message} \u00d7${existing.count}`, opts);
    existing.toastId = id;
    existing.timer = window.setTimeout(() => coalesceMap.delete(key), 600);
  } else {
    const id = toast(message, opts);
    coalesceMap.set(key, { toastId: id, count: 1, timer: window.setTimeout(() => coalesceMap.delete(key), 600) });
  }
}
