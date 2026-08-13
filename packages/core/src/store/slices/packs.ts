import type { StateCreator } from 'zustand';
import type { MapBuilderStore, PackSummary, PackUpdateInfo, PacksSlice } from '../types';
import { getPackManager } from '../packIO';

export interface PackActions {
  setInstalledPacks: (packs: PackSummary[]) => void;
  setAvailableUpdates: (updates: PackUpdateInfo[]) => void;
  setIsChecking: (checking: boolean) => void;
  setInstallProgress: (progress: PacksSlice['installProgress']) => void;
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
  setAvailableUpdates: (updates) =>
    set((state) => {
      state.packs.availableUpdates = updates;
    }),
  setIsChecking: (checking) =>
    set((state) => {
      state.packs.isChecking = checking;
    }),
  setInstallProgress: (progress) =>
    set((state) => {
      state.packs.installProgress = progress;
    }),

  checkForPackUpdates: async () => {
    const store = get();
    store.setIsChecking(true);
    try {
      const packManager = getPackManager();
      const updates = await packManager.checkForUpdates();
      get().setAvailableUpdates(updates);
    } catch {
      // CDN unreachable — silently ignore, don't block UI
    } finally {
      get().setIsChecking(false);
    }
  },

  installPack: async (packId: string) => {
    set((state) => {
      state.packs.installProgress = { packId, percent: 0 };
    });
    try {
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
    } finally {
      set((state) => {
        state.packs.installProgress = null;
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
    // Don't allow uninstalling bundled packs
    const pack = get().packs.installedPacks.find((p) => p.packId === packId);
    if (pack?.bundled) {
      throw new Error('Cannot uninstall bundled packs');
    }

    const packManager = getPackManager();
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
