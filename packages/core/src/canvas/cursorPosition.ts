import type { Point } from '../types/geometry';

/**
 * Module-level ref for the cursor's current world position.
 * Written by useCanvasInput on pointermove, cleared on pointerleave.
 * Polled by StatusBar via requestAnimationFrame.
 */
export const cursorWorldPosition: { current: Point | null } = { current: null };
