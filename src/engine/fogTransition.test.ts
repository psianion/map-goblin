import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// PixiJS mock — lightweight stubs for Graphics, Container, Ticker
// ---------------------------------------------------------------------------

type TickerCb = () => void;
let tickerCallbacks: TickerCb[] = [];

vi.mock('pixi.js', () => {
  class MockGraphics {
    rect = vi.fn().mockReturnThis();
    fill = vi.fn().mockReturnThis();
    clear = vi.fn().mockReturnThis();
    destroy = vi.fn();
    alpha = 0;
    zIndex = 0;
  }

  class MockContainer {
    addChild = vi.fn();
    removeChild = vi.fn();
  }

  class MockTicker {
    add = vi.fn((cb: TickerCb) => {
      tickerCallbacks.push(cb);
    });
    remove = vi.fn((cb: TickerCb) => {
      tickerCallbacks = tickerCallbacks.filter((c) => c !== cb);
    });
  }

  return {
    Graphics: MockGraphics,
    Container: MockContainer,
    Ticker: MockTicker,
  };
});

import { Container, Ticker } from 'pixi.js';
import { FogTransition } from './fogTransition';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createFog(width = 800, height = 600): {
  fog: FogTransition;
  parent: InstanceType<typeof Container>;
  ticker: InstanceType<typeof Ticker>;
} {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parent = new (Container as any)();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ticker = new (Ticker as any)();
  const fog = new FogTransition(parent, ticker, width, height);
  return { fog, parent, ticker };
}

/** Flush all queued ticker callbacks once. */
function flushTicker(): void {
  // Copy to avoid mutation during iteration (callbacks may self-remove)
  const cbs = [...tickerCallbacks];
  for (const cb of cbs) cb();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FogTransition', () => {
  beforeEach(() => {
    tickerCallbacks = [];
    vi.clearAllMocks();
  });

  it('can be constructed with parent, ticker, width, height', () => {
    const { fog, parent } = createFog(1024, 768);
    expect(fog).toBeDefined();
    // Overlay should be added to parent
    expect(parent.addChild).toHaveBeenCalledTimes(1);
  });

  it('initial overlay alpha is 0', () => {
    const { fog } = createFog();
    expect(fog.alpha).toBe(0);
  });

  it('fogIn() returns a Promise', () => {
    const { fog } = createFog();
    const result = fog.fogIn(0);
    expect(result).toBeInstanceOf(Promise);
  });

  it('fogOut() returns a Promise', () => {
    const { fog } = createFog();
    const result = fog.fogOut(0);
    expect(result).toBeInstanceOf(Promise);
  });

  it('fogIn(0) instantly sets alpha to 1', async () => {
    const { fog } = createFog();
    await fog.fogIn(0);
    expect(fog.alpha).toBe(1);
  });

  it('fogOut(0) instantly sets alpha to 0', async () => {
    const { fog } = createFog();
    // Start opaque
    await fog.fogIn(0);
    expect(fog.alpha).toBe(1);
    await fog.fogOut(0);
    expect(fog.alpha).toBe(0);
  });

  it('fogIn() with positive duration registers a ticker callback', () => {
    const { fog, ticker } = createFog();
    fog.fogIn(300);
    expect(ticker.add).toHaveBeenCalledTimes(1);
  });

  it('fogIn() resolves after animation completes', async () => {
    const { fog } = createFog();

    // Mock performance.now to control animation timing
    const startTime = 1000;
    let currentTime = startTime;
    vi.spyOn(performance, 'now').mockImplementation(() => currentTime);

    const promise = fog.fogIn(100);

    // Advance past duration
    currentTime = startTime + 150;
    flushTicker();

    await promise;
    expect(fog.alpha).toBe(1);

    vi.restoreAllMocks();
  });

  it('fogOut() resolves after animation completes', async () => {
    const { fog } = createFog();

    // Start opaque
    await fog.fogIn(0);

    const startTime = 2000;
    let currentTime = startTime;
    vi.spyOn(performance, 'now').mockImplementation(() => currentTime);

    const promise = fog.fogOut(100);

    currentTime = startTime + 150;
    flushTicker();

    await promise;
    expect(fog.alpha).toBe(0);

    vi.restoreAllMocks();
  });

  it('animation interpolates alpha between from and to', () => {
    const { fog } = createFog();

    const startTime = 5000;
    let currentTime = startTime;
    vi.spyOn(performance, 'now').mockImplementation(() => currentTime);

    fog.fogIn(200);

    // At halfway, alpha should be between 0 and 1 (eased)
    currentTime = startTime + 100;
    flushTicker();
    expect(fog.alpha).toBeGreaterThan(0);
    expect(fog.alpha).toBeLessThanOrEqual(1);

    // At end
    currentTime = startTime + 250;
    flushTicker();
    expect(fog.alpha).toBe(1);

    vi.restoreAllMocks();
  });

  it('ticker callback is removed after animation completes', async () => {
    const { fog, ticker } = createFog();

    const startTime = 3000;
    let currentTime = startTime;
    vi.spyOn(performance, 'now').mockImplementation(() => currentTime);

    const promise = fog.fogIn(50);

    currentTime = startTime + 100;
    flushTicker();

    await promise;
    expect(ticker.remove).toHaveBeenCalledTimes(1);

    vi.restoreAllMocks();
  });

  it('resize() updates overlay dimensions', () => {
    const { fog } = createFog(800, 600);
    // Should not throw
    fog.resize(1920, 1080);
    // Alpha should remain unchanged
    expect(fog.alpha).toBe(0);
  });

  it('destroy() cleans up overlay', () => {
    const { fog } = createFog();
    // Should not throw
    fog.destroy();
  });
});
