import { LayerPanel } from 'map-builder';

// Takes no props — it reads the map document straight from the store, so the
// card shows the panel's real first-run state (one terrain layer over the
// background) rather than a mocked-up tree.
export function Default() {
  return (
    <div className="h-[420px] w-[300px] overflow-hidden rounded-lg border border-border">
      <LayerPanel />
    </div>
  );
}
