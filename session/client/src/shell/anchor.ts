// On-map menus (`DoorMenu`, `TokenMenu`) anchor to a world point projected to screen px, not
// to a rail icon — this is the geometry they share, so a menu clamped by the chrome (the
// status bar, the popover frame) behaves identically for a door and a token (M3 review
// finding 10). Both menus re-place themselves imperatively every animation frame the camera
// could have moved, so `applyPlacement` writes straight to the DOM rather than through React
// state — the same reason their own `left`/`top` writes already did.

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface MenuSize {
  width: number;
  height: number;
}

export interface Placement {
  left: number;
  top: number;
  /** Which side of the anchor the menu ended up on — the notch points the other way. */
  side: 'left' | 'right';
  /** Vertical offset (px, from the menu's own top) for the notch triangle; null hides it —
   *  neither side had room, so nothing on screen it could still honestly point at. */
  notchTop: number | null;
}

/** Screen px between the anchor point and the menu's near edge. */
export const GAP = 12;
/** jsdom lays nothing out — the size a menu is clamped against before it has ever painted. */
export const FALLBACK_SIZE: MenuSize = { width: 180, height: 76 };
/** The notch's resting spot when the menu sits at its natural (vertically unclamped)
 *  position — the header row beside it, not a true vertical centre. */
export const NOTCH_REST = 14;
/** Keeps the notch off the frame's rounded corners when it has to chase a clamped anchor. */
const NOTCH_MARGIN = 10;
/** `TableStatusBar`'s own height (`h-7`) — on-map menus never sit under it. */
export const STATUS_BAR_HEIGHT = 28;
/** Clamp margin on every side of the map element's own box. */
export const MARGIN = 12;

/** The map element's box, minus the status bar and the margin — what both on-map menus clamp
 *  against (M3 review finding 10). Coordinates match `worldToScreen`'s own: CSS px local to
 *  the map element, not the viewport. */
export function boundsOf(mapSize: { width: number; height: number }): Rect {
  return {
    left: MARGIN,
    top: MARGIN,
    right: mapSize.width - MARGIN,
    bottom: mapSize.height - STATUS_BAR_HEIGHT - MARGIN,
  };
}

/**
 * Where an on-map menu lands beside a world-point anchor, clamped inside `bounds`. Prefers
 * the anchor's right; flips to the left when the right doesn't fit and the left does;
 * otherwise clamps in place and drops the notch, since neither side can point at the anchor
 * honestly anymore. Independently, a vertical clamp moves the notch to keep pointing at the
 * anchor's own y rather than leaving it at its resting spot.
 */
export function placeBeside(anchor: Point, menu: MenuSize, bounds: Rect): Placement {
  const idealTop = anchor.y - menu.height / 2;
  const maxTop = Math.max(bounds.top, bounds.bottom - menu.height);
  const top = Math.min(Math.max(idealTop, bounds.top), maxTop);
  const yClamped = top !== idealTop;

  const rightLeft = anchor.x + GAP;
  const rightFits = rightLeft + menu.width <= bounds.right;
  const leftLeft = anchor.x - GAP - menu.width;
  const leftFits = leftLeft >= bounds.left;

  let side: 'left' | 'right' = 'right';
  let left = rightLeft;
  let noRoom = false;
  if (!rightFits) {
    if (leftFits) {
      side = 'left';
      left = leftLeft;
    } else {
      noRoom = true;
      const maxLeft = Math.max(bounds.left, bounds.right - menu.width);
      left = Math.min(Math.max(rightLeft, bounds.left), maxLeft);
    }
  }

  const notchTop = noRoom
    ? null
    : yClamped
      ? Math.min(Math.max(anchor.y - top, NOTCH_MARGIN), menu.height - NOTCH_MARGIN)
      : NOTCH_REST;

  return { left, top, side, notchTop };
}

const NOTCH_BASE = 'absolute h-[10px] w-[10px] rotate-45 bg-surface-1 border-border-structure';
/** Menu sits right of the anchor — the notch points left, into the anchor. */
export const NOTCH_LEFT_CLASS = `${NOTCH_BASE} -left-[6px] border-b border-l`;
/** Menu sits left of the anchor (flipped) — the notch points right, into the anchor. */
export const NOTCH_RIGHT_CLASS = `${NOTCH_BASE} -right-[6px] border-t border-r`;

/** Writes a `Placement` straight to the menu root and its notch node. */
export function applyPlacement(el: HTMLElement, notch: HTMLElement | null, placement: Placement): void {
  el.style.left = `${placement.left}px`;
  el.style.top = `${placement.top}px`;
  if (!notch) return;
  if (placement.notchTop === null) {
    notch.style.display = 'none';
    return;
  }
  notch.style.display = '';
  notch.style.top = `${placement.notchTop}px`;
  notch.className = placement.side === 'right' ? NOTCH_LEFT_CLASS : NOTCH_RIGHT_CLASS;
}
