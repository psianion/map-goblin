import { describe, it, expect, vi, afterEach } from 'vitest';
import { GridRenderer } from './GridRenderer';
import type { RenderEngine } from '../RenderEngine';

/** Minimal engine stub: identity screenToWorld/worldToScreen at a given zoom. */
function makeEngine(zoom = 20, width = 800, height = 600): RenderEngine {
  return {
    viewport: () => ({ width, height, dpr: 1 }),
    screenToWorld: (sx: number, sy: number) => ({ x: sx / zoom, y: sy / zoom }),
    worldToScreen: (wx: number, wy: number) => ({ x: wx * zoom, y: wy * zoom }),
  } as unknown as RenderEngine;
}

describe('GridRenderer settle/throttle behavior', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('redraws immediately on the first update, then skips an unchanged frame', () => {
    const renderer = new GridRenderer();
    const engine = makeEngine();
    const clearSpy = vi.spyOn(
      (renderer as unknown as { graphics: { clear: () => void } }).graphics,
      'clear',
    );

    renderer.update(engine);
    expect(clearSpy).toHaveBeenCalledTimes(1);

    renderer.update(engine);
    expect(clearSpy).toHaveBeenCalledTimes(1); // still inside drawn region, camera hasn't settled-changed
  });

  it('skips rebuilds while the camera keeps moving inside the padded region, then redraws once settled', () => {
    const renderer = new GridRenderer();
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);

    const engine = makeEngine(20);
    const clearSpy = vi.spyOn(
      (renderer as unknown as { graphics: { clear: () => void } }).graphics,
      'clear',
    );

    renderer.update(engine); // initial draw
    expect(clearSpy).toHaveBeenCalledTimes(1);

    // Simulate a small pan every frame for 80ms (< SETTLE_MS) — range shifts by
    // sub-cell amounts that stay inside the padded drawn region.
    for (let i = 0; i < 5; i++) {
      now += 16;
      renderer.update(makeEngine(20, 800 + i, 600));
    }
    expect(clearSpy).toHaveBeenCalledTimes(1); // no rebuild mid-motion

    // Camera stops; advance past SETTLE_MS with the range unchanged from the
    // last moving frame — should trigger exactly one settle redraw.
    now += 150;
    renderer.update(makeEngine(20, 804, 600));
    expect(clearSpy).toHaveBeenCalledTimes(2);

    // Further stable frames don't redraw again.
    now += 200;
    renderer.update(makeEngine(20, 804, 600));
    expect(clearSpy).toHaveBeenCalledTimes(2);
  });

  it('redraws immediately when the view moves outside the previously drawn padded region', () => {
    const renderer = new GridRenderer();
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);

    const engine = makeEngine(20);
    const clearSpy = vi.spyOn(
      (renderer as unknown as { graphics: { clear: () => void } }).graphics,
      'clear',
    );

    renderer.update(engine);
    expect(clearSpy).toHaveBeenCalledTimes(1);

    // Jump the camera far away in the same frame tick (no settle wait needed —
    // the padded region no longer covers the screen).
    now += 16;
    const jumpedEngine = {
      viewport: () => ({ width: 800, height: 600, dpr: 1 }),
      screenToWorld: (sx: number, sy: number) => ({ x: sx / 20 + 500, y: sy / 20 + 500 }),
      worldToScreen: (wx: number, wy: number) => ({ x: wx * 20, y: wy * 20 }),
    } as unknown as RenderEngine;
    renderer.update(jumpedEngine);
    expect(clearSpy).toHaveBeenCalledTimes(2);
  });

  it('does not rebuild every frame during a sustained zoom-out (range growing each frame)', () => {
    const renderer = new GridRenderer();
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);

    const clearSpy = vi.spyOn(
      (renderer as unknown as { graphics: { clear: () => void } }).graphics,
      'clear',
    );

    let zoom = 40;
    renderer.update(makeEngine(zoom)); // initial draw
    expect(clearSpy).toHaveBeenCalledTimes(1);

    // Zoom out a little every frame — the visible world range grows each tick,
    // same as a held zoom-out gesture. A flat pad gets outrun by this and
    // rebuilds on every single frame; a range-scaled pad should not.
    const frames = 40;
    for (let i = 0; i < frames; i++) {
      now += 16;
      zoom *= 0.97;
      renderer.update(makeEngine(zoom));
    }

    // Well under one rebuild per frame — the old flat PAD rebuilt on ~every frame.
    expect(clearSpy.mock.calls.length).toBeLessThan(frames / 2);
  });

  it('markDirty forces an immediate redraw regardless of settle state', () => {
    const renderer = new GridRenderer();
    const engine = makeEngine();
    const clearSpy = vi.spyOn(
      (renderer as unknown as { graphics: { clear: () => void } }).graphics,
      'clear',
    );

    renderer.update(engine);
    expect(clearSpy).toHaveBeenCalledTimes(1);

    renderer.update(engine); // unchanged, no redraw
    expect(clearSpy).toHaveBeenCalledTimes(1);

    renderer.markDirty();
    renderer.update(engine);
    expect(clearSpy).toHaveBeenCalledTimes(2);
  });
});
