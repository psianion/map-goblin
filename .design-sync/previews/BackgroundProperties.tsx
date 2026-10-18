import { BackgroundProperties, useStore } from 'map-builder';

const noop = () => {};

// The real background layer from the store — every map has exactly one.
// Its collapsible section id is "bg".
const backgroundLayer = useStore.getState().layers.find((l) => l.type === 'background')!;

export function Default() {
  return (
    <div className="w-[320px] overflow-hidden rounded-lg border border-border">
      <BackgroundProperties layer={backgroundLayer} openSections={new Set(['bg'])} onToggleSection={noop} />
    </div>
  );
}

export function Collapsed() {
  return (
    <div className="w-[320px] overflow-hidden rounded-lg border border-border">
      <BackgroundProperties layer={backgroundLayer} openSections={new Set()} onToggleSection={noop} />
    </div>
  );
}
