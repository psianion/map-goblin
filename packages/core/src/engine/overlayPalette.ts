// Canvas overlay furniture — selection bounds, transform handles, node handles.
//
// Overlays are deliberately theme-free: the app accent is user-customizable and
// a colored overlay disappears on same-hue map art (green handles on grass).
// White strokes carried by a near-black ink underlay survive every biome, like
// a camera viewfinder. Chrome (menus, panels, status bar) keeps the theme
// accent; nothing in here may read theme state.

/** Handle fill and primary stroke. */
export const OVERLAY_WHITE = 0xffffff;

/** Near-black underlay that keeps white legible on bright art. */
export const OVERLAY_INK = 0x100d09;

/** Alpha for the ink underlay stroke drawn beneath white lines. */
export const OVERLAY_INK_ALPHA = 0.7;

/** Alpha for handle borders. */
export const HANDLE_BORDER_ALPHA = 0.85;

/** Corner handle: white square with ink border. */
export const HANDLE_SIZE = 11;

/** Mid-edge pill handles: long axis / short axis. */
export const PILL_LENGTH = 18;
export const PILL_THICKNESS = 7;

/** Rotate handle circle diameter and its stem length above the box. */
export const ROTATE_DIAMETER = 13;
export const ROTATE_STEM = 14;

/**
 * Minimum half-width of a handle's hit zone in CSS px. Visual handles are
 * ~11px; a 20px+ square is what a real mouse actually lands on. A near-miss
 * inside the box must NOT silently become a move — see TransformGizmo.hitTest.
 */
export const HANDLE_HIT_HALF = 10;

/** Line widths: white line over a slightly wider ink line. */
export const LINE_WHITE = 1.5;
export const LINE_INK = 3;
