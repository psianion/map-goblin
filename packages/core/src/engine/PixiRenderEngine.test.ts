import { describe, it, expect } from 'vitest';
import { PixiRenderEngine } from './PixiRenderEngine';

/** An engine past init without a GPU: only the fields createRenderTexture reads. */
function engineAt(dpr: number): PixiRenderEngine {
  const engine = new PixiRenderEngine();
  const fields = engine as unknown as { app: unknown; _viewport: { width: number; height: number; dpr: number } };
  fields.app = {};
  fields._viewport = { width: 800, height: 600, dpr };
  return engine;
}

describe('PixiRenderEngine.createRenderTexture', () => {
  it("takes the screen's DPR by default, for the passes that stand in for the canvas", () => {
    const rt = engineAt(2).createRenderTexture(100, 50);
    expect(rt.source.resolution).toBe(2);
    expect(rt.source.pixelWidth).toBe(200);
    rt.destroy(true);
  });

  it('holds exactly the asked pixels at resolution 1, as a file needs', () => {
    const rt = engineAt(2).createRenderTexture(1408, 1024, 1);
    expect(rt.source.resolution).toBe(1);
    expect(rt.source.pixelWidth).toBe(1408);
    expect(rt.source.pixelHeight).toBe(1024);
    expect(rt.width).toBe(1408);
    rt.destroy(true);
  });

  it('refuses before init', () => {
    expect(() => new PixiRenderEngine().createRenderTexture(10, 10, 1)).toThrow('Engine not initialized');
  });
});
