import type { StateCreator } from 'zustand';
import type { AssetManifest, AssetRef, MapBuilderStore } from '../types.ts';

export interface AssetActions {
  toggleFavorite: (assetId: string) => void;
  trackRecentUse: (assetId: string) => void;
  addCustomUpload: (ref: AssetRef) => void;
  removeCustomUpload: (id: string) => void;
  setManifest: (manifest: AssetManifest) => void;
  markCategoryLoaded: (categoryId: string) => void;
  addCustomImage: (id: string, base64: string) => void;
}

export const createAssetsSlice: StateCreator<
  MapBuilderStore,
  [['zustand/immer', never]],
  [],
  AssetActions
> = (set) => ({
  toggleFavorite: (assetId) =>
    set((state) => {
      const idx = state.assets.favorites.indexOf(assetId);
      if (idx === -1) state.assets.favorites.push(assetId);
      else state.assets.favorites.splice(idx, 1);
    }),
  trackRecentUse: (assetId) =>
    set((state) => {
      state.assets.recentlyUsed = [
        assetId,
        ...state.assets.recentlyUsed.filter((id) => id !== assetId),
      ].slice(0, 10);
    }),
  addCustomUpload: (ref) =>
    set((state) => {
      state.assets.customUploads.push(ref);
    }),
  removeCustomUpload: (id) =>
    set((state) => {
      state.assets.customUploads = state.assets.customUploads.filter(
        (u) => u.id !== id,
      );
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
});
