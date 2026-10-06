import { EnvironmentSection } from 'map-builder';

const noop = () => {};

// Time-of-day and ambient light for the map. The day ribbon and its scrubber
// head live in here, so the open state is the one worth showing.
export function Open() {
  return (
    <div className="w-[320px] overflow-hidden rounded-lg border border-border">
      <EnvironmentSection openSections={new Set(['environment'])} onToggleSection={noop} />
    </div>
  );
}

export function Collapsed() {
  return (
    <div className="w-[320px] overflow-hidden rounded-lg border border-border">
      <EnvironmentSection openSections={new Set()} onToggleSection={noop} />
    </div>
  );
}
