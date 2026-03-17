import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pixi.js before importing the module under test
vi.mock('pixi.js', () => {
  const mockTexture = { label: 'mock-texture' };
  return {
    Assets: {
      load: vi.fn().mockResolvedValue(mockTexture),
      unload: vi.fn(),
    },
    Texture: {
      EMPTY: { label: 'empty-texture' },
    },
  };
});

import { Assets, Texture } from 'pixi.js';
import { load, getSync, retain, release, reset } from './textureLoader';

beforeEach(() => {
  reset();
  vi.clearAllMocks();
});

describe('textureLoader', () => {
  it('loads a known texture by manifest ID', async () => {
    const tex = await load('grass-a-01');
    expect(tex).toEqual({ label: 'mock-texture' });
    expect(Assets.load).toHaveBeenCalledWith('/textures/floors/grass/Grass_A_01.jpg');
  });

  it('returns Texture.EMPTY for unknown IDs', async () => {
    const tex = await load('nonexistent-texture');
    expect(tex).toBe(Texture.EMPTY);
    expect(Assets.load).not.toHaveBeenCalled();
  });

  it('returns cached texture on second load (no duplicate Assets.load)', async () => {
    await load('grass-a-01');
    await load('grass-a-01');
    expect(Assets.load).toHaveBeenCalledTimes(1);
  });

  it('getSync returns undefined before load, texture after load', async () => {
    expect(getSync('grass-a-01')).toBeUndefined();
    await load('grass-a-01');
    expect(getSync('grass-a-01')).toEqual({ label: 'mock-texture' });
  });

  it('retain increments ref count, release decrements and unloads at 0', async () => {
    await load('dirt-b-04');
    retain('dirt-b-04');
    retain('dirt-b-04');

    release('dirt-b-04');
    // Still has ref count 1 — should NOT unload
    expect(Assets.unload).not.toHaveBeenCalled();
    expect(getSync('dirt-b-04')).toBeDefined();

    release('dirt-b-04');
    // Ref count hit 0 — should unload
    expect(Assets.unload).toHaveBeenCalledWith('/textures/floors/dirt/Dirt_B_04.jpg');
    expect(getSync('dirt-b-04')).toBeUndefined();
  });

  it('release on texture with no retain calls unloads immediately', async () => {
    await load('cobblestone-a-01');
    release('cobblestone-a-01');
    expect(Assets.unload).toHaveBeenCalled();
    expect(getSync('cobblestone-a-01')).toBeUndefined();
  });

  it('reset clears all cached textures', async () => {
    await load('grass-a-01');
    await load('dirt-b-04');
    reset();
    expect(getSync('grass-a-01')).toBeUndefined();
    expect(getSync('dirt-b-04')).toBeUndefined();
  });
});
