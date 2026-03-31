import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fpsMetrics, recordFrame, resetFpsMetrics } from './fpsMetrics';

describe('fpsMetrics', () => {
  beforeEach(() => {
    resetFpsMetrics();
  });

  it('remains null with fewer than 2 calls', () => {
    expect(fpsMetrics.current).toBeNull();

    // Mock performance.now for deterministic timestamps
    vi.spyOn(performance, 'now').mockReturnValue(0);
    recordFrame();
    expect(fpsMetrics.current).toBeNull();

    vi.restoreAllMocks();
  });

  it('produces non-null metrics after 2+ calls', () => {
    let time = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => time);

    recordFrame();
    time += 16.667; // ~60fps
    recordFrame();

    expect(fpsMetrics.current).not.toBeNull();
    expect(fpsMetrics.current!.fps).toBeGreaterThan(0);
    expect(fpsMetrics.current!.frameTime).toBeGreaterThan(0);

    vi.restoreAllMocks();
  });

  it('computes correct FPS and frameTime at known intervals', () => {
    let time = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => time);

    // Simulate 60 frames at exactly 16.667ms apart (≈ 60fps)
    for (let i = 0; i < 60; i++) {
      time = i * 16.667;
      recordFrame();
    }

    const metrics = fpsMetrics.current!;
    expect(metrics).not.toBeNull();

    // FPS should be close to 60
    expect(metrics.fps).toBeGreaterThan(58);
    expect(metrics.fps).toBeLessThan(62);

    // Frame time should be close to 16.667ms
    expect(metrics.frameTime).toBeGreaterThan(16);
    expect(metrics.frameTime).toBeLessThan(17.5);

    vi.restoreAllMocks();
  });

  it('wraps ring buffer correctly after 60+ calls', () => {
    let time = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => time);

    // Fill the ring buffer and then some (90 frames)
    for (let i = 0; i < 90; i++) {
      time = i * 10; // 10ms apart = 100fps
      recordFrame();
    }

    const metrics = fpsMetrics.current!;
    expect(metrics).not.toBeNull();

    // FPS should be close to 100 (1000ms / 10ms)
    expect(metrics.fps).toBeGreaterThan(98);
    expect(metrics.fps).toBeLessThan(102);

    // Frame time should be close to 10ms
    expect(metrics.frameTime).toBeGreaterThan(9.5);
    expect(metrics.frameTime).toBeLessThan(10.5);

    vi.restoreAllMocks();
  });

  it('resets cleanly via resetFpsMetrics', () => {
    let time = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => time);

    // Record some frames
    for (let i = 0; i < 10; i++) {
      time = i * 16;
      recordFrame();
    }
    expect(fpsMetrics.current).not.toBeNull();

    // Reset
    resetFpsMetrics();
    expect(fpsMetrics.current).toBeNull();

    // After reset, single frame should still be null
    time = 5000;
    recordFrame();
    expect(fpsMetrics.current).toBeNull();

    vi.restoreAllMocks();
  });
});
