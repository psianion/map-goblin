import { AssetBrowserPanel } from 'map-builder';

// Browses the assets available from installed packs. Propless and store-driven.
export function Default() {
  return (
    <div className="h-[460px] w-[340px] overflow-hidden rounded-lg border border-border">
      <AssetBrowserPanel />
    </div>
  );
}
