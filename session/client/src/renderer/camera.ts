// Bringing one thing on the map into view.
//
// The runner's camera *is* `stage.position` / `stage.scale` (renderLoop step 1), so framing
// a point is arithmetic plus a tween. Nothing here touches the wire: a DM framing a door
// moves their own screen and nobody else's, which is the only way a "jump to it" control can
// be safe at a shared table.

import { getEngineSingleton } from '@dnd/core/src/engine/engineSingleton';
import { prefersReducedMotion } from '../session/motion';

/** Long enough to read as travel, short enough that nobody waits for it (PRODUCT §motion). */
export const FRAME_MS = 200;
/** The editor's own zoom ceiling, so the runner never parks somewhere canvas cannot. */
export const MAX_ZOOM = 100;
/** Under this a door mark is a few pixels wide — framing one has to be worth the trip. */
const CLOSE_ZOOM = 28;

/** Ease-out exponential: off the mark at once, glides to a stop. */
export const easeOutExpo = (t: number): number => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));

let pending = 0;

/**
 * Centre the viewport on a world point, zooming in only if the current zoom is too far out
 * to see what is there. Zooming *out* is never done for you — whoever chose this zoom chose
 * it. Reduced motion cuts straight to the destination, per PRODUCT §A11y.
 */
export function frameWorldPoint(x: number, y: number): void {
  const engine = getEngineSingleton()?.engine;
  if (!engine) return;

  const stage = engine.stage();
  const { width, height } = engine.viewport();
  const fromZoom = stage.scale.x;
  const toZoom = Math.min(MAX_ZOOM, Math.max(fromZoom, CLOSE_ZOOM));
  // Interpolate the *centre* rather than the stage offset: zoom and pan then stay in step
  // and the target never drifts across the screen mid-flight.
  const fromX = (width / 2 - stage.position.x) / fromZoom;
  const fromY = (height / 2 - stage.position.y) / fromZoom;

  const at = (e: number): void => {
    const zoom = fromZoom + (toZoom - fromZoom) * e;
    stage.scale.set(zoom);
    stage.position.set(
      width / 2 - (fromX + (x - fromX) * e) * zoom,
      height / 2 - (fromY + (y - fromY) * e) * zoom,
    );
  };

  cancelAnimationFrame(pending);
  if (prefersReducedMotion()) {
    at(1);
    return;
  }

  const started = performance.now();
  const step = (): void => {
    const t = (performance.now() - started) / FRAME_MS;
    at(easeOutExpo(Math.min(t, 1)));
    if (t < 1) pending = requestAnimationFrame(step);
  };
  step();
}
