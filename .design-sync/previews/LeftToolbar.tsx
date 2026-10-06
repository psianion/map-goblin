import { LeftToolbar } from 'map-builder';

// The vertical tool rail. Propless — the active tool comes from the store, so
// the highlighted item is the app's real default (select).
export function Default() {
  return (
    <div className="inline-flex h-[520px] overflow-hidden rounded-lg border border-border">
      <LeftToolbar />
    </div>
  );
}
