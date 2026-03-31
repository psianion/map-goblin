/**
 * Notification proxy for @dnd/core.
 * Delegates to the injectable NotifyFn (set by canvas via setNotify).
 * Falls back to console if not wired.
 */
import { getNotify } from '../store/notify';

export const notify = {
  subtle(message: string, _opts?: { icon?: string }): void {
    getNotify().info(message);
  },
  warning(message: string): void {
    getNotify().warning(message);
  },
  error(message: string): void {
    getNotify().error(message);
  },
  info(message: string): void {
    getNotify().info(message);
  },
  success(message: string): void {
    getNotify().success(message);
  },
};
