// The framing arithmetic, pinned without a GPU. The tween itself is one rAF loop over the
// same `at()` the instant path calls, so checking the endpoints checks the animation too.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';
import { clearEngineSingleton, setEngineSingleton } from '@dnd/core/src/engine/engineSingleton';
import type { RenderEngine } from '@dnd/core/src/engine/RenderEngine';
import type { SceneGraph } from '@dnd/core/src/engine/sceneGraph';
import { FRAME_MS, easeOutExpo, frameWorldPoint } from './camera';

const VIEWPORT = { x: 0, y: 0, width: 800, height: 600 };

function mountStage(zoom: number): Container {
  const stage = new Container();
  stage.scale.set(zoom);
  const engine = {
    stage: () => stage,
    viewport: () => VIEWPORT,
  } as unknown as RenderEngine;
  setEngineSingleton(engine, {} as SceneGraph);
  return stage;
}

/** Reduced motion is the deterministic path: one call, straight to the destination. */
function withReducedMotion(): void {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
}

afterEach(() => {
  clearEngineSingleton();
  vi.unstubAllGlobals();
});

describe('frameWorldPoint', () => {
  it('centres the point and cuts straight there under reduced motion', () => {
    withReducedMotion();
    const stage = mountStage(40);
    frameWorldPoint(10, 5);
    expect(stage.scale.x).toBe(40);
    expect(stage.position.x).toBe(400 - 10 * 40);
    expect(stage.position.y).toBe(300 - 5 * 40);
  });

  it('zooms in when the map is framed too far out to see a door', () => {
    withReducedMotion();
    const stage = mountStage(12);
    frameWorldPoint(10, 5);
    expect(stage.scale.x).toBe(28);
    expect(stage.position.x).toBe(400 - 10 * 28);
  });

  it('never zooms out — whoever chose this zoom chose it', () => {
    withReducedMotion();
    const stage = mountStage(70);
    frameWorldPoint(0, 0);
    expect(stage.scale.x).toBe(70);
  });

  it('lands on the same camera at the end of the tween', async () => {
    const stage = mountStage(40);
    frameWorldPoint(10, 5);
    await new Promise((resolve) => setTimeout(resolve, FRAME_MS + 80));
    expect(stage.position.x).toBeCloseTo(400 - 10 * 40, 3);
    expect(stage.position.y).toBeCloseTo(300 - 5 * 40, 3);
  });

  it('is a no-op before the engine has booted', () => {
    clearEngineSingleton();
    expect(() => frameWorldPoint(1, 1)).not.toThrow();
  });

  it('eases out — most of the distance is covered early', () => {
    expect(easeOutExpo(0)).toBe(0);
    expect(easeOutExpo(1)).toBe(1);
    expect(easeOutExpo(0.5)).toBeGreaterThan(0.9);
  });
});
