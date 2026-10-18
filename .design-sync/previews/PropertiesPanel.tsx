import { PropertiesPanel } from 'map-builder';

const noop = () => {};

// Reads the current selection from the store; with nothing selected it shows
// the map-level properties, which is the panel's normal resting state.
export function Default() {
  return (
    <div className="h-[560px] w-[320px] overflow-hidden rounded-lg border border-border">
      <PropertiesPanel />
    </div>
  );
}

export function SectionsOpen() {
  return (
    <div className="h-[560px] w-[320px] overflow-hidden rounded-lg border border-border">
      <PropertiesPanel openSections={new Set(['grid', 'environment'])} onToggleSection={noop} />
    </div>
  );
}
