/* Where the v2 anchored popovers go. Pure, so the placement rules are tested without layout. */

/** Where an anchored popover sits: over its trigger (the dock), or beside the card holding it. */
export type PopPlacement = 'above' | 'beside';

type Box = { left: number; top: number; right: number; bottom: number };

/** Air between an anchored popover and the viewport edge, or the card it sits beside. */
const POP_EDGE = 8;
/** How far an 'above' popover clears its trigger, as the dock's in-place popovers do. */
const POP_RISE = 20;
/** A 'beside' popover starts this far above its trigger, so the picker inside lines up with it. */
const POP_LIFT = 12;

/**
 * Viewport coordinates for an anchored popover of `size`. 'above' sits over the trigger,
 * left edges lined up, and drops below it when the top has no room. 'beside' sits left of
 * `frame` (the card holding the trigger), level with the trigger, and moves to the frame's
 * right when the left has no room. Either way the popover is kept inside the viewport.
 */
export function placePopover(
  placement: PopPlacement,
  anchor: Box,
  frame: Box,
  size: { width: number; height: number },
  view: { width: number; height: number },
): { left: number; top: number } {
  let left: number;
  let top: number;
  if (placement === 'above') {
    left = anchor.left - POP_EDGE;
    top = anchor.top - POP_RISE - size.height;
    if (top < POP_EDGE) top = anchor.bottom + POP_EDGE;
  } else {
    left = frame.left - POP_EDGE - size.width;
    if (left < POP_EDGE && frame.right + POP_EDGE + size.width <= view.width - POP_EDGE) left = frame.right + POP_EDGE;
    top = anchor.top - POP_LIFT;
  }
  const clamp = (v: number, max: number) => Math.max(POP_EDGE, Math.min(v, max - POP_EDGE));
  return { left: clamp(left, view.width - size.width), top: clamp(top, view.height - size.height) };
}
