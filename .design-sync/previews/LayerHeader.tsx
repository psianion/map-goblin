import { LayerHeader } from 'map-builder';

// The layer panel's header strip: title plus the add/collapse affordances.
export function Default() {
  return (
    <div className="w-[300px] overflow-hidden rounded-lg border border-border">
      <LayerHeader />
    </div>
  );
}
