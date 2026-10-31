import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useStore } from '../store';
import { setPackManagerFactory, type PackManager, type PackDiff, type PackFile } from '../packIO';
import type { PackSummary, PackUpdateInfo } from '../types';
import { UPDATE_SOURCE_UNREACHABLE } from './packs';

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
    checkForUpdatesReport: vi.fn(async () => ({ status: 'ok' as const, updates: [] })),
    installPack: vi.fn(async () => {}),
    updatePack: vi.fn(async () => {
      version = '1.3.0';
      return DIFF;
    }),
    registerPack: vi.fn(async () => {}),
    uninstallPack: vi.fn(async () => {}),
    getInstalledPacks: () => [
      { packId: 'dungeon-classic', version, bundleSize: 8_500_000, bundled: true, installedAt: 0 },
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

type Installed = ReturnType<PackManager['getInstalledPacks']>[number];

/** A manager that keeps what it is told to register and uninstall. */
function fakeManager(initial: Installed[]) {
  const installed = new Map(initial.map((p) => [p.packId, { ...p }]));
  const calls: string[] = [];
  const manager: PackManager = {
    checkForUpdates: vi.fn(async () => []),
    checkForUpdatesReport: vi.fn(async () => ({ status: 'ok' as const, updates: [] })),
    installPack: vi.fn(async () => {}),
    updatePack: vi.fn(async () => DIFF),
    registerPack: vi.fn(async (packId: string, manifest: PackFile['manifest'], blobs: Map<string, Uint8Array>, bundled = false) => {
      calls.push(`register ${packId}@${manifest.version}`);
      const bundleSize = [...blobs.values()].reduce((s, b) => s + b.length, 0);
      installed.set(packId, { packId, version: manifest.version, bundleSize, bundled, installedAt: 5 });
    }),
    uninstallPack: vi.fn(async (packId: string) => {
      calls.push(`uninstall ${packId}`);
      installed.delete(packId);
    }),
    getInstalledPacks: () => [...installed.values()],
  };
  return { manager, calls };
}

function packFile(name: string, version: string): PackFile {
  return {
    packId: name,
    manifest: { name, description: '', version, bundleSize: 0, entries: { a: {} as never }, atlases: {}, files: { 'a.png': { checksum: '', size: 3 } } },
    blobs: new Map([['a.png', new Uint8Array([1, 2, 3])]]),
  };
}

const BUNDLED: Installed = { packId: 'gg-forge', version: '1.5.0', bundleSize: 1_000, bundled: true, installedAt: 1 };

describe('installPackFromFile', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
  });

  it('registers a new pack as not bundled and lists it', async () => {
    const { manager } = fakeManager([BUNDLED]);
    setPackManagerFactory(() => manager);

    const result = await useStore.getState().installPackFromFile(packFile('crates', '1.0.0'));

    expect(result).toEqual({ status: 'installed' });
    expect(manager.registerPack).toHaveBeenCalledWith('crates', expect.anything(), expect.any(Map), false);
    const row = useStore.getState().packs.installedPacks.find((p) => p.packId === 'crates');
    expect(row).toMatchObject({ version: '1.0.0', sizeBytes: 3, bundled: false });
  });

  it('refuses a file whose id is a bundled pack, and touches nothing', async () => {
    const { manager, calls } = fakeManager([BUNDLED]);
    setPackManagerFactory(() => manager);

    const result = await useStore.getState().installPackFromFile(packFile('gg-forge', '9.0.0'));

    expect(result).toEqual({
      status: 'refused',
      reason: 'gg-forge is bundled with the app; rename the pack to install it beside it',
    });
    expect(calls).toEqual([]);
  });

  it('replaces a pack installed from a file: uninstall, then register', async () => {
    const { manager, calls } = fakeManager([{ packId: 'crates', version: '1.0.0', bundleSize: 3, bundled: false, installedAt: 1 }]);
    setPackManagerFactory(() => manager);
    useStore.getState().setAvailableUpdates([{ packId: 'crates', currentVersion: '1.0.0', availableVersion: '1.1.0' }]);

    const result = await useStore.getState().installPackFromFile(packFile('crates', '1.1.0'));

    expect(result).toEqual({ status: 'replaced', previousVersion: '1.0.0' });
    expect(calls).toEqual(['uninstall crates', 'register crates@1.1.0']);
    expect(useStore.getState().packs.installedPacks.map((p) => `${p.packId}@${p.version}`)).toEqual(['crates@1.1.0']);
    expect(useStore.getState().packs.availableUpdates).toEqual([]);
  });

  it('refuses the same id and version as already installed', async () => {
    const { manager, calls } = fakeManager([{ packId: 'crates', version: '1.0.0', bundleSize: 3, bundled: false, installedAt: 1 }]);
    setPackManagerFactory(() => manager);

    const result = await useStore.getState().installPackFromFile(packFile('crates', '1.0.0'));

    expect(result).toEqual({ status: 'refused', reason: 'Already installed: crates 1.0.0' });
    expect(calls).toEqual([]);
  });
});

describe('uninstallPack and the stored flag', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
  });

  it('drops the row and its pending update', async () => {
    const { manager } = fakeManager([BUNDLED, { packId: 'crates', version: '1.0.0', bundleSize: 3, bundled: false, installedAt: 1 }]);
    setPackManagerFactory(() => manager);
    useStore.getState().refreshInstalledPacks();
    useStore.getState().setAvailableUpdates([{ packId: 'crates', currentVersion: '1.0.0', availableVersion: '1.1.0' }]);

    await useStore.getState().uninstallPack('crates');

    expect(manager.uninstallPack).toHaveBeenCalledWith('crates');
    expect(useStore.getState().packs.installedPacks.map((p) => p.packId)).toEqual(['gg-forge']);
    expect(useStore.getState().packs.availableUpdates).toEqual([]);
  });

  it('refuses a pack the manager stores as bundled, whatever the row says', async () => {
    const { manager } = fakeManager([BUNDLED]);
    setPackManagerFactory(() => manager);
    useStore.getState().setInstalledPacks([{ packId: 'gg-forge', name: 'gg-forge', version: '1.5.0', sizeBytes: 1_000, bundled: false, installedAt: 0 }]);

    await expect(useStore.getState().uninstallPack('gg-forge')).rejects.toThrow('Cannot uninstall bundled packs');
    expect(manager.uninstallPack).not.toHaveBeenCalled();
  });

  it('refreshInstalledPacks takes the stored flags over a boot-time "all bundled"', () => {
    // CanvasHost marks every pack present at boot bundled: true. The manager has the flag
    // each copy was stored with; the sheet's tags and Uninstall read this refresh.
    const { manager } = fakeManager([BUNDLED, { packId: 'crates', version: '1.0.0', bundleSize: 3, bundled: false, installedAt: 7 }]);
    setPackManagerFactory(() => manager);
    useStore.getState().setInstalledPacks(
      manager.getInstalledPacks().map((p) => ({ packId: p.packId, name: p.packId, version: p.version, sizeBytes: p.bundleSize, bundled: true, installedAt: 99 })),
    );

    useStore.getState().refreshInstalledPacks();
    const rows = useStore.getState().packs.installedPacks;
    expect(rows.map((p) => [p.packId, p.bundled, p.installedAt])).toEqual([
      ['gg-forge', true, 1],
      ['crates', false, 7],
    ]);

    // Already in step: no write, so a subscriber re-running it settles.
    useStore.getState().refreshInstalledPacks();
    expect(useStore.getState().packs.installedPacks).toBe(rows);
  });

  it('a check that answers the same pending update keeps it on offer', async () => {
    const pending = { packId: 'gg-forge', currentVersion: '1.5.0', availableVersion: '1.6.0' };
    const { manager } = fakeManager([BUNDLED]);
    manager.checkForUpdatesReport = vi.fn(async () => ({ status: 'ok' as const, updates: [pending] }));
    setPackManagerFactory(() => manager);

    await useStore.getState().checkForPackUpdates();
    await useStore.getState().checkForPackUpdates();

    expect(useStore.getState().packs.availableUpdates).toEqual([pending]);
    expect(useStore.getState().packs.isChecking).toBe(false);
  });

  it('an update source that cannot be reached is an error, not "no updates": the pending update stays', async () => {
    const pending = { packId: 'gg-forge', currentVersion: '1.5.0', availableVersion: '1.6.0' };
    const { manager } = fakeManager([BUNDLED]);
    setPackManagerFactory(() => manager);
    useStore.getState().setAvailableUpdates([pending]);

    manager.checkForUpdatesReport = vi.fn(async () => ({ status: 'unreachable' as const, updates: [] }));
    await useStore.getState().checkForPackUpdates();
    expect(useStore.getState().packs.updateCheckError).toBe(UPDATE_SOURCE_UNREACHABLE);
    expect(useStore.getState().packs.availableUpdates).toEqual([pending]);

    // A throw is the same; an answer clears the error and takes the index's list.
    manager.checkForUpdatesReport = vi.fn(async () => {
      throw new Error('boom');
    });
    await useStore.getState().checkForPackUpdates();
    expect(useStore.getState().packs.updateCheckError).toBe(UPDATE_SOURCE_UNREACHABLE);
    expect(useStore.getState().packs.availableUpdates).toEqual([pending]);
    manager.checkForUpdatesReport = vi.fn(async () => ({ status: 'ok' as const, updates: [] }));
    await useStore.getState().checkForPackUpdates();
    expect(useStore.getState().packs.updateCheckError).toBeNull();
    expect(useStore.getState().packs.availableUpdates).toEqual([]);
    expect(useStore.getState().packs.isChecking).toBe(false);
  });
});
