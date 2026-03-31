import { Container, Graphics, Ticker } from 'pixi.js';

/**
 * FogTransition — a full-screen black overlay used for smooth map-switch transitions.
 *
 * Lives in the overlayContainer (screen-space, above all world content).
 * Usage:
 *   await fogTransition.fogIn();   // fade to black
 *   // swap map data
 *   await fogTransition.fogOut();  // fade from black
 */
export class FogTransition {
  private overlay: Graphics;
  private ticker: Ticker;

  constructor(parent: Container, ticker: Ticker, width: number, height: number) {
    this.ticker = ticker;

    this.overlay = new Graphics();
    this.overlay.rect(0, 0, width, height);
    this.overlay.fill({ color: 0x000000 });
    this.overlay.alpha = 0;
    this.overlay.zIndex = 9999;
    parent.addChild(this.overlay);
  }

  /** Fade from transparent to opaque black. */
  fogIn(durationMs = 300): Promise<void> {
    return this.animate(0, 1, durationMs);
  }

  /** Fade from opaque black to transparent. */
  fogOut(durationMs = 300): Promise<void> {
    return this.animate(1, 0, durationMs);
  }

  /** Update overlay dimensions (call on canvas resize). */
  resize(width: number, height: number): void {
    this.overlay.clear();
    this.overlay.rect(0, 0, width, height);
    this.overlay.fill({ color: 0x000000 });
  }

  /** Clean up the overlay Graphics object. */
  destroy(): void {
    this.overlay.destroy();
  }

  /** Current alpha value (for testing / external queries). */
  get alpha(): number {
    return this.overlay.alpha;
  }

  private animate(from: number, to: number, durationMs: number): Promise<void> {
    return new Promise((resolve) => {
      // Instant transition for zero/negative duration
      if (durationMs <= 0) {
        this.overlay.alpha = to;
        resolve();
        return;
      }

      this.overlay.alpha = from;
      const startTime = performance.now();

      const tick = (): void => {
        const elapsed = performance.now() - startTime;
        const t = Math.min(elapsed / durationMs, 1);
        // Cubic ease-in-out
        const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        this.overlay.alpha = from + (to - from) * eased;

        if (t >= 1) {
          this.overlay.alpha = to;
          this.ticker.remove(tick);
          resolve();
        }
      };

      this.ticker.add(tick);
    });
  }
}
