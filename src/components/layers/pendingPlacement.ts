// Module-level state for pending placement asset ID.
// Shared between AssetBrowserPanel and AssetPlacementTool.
let _pendingAssetId: string | null = null;
const _listeners = new Set<() => void>();

export function getPendingPlacementAssetId(): string | null {
  return _pendingAssetId;
}

export function setPendingPlacementAssetId(id: string | null): void {
  _pendingAssetId = id;
  for (const fn of _listeners) fn();
}

export function subscribeToPlacementId(fn: () => void): () => void {
  _listeners.add(fn);
  return () => {
    _listeners.delete(fn);
  };
}
