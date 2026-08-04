/**
 * Notification proxy for @dnd/core.
 * Delegates to the injectable NotifyFn (set by canvas via setNotify).
 * Falls back to console if not wired.
 */
import { getNotify } from '../store/notify';

export const notify = {
  // No icon option: NotifyFn (above) has no slot for one — the injected
  // implementation (canvas's toast bridge) only ever sees the message string,
  // so an icon passed in here could never reach anything. Previously
  // accepted-and-silently-dropped; removed rather than wired through, since
  // wiring it means widening NotifyFn itself for a feature nothing here uses.
  subtle(message: string): void {
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
