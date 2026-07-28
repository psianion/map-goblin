/**
 * The one motion switch. CSS animations are also neutered by the `prefers-reduced-motion`
 * block in index.css, but Pixi tweens and class decisions need the answer in script — so
 * every animated surface asks here and both halves stay in step.
 *
 * Read at render/draw time rather than cached: a viewer who flips the OS setting mid-session
 * gets the quiet version on the next state change, with nothing to subscribe to.
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
  );
}
