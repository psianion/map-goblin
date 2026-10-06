import { RightPanel } from 'map-builder';

// The right dock: properties for the current selection, or its empty state
// when nothing is selected — which is what the store's first-run state gives.
export function Default() {
  return (
    <div className="h-[560px] overflow-hidden rounded-lg border border-border">
      <RightPanel />
    </div>
  );
}
