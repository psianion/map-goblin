import { CatalogBrowserPanel } from 'map-builder';

// The pack catalogue browser — filters plus the entry grid, all store-driven.
export function Default() {
  return (
    <div className="h-[460px] w-[340px] overflow-hidden rounded-lg border border-border">
      <CatalogBrowserPanel />
    </div>
  );
}
