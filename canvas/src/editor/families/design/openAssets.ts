// Bridge from the Design family's controls (From library, a card's texture Change) to the
// asset panel the shell owns. Same module-ref pattern as canvasMenuRef: the shell sets it.

import type { AssetTypeFilter } from '@/editor/assetTypeFilter';

export const openAssetsRef: { current: ((type?: AssetTypeFilter) => void) | null } = { current: null };

export function openAssets(type?: AssetTypeFilter): void {
  openAssetsRef.current?.(type);
}
