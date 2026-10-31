import type { StateCreator } from 'zustand';
import type { MapBuilderStore, PackSummary, PackUpdateInfo } from '../types';
import { getPackManager, type PackFile, type PackFileInstall, type PackManager } from '../packIO';

/** What an update check says when the pack index cannot be reached or answers an error. */
export const UPDATE_SOURCE_UNREACHABLE = 'Could not reach the update source';

/** The store's rows for what the manager has installed, flags and dates as stored. */
function summariesOf(packManager: PackManager): PackSummary[] {
  return packManager.getInstalledPacks().map((p) => ({
    packId: p.packId,
    name: p.packId,
    version: p.version,
    sizeBytes: p.bundleSize,
    bundled: p.bundled,
    installedAt: p.installedAt,
  }));
}

function sameSummaries(a: PackSummary[], b: PackSummary[]): boolean {
  return (
    a.length === b.length &&
    a.every((p, i) => {
      const q = b[i];
      return (
        p.packId === q.packId &&
        p.version === q.version &&
        p.sizeBytes === q.sizeBytes &&
        p.bundled === q.bundled &&
        p.installedAt === q.installedAt
      );
    })
  );
}

export interface PackActions {
  setInstalledPacks: (packs: PackSummary[]) => void;
  /** Re-read the installed list from the manager (a no-op when it already matches). */
  refreshInstalledPacks: () => void;
  /** Install a validated pack file: refused on a bundled id or the same version, else (re)installed. */
  installPackFromFile: (file: PackFile) => Promise<PackFileInstall>;
  setAvailableUpdates: (updates: PackUpdateInfo[]) => void;
  setIsChecking: (checking: boolean) => void;
  checkForPackUpdates: () => Promise<void>;
  installPack: (packId: string) => Promise<void>;
  updatePack: (packId: string) => Promise<void>;
  dismissUpdateResult: () => void;
  uninstallPack: (packId: string) => Promise<void>;
}

export const createPacksSlice: StateCreator<
  MapBuilderStore,
  [['zustand/immer', never]],
  [],
  PackActions
> = (set, get) => ({
  setInstalledPacks: (packs) =>
    set((state) => {
      state.packs.installedPacks = packs;
    }),
  refreshInstalledPacks: () => {
    const next = summariesOf(getPackManager());
    if (sameSummaries(next, get().packs.installedPacks)) return;
    get().setInstalledPacks(next);
  },

  installPackFromFile: async ({ packId, manifest, blobs }) => {
    const packManager = getPackManager();
    const installed = packManager.getInstalledPacks().find((p) => p.packId === packId);
    if (installed?.bundled) {
      return {
        status: 'refused',
        reason: `${manifest.name} is bundled with the app; rename the pack to install it beside it`,
      };
    }
    if (installed && installed.version === manifest.version) {
      return { status: 'refused', reason: `Already installed: ${manifest.name} ${manifest.version}` };
    }
    // A pack file never comes from the CDN, so a newer copy of one only ever replaces it.
    if (installed) await packManager.uninstallPack(packId);
    await packManager.registerPack(packId, manifest, blobs, false);
    get().refreshInstalledPacks();
    set((state) => {
      state.packs.availableUpdates = state.packs.availableUpdates.filter((u) => u.packId !== packId);
    });
    return installed ? { status: 'replaced', previousVersion: installed.version } : { status: 'installed' };
  },

  setAvailableUpdates: (updates) =>
    set((state) => {
      state.packs.availableUpdates = updates;
    }),
  setIsChecking: (checking) =>
    set((state) => {
      state.packs.isChecking = checking;
    }),

  checkForPackUpdates: async () => {
    const store = get();
    store.setIsChecking(true);
    try {
      const packManager = getPackManager();
      const report = await packManager.checkForUpdatesReport();
      // Unreachable is not "up to date": say so, and keep the updates already known.
      if (report.status === 'unreachable') {
        set((state) => {
          state.packs.updateCheckError = UPDATE_SOURCE_UNREACHABLE;
        });
      } else {
        get().setAvailableUpdates(report.updates);
        set((state) => {
          state.packs.updateCheckError = null;
        });
      }
    } catch {
      set((state) => {
        state.packs.updateCheckError = UPDATE_SOURCE_UNREACHABLE;
      });
    } finally {
      get().setIsChecking(false);
    }
  },

  installPack: async (packId: string) => {
    const packManager = getPackManager();
    await packManager.installPack(packId);

    // Read installed summary from pack manager
    const installed = packManager.getInstalledPacks().find((p) => p.packId === packId);
    if (installed) {
      set((state) => {
        state.packs.installedPacks.push({
          packId: installed.packId,
          name: installed.packId,
          version: installed.version,
          sizeBytes: installed.bundleSize,
          bundled: false,
          installedAt: Date.now(),
        });
      });
    }
  },

  /**
   * Pull a published pack update. The manager re-downloads only the files whose checksum
   * moved, so the numbers it returns are the reason this button is worth pressing: a
   * six-texture art batch is a few hundred KB, not the whole 8 MB pack.
   */
  updatePack: async (packId: string) => {
    set((state) => {
      state.packs.activeUpdate = { packId, status: 'running' };
    });

    try {
      const packManager = getPackManager();
      const diff = await packManager.updatePack(packId);
      const updated = packManager.getInstalledPacks().find((p) => p.packId === packId);

      set((state) => {
        const pack = state.packs.installedPacks.find((p) => p.packId === packId);
        if (pack && updated) {
          pack.version = updated.version;
          pack.sizeBytes = updated.bundleSize;
        }
        // The pack is current now, so its pending-update row has to go with it —
        // leaving it would offer the same update again on a pack that just took it.
        state.packs.availableUpdates = state.packs.availableUpdates.filter(
          (u) => u.packId !== packId,
        );
        state.packs.activeUpdate = {
          packId,
          status: 'done',
          changedFiles: diff.changedFiles,
          downloadedBytes: diff.downloadedBytes,
          version: updated?.version,
        };
      });
    } catch (err) {
      set((state) => {
        state.packs.activeUpdate = {
          packId,
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
        };
      });
    }
  },

  dismissUpdateResult: () =>
    set((state) => {
      state.packs.activeUpdate = null;
    }),

  uninstallPack: async (packId: string) => {
    // Don't allow uninstalling bundled packs. The manager holds the stored flag; the
    // store's row can be a boot-time guess.
    const packManager = getPackManager();
    const pack =
      packManager.getInstalledPacks().find((p) => p.packId === packId) ??
      get().packs.installedPacks.find((p) => p.packId === packId);
    if (pack?.bundled) {
      throw new Error('Cannot uninstall bundled packs');
    }

    await packManager.uninstallPack(packId);

    set((state) => {
      state.packs.installedPacks = state.packs.installedPacks.filter(
        (p) => p.packId !== packId,
      );
      state.packs.availableUpdates = state.packs.availableUpdates.filter(
        (u) => u.packId !== packId,
      );
    });
  },
});
