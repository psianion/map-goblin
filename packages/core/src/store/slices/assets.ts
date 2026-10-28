import type { StateCreator } from 'zustand';
import type { AssetManifest, MapBuilderStore } from '../types';

/** How many picks the recents list remembers, newest first. */
export const RECENT_ASSET_LIMIT = 24;

export interface AssetActions {
  trackRecentUse: (assetId: string) => void;
  /** Stars a prop (newest first), or unstars it. */
  toggleFavourite: (assetId: string) => void;
  setManifest: (manifest: AssetManifest) => void;
  markCategoryLoaded: (categoryId: string) => void;
  addCustomImage: (id: string, base64: string) => void;
  /** Callers own the "nothing references this key anymore" check. */
  removeCustomImage: (id: string) => void;
}

export const createAssetsSlice: StateCreator<
  MapBuilderStore,
  [['zustand/immer', never]],
  [],
  AssetActions
> = (set) => ({
  trackRecentUse: (assetId) =>
    set((state) => {
      state.assets.recentlyUsed = [
        assetId,
        ...state.assets.recentlyUsed.filter((id) => id !== assetId),
      ].slice(0, RECENT_ASSET_LIMIT);
    }),
  toggleFavourite: (assetId) =>
    set((state) => {
      const { favourites } = state.assets;
      state.assets.favourites = favourites.includes(assetId)
        ? favourites.filter((id) => id !== assetId)
        : [assetId, ...favourites];
    }),
  setManifest: (manifest) =>
    set((state) => {
      state.assets.manifest = manifest;
    }),
  markCategoryLoaded: (categoryId) =>
    set((state) => {
      if (!state.assets.loadedCategories.includes(categoryId)) {
        state.assets.loadedCategories.push(categoryId);
      }
    }),
  addCustomImage: (id, base64) =>
    set((state) => {
      state.assets.customImages[id] = base64;
    }),
  removeCustomImage: (id) =>
    set((state) => {
      delete state.assets.customImages[id];
    }),
});
