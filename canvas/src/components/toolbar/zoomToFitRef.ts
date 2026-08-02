/** Ref for the shortcut system to trigger zoom-to-fit externally */
export const zoomToFitRef: { current: (() => void) | null } = { current: null };

/** Ref to cancel any in-flight zoom-to-fit animation (used by wheel/pan handlers) */
export const cancelZoomAnimationRef: { current: (() => void) | null } = { current: null };

/**
 * Screen pixels the overlaid chrome covers on each edge of the full-window canvas,
 * kept current by App. Zoom-to-fit centres the map in what is actually visible
 * between the panels rather than behind them.
 */
export const viewportInsetsRef = { current: { left: 0, right: 0, bottom: 0 } };
