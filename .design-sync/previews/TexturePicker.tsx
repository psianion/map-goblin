import { TexturePicker } from 'map-builder';

const noop = () => {};

// Chooses a floor/wall texture from the installed packs. With no packs
// installed the picker shows its own empty state, which is the honest
// first-run render.
export function Default() {
  return (
    <div className="w-[300px] overflow-hidden rounded-lg border border-border p-2">
      <TexturePicker value="" onChange={noop} />
    </div>
  );
}
