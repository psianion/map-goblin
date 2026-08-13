import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useStore } from '../store';
import { setPackManagerFactory, type PackManager, type PackDiff } from '../packIO';
import type { PackSummary, PackUpdateInfo } from '../types';

const INSTALLED: PackSummary = {
  packId: 'dungeon-classic',
  name: 'dungeon-classic',
  version: '1.2.0',
  sizeBytes: 8_340_158,
  bundled: true,
  installedAt: 0,
};

const PENDING: PackUpdateInfo = {
  packId: 'dungeon-classic',
  currentVersion: '1.2.0',
  availableVersion: '1.3.0',
};

const DIFF: PackDiff = {
  changedFiles: 6,
  unchangedFiles: 112,
  downloadedBytes: 421_904,
  totalFiles: 118,
};

/** A manager whose updatePack resolves with DIFF and reports the new version after. */
function stubManager(overrides: Partial<PackManager> = {}): PackManager {
  let version = '1.2.0';
  return {
    checkForUpdates: vi.fn(async () => []),
    installPack: vi.fn(async () => {}),
    updatePack: vi.fn(async () => {
      version = '1.3.0';
      return DIFF;
    }),
    uninstallPack: vi.fn(async () => {}),
    getInstalledPacks: () => [
      { packId: 'dungeon-classic', version, bundleSize: 8_500_000 },
    ],
    ...overrides,
  };
}

function seedInstalled() {
  useStore.getState().setInstalledPacks([{ ...INSTALLED }]);
  useStore.getState().setAvailableUpdates([{ ...PENDING }]);
}

describe('updatePack', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
    useStore.getState().dismissUpdateResult();
    setPackManagerFactory(() => stubManager());
    seedInstalled();
  });

  it('reports what the differential update actually downloaded', async () => {
    // The whole reason a DM presses this button: 6 changed files out of 118, not the
    // 8 MB pack. If these numbers stop being surfaced, the update looks like a full
    // re-download and there is nothing on screen to say otherwise.
    await useStore.getState().updatePack('dungeon-classic');

    const result = useStore.getState().packs.activeUpdate;
    expect(result).toMatchObject({
      packId: 'dungeon-classic',
      status: 'done',
      changedFiles: 6,
      downloadedBytes: 421_904,
      version: '1.3.0',
    });
  });

  it('moves the installed pack to the new version', async () => {
    await useStore.getState().updatePack('dungeon-classic');

    const pack = useStore.getState().packs.installedPacks.find((p) => p.packId === 'dungeon-classic');
    expect(pack?.version).toBe('1.3.0');
    expect(pack?.sizeBytes).toBe(8_500_000);
  });

  it('clears the pending-update row so the same update is not offered twice', async () => {
    await useStore.getState().updatePack('dungeon-classic');
    expect(useStore.getState().packs.availableUpdates).toEqual([]);
  });

  it('marks the update running while it is in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    setPackManagerFactory(() =>
      stubManager({ updatePack: vi.fn(async () => { await gate; return DIFF; }) }),
    );
    seedInstalled();

    const pending = useStore.getState().updatePack('dungeon-classic');
    expect(useStore.getState().packs.activeUpdate).toEqual({
      packId: 'dungeon-classic',
      status: 'running',
    });

    release();
    await pending;
    expect(useStore.getState().packs.activeUpdate?.status).toBe('done');
  });

  it('surfaces a failure instead of rejecting, and leaves the pack untouched', async () => {
    setPackManagerFactory(() =>
      stubManager({
        updatePack: vi.fn(async () => {
          throw new Error('Checksum mismatch for atlas-floor.webp');
        }),
      }),
    );
    seedInstalled();

    // Resolves: the card renders the error. An unhandled rejection mid-session would
    // leave the DM with a button that visibly did nothing.
    await expect(useStore.getState().updatePack('dungeon-classic')).resolves.toBeUndefined();

    expect(useStore.getState().packs.activeUpdate).toEqual({
      packId: 'dungeon-classic',
      status: 'error',
      message: 'Checksum mismatch for atlas-floor.webp',
    });
    // Still on the old version, and the update is still on offer to retry.
    const pack = useStore.getState().packs.installedPacks.find((p) => p.packId === 'dungeon-classic');
    expect(pack?.version).toBe('1.2.0');
    expect(useStore.getState().packs.availableUpdates).toHaveLength(1);
  });

  it('dismissUpdateResult clears the result', async () => {
    await useStore.getState().updatePack('dungeon-classic');
    useStore.getState().dismissUpdateResult();
    expect(useStore.getState().packs.activeUpdate).toBeNull();
  });
});
