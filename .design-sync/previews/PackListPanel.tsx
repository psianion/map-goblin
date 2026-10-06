import { PackListPanel } from 'map-builder';

// Installed asset packs, read from the store. Nothing installed in a fresh
// session, so the card shows the real "no packs installed" state.
export function Default() {
  return (
    <div className="h-[420px] w-[320px] overflow-hidden rounded-lg border border-border">
      <PackListPanel />
    </div>
  );
}
