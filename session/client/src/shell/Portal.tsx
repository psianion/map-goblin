import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Mounts `children` straight under `document.body`, escaping whatever `overflow-hidden`
 * ancestor they'd otherwise be clipped by (a popover body, a scene row) — M3 review finding
 * 1. Still a React descendant of whoever renders it in every other way (context, event
 * bubbling through the React tree), just not a DOM one.
 */
export function Portal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}
