import type { ToolType } from '@/store/types';

/** Tools that show a settings popover when active. */
export const TOOLS_WITH_POPOVER = new Set<ToolType>([
  'rectangle',
  'polygon',
  'regularPolygon',
  'path',
  'wall',
  'door',
  'light',
  'scatterBrush',
  'terrain',
  'water',
]);

/**
 * Module-level ref for shortcut → popover signaling.
 * LeftToolbar registers a callback here on mount; defaultShortcuts calls it.
 * Same pattern as setToolManager/setSnapIndicator in useCanvasInput.ts.
 */
export const togglePopoverRef: { current: (() => void) | null } = { current: null };

/**
 * Layer id active just before the user clicked into the pinned Terrain row.
 * LayerPanel's TerrainRow sets it on entry; useCanvasInput's Escape handler
 * restores it and clears this back to null. Picking a different layer row
 * directly sets a concrete activeLayerId of its own, so nothing needs to read
 * this ref on that path — it just goes stale until the next terrain click.
 */
export const priorActiveLayerRef: { current: string | null } = { current: null };
