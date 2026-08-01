/**
 * The one motion switch for the editor's Pixi-driven animations (light flicker, and
 * anything that follows). Mirrors `session/client/src/session/motion.ts` — CSS still
 * gets its own `prefers-reduced-motion` block, but Pixi tweens need the answer in script.
 *
 * Read at draw time rather than cached: a viewer who flips the OS setting mid-session
 * gets the quiet version on the next frame, with nothing to subscribe to.
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
  );
}
