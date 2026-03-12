import type { ToolType } from '@/store/types';

/** Tools that show a settings popover when active. */
export const TOOLS_WITH_POPOVER = new Set<ToolType>([
  'rectangle',
  'polygon',
  'regularPolygon',
  'path',
  'wall',
  'light',
]);

/**
 * Module-level ref for shortcut → popover signaling.
 * LeftToolbar registers a callback here on mount; defaultShortcuts calls it.
 * Same pattern as setToolManager/setSnapIndicator in useCanvasInput.ts.
 */
export const togglePopoverRef: { current: (() => void) | null } = { current: null };
