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
