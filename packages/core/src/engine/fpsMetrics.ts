/**
 * Live FPS metrics using a ring buffer of frame timestamps.
 * Zero allocations in hot path — writes to a shared ref polled by StatusBar.
 *
 * Pattern matches cursorWorldPosition in src/canvas/cursorPosition.ts.
 */

/** Pre-allocated metrics object — mutated in place, never re-created. */
const _metrics = { fps: 0, frameTime: 0 };

/** Shared ref read by StatusBar via requestAnimationFrame. */
export const fpsMetrics: { current: { fps: number; frameTime: number } | null } = {
  current: null,
};

/** Ring buffer — 60 slots at 60 fps ≈ 1-second rolling window. */
const buffer = new Float64Array(60);
let index = 0;

/**
 * Record a frame timestamp. Call once per PixiJS Ticker tick.
 *
 * After ≥ 2 samples, computes rolling FPS and average frame time
 * and writes them to `fpsMetrics.current`.
 */
export function recordFrame(): void {
  const now = performance.now();
  buffer[index % 60] = now;
  index++;

  const count = Math.min(index, 60);
  if (count < 2) return;

  // Newest is always the entry we just wrote
  const newest = now;
  // Oldest is the entry `count - 1` slots behind newest in the ring
  const oldestIdx = (index - count + 60) % 60;
  const oldest = buffer[oldestIdx];

  const elapsed = newest - oldest;
  if (elapsed <= 0) return;

  const fps = ((count - 1) / elapsed) * 1000;
  const frameTime = elapsed / (count - 1);

  _metrics.fps = fps;
  _metrics.frameTime = frameTime;
  fpsMetrics.current = _metrics;
}

/**
 * Reset metrics state. Useful for tests.
 */
export function resetFpsMetrics(): void {
  fpsMetrics.current = null;
  buffer.fill(0);
  index = 0;
}
