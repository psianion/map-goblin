/**
 * Module-level ref for shortcut → tool settings signaling.
 * EditorShell registers a callback here on mount (it brings the dock forward); defaultShortcuts calls it.
 * Same pattern as setToolManager/setSnapIndicator in useCanvasInput.ts.
 */
export const togglePopoverRef: { current: (() => void) | null } = { current: null };

/**
 * Set by the app while it is mounted: opens its New map dialog. Ctrl+Shift+N calls it.
 */
export const openNewMapRef: { current: (() => void) | null } = { current: null };

/**
 * Layer id active just before the user clicked into the pinned Terrain row.
 * The filmstrip's Terrain tile sets it on entry; useCanvasInput's Escape handler
 * restores it and clears this back to null. Picking a different layer row
 * directly sets a concrete activeLayerId of its own, so nothing needs to read
 * this ref on that path — it just goes stale until the next terrain click.
 */
export const priorActiveLayerRef: { current: string | null } = { current: null };
