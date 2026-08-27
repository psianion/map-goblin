// The late-texture re-bake arm: a floor baked before its pack texture landed
// must re-key the bake exactly once when the texture arrives, and must not arm
// waits for ids that resolve synchronously or never resolve.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const waitForTexture = vi.fn<(id: string) => Promise<unknown>>();
vi.mock('./assetPackInstance', () => ({
  getAssetPackManager: () => ({ waitForTexture }),
}));

import { armLateTextureRebuild } from './floorWallRenderer';
import { useStore } from '../store/store';

const LAYER = 'layer-under-test';

function epoch(): number {
  return useStore.getState().floorTextureEpochs[LAYER] ?? 0;
}

beforeEach(() => {
  waitForTexture.mockReset();
  useStore.setState({ floorTextureEpochs: {} });
});

describe('armLateTextureRebuild', () => {
  it('bumps the layer epoch when the texture lands', async () => {
    let land!: (tex: unknown) => void;
    waitForTexture.mockReturnValue(new Promise((r) => (land = r)));

    armLateTextureRebuild(LAYER, 'gg-demo:floor_small_8x8_floor_A');
    expect(epoch()).toBe(0); // nothing until the texture actually arrives

    land({ width: 1600 });
    await Promise.resolve();
    expect(epoch()).toBe(1);
  });

  it('arms one wait per (layer, texture) while a bake repeats on the fallback', async () => {
    let land!: (tex: unknown) => void;
    waitForTexture.mockReturnValue(new Promise((r) => (land = r)));

    armLateTextureRebuild(LAYER, 'gg-demo:floor_small_8x8_floor_A');
    armLateTextureRebuild(LAYER, 'gg-demo:floor_small_8x8_floor_A');
    expect(waitForTexture).toHaveBeenCalledTimes(1);

    land({ width: 1600 });
    await Promise.resolve();
    expect(epoch()).toBe(1);

    // Resolved and disarmed: a later fallback bake may arm again.
    waitForTexture.mockReturnValue(Promise.resolve({ width: 1600 }));
    armLateTextureRebuild(LAYER, 'gg-demo:floor_small_8x8_floor_A');
    expect(waitForTexture).toHaveBeenCalledTimes(2);
  });

  it('ignores ids that never arrive late (imported images, data urls)', () => {
    armLateTextureRebuild(LAYER, 'my-imported-image');
    armLateTextureRebuild(LAYER, 'data:image/png;base64,xyz');
    armLateTextureRebuild(LAYER, 'blob:http://x/abc');
    expect(waitForTexture).not.toHaveBeenCalled();
  });

  it('stays quiet when the wait times out with null', async () => {
    waitForTexture.mockReturnValue(Promise.resolve(null));
    armLateTextureRebuild(LAYER, 'gg-demo:never_ships');
    await Promise.resolve();
    expect(epoch()).toBe(0);
  });
});
