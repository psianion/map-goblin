/** Ref for the shortcut system to trigger zoom-to-fit externally */
export const zoomToFitRef: { current: (() => void) | null } = { current: null };

/** Ref to cancel any in-flight zoom-to-fit animation (used by wheel/pan handlers) */
export const cancelZoomAnimationRef: { current: (() => void) | null } = { current: null };
