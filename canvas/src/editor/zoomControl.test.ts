import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DEFAULT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  fitToContent,
  sliderToZoom,
  zoomPercent,
  zoomToSlider,
} from './zoomControl';
import { viewportInsetsRef } from './zoomToFitRef';

const view = vi.hoisted(() => ({
  stage: { scale: { x: 20, set(v: number) { this.x = v; } }, position: { x: 0, y: 0 } },
  vp: { width: 1920, height: 911 },
}));
vi.mock('@/engine/engineSingleton', () => ({
  getEngineSingleton: () => ({ engine: { stage: () => view.stage, viewport: () => view.vp } }),
}));
// A 63 × 50 square map, the size of the warren the reload report was taken on.
vi.mock('@/engine/export/exportPipeline', () => ({
  computeMapWorldBounds: () => ({ minX: 0, minY: 0, maxX: 63, maxY: 50 }),
}));

describe('zoomPercent', () => {
  it('reads 100% at the zoom a map opens at', () => {
    expect(zoomPercent(DEFAULT_ZOOM)).toBe(100);
  });

  it('scales with the zoom and rounds to a whole percent', () => {
    expect(zoomPercent(DEFAULT_ZOOM * 2)).toBe(200);
    expect(zoomPercent(DEFAULT_ZOOM / 2)).toBe(50);
    expect(zoomPercent(DEFAULT_ZOOM * 1.234)).toBe(123);
  });

  it('covers the whole zoom range', () => {
    expect(zoomPercent(MIN_ZOOM)).toBe(Math.round((MIN_ZOOM / DEFAULT_ZOOM) * 100));
    expect(zoomPercent(MAX_ZOOM)).toBe(Math.round((MAX_ZOOM / DEFAULT_ZOOM) * 100));
  });
});

describe('slider mapping', () => {
  it('round-trips through the exponential slider', () => {
    expect(sliderToZoom(0)).toBeCloseTo(MIN_ZOOM);
    expect(sliderToZoom(1)).toBeCloseTo(MAX_ZOOM);
    expect(sliderToZoom(zoomToSlider(DEFAULT_ZOOM))).toBeCloseTo(DEFAULT_ZOOM);
  });
});

describe('fitToContent', () => {
  let now = 0;
  beforeEach(() => {
    now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    // Each frame lands past the 150 ms ease, so one fit settles in a single tick.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      now += 1000;
      cb(now);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /** Insets as the v2 shell measures them: rail, title card, a 102 px dock, 32 px air. */
  function openAt(height: number): number {
    view.vp.height = height;
    view.stage.scale.x = DEFAULT_ZOOM;
    view.stage.position.x = 0;
    view.stage.position.y = 0;
    const dockTop = height - 142;
    viewportInsetsRef.current = { left: 76, right: 32, top: 72, bottom: height - dockTop + 32 };
    fitToContent();
    return view.stage.scale.x;
  }

  it('gives the same scale when the same map is fitted again in the same viewport', () => {
    const first = openAt(911);
    fitToContent();
    expect(view.stage.scale.x).toBe(first);
    // A fresh open (stage back at the default zoom) lands on the same scale too.
    expect(openAt(911)).toBe(first);
  });

  it('follows only the viewport: 56 px less window height is one px per square less', () => {
    expect(Math.round(openAt(911))).toBe(12);
    expect(Math.round(openAt(855))).toBe(11);
    expect(Math.round(openAt(911))).toBe(12);
  });
});
