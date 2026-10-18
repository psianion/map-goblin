import { MapsSidePanel } from 'map-builder';

// Propless — the map list comes from the store. With no campaign loaded this
// is the panel's genuine empty state, which is what a new user meets first.
export function Default() {
  return (
    <div className="h-[420px] w-[320px] overflow-hidden rounded-lg border border-border">
      <MapsSidePanel />
    </div>
  );
}
