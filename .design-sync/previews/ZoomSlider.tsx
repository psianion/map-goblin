import { ZoomSlider } from 'map-builder';

// Canvas zoom control from the status bar. Propless — the zoom level lives in
// the store, so the card shows it at the app's default 100%.
export function Default() {
  return (
    <div className="inline-flex items-center rounded-lg border border-border px-3 py-2">
      <ZoomSlider />
    </div>
  );
}
