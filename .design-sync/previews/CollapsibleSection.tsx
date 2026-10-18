import { CollapsibleSection, PropertyField, NumberInput, ToggleSwitch } from 'map-builder';
import { Grid3x3, Sun } from 'lucide-react';

const noop = () => {};

// The section shell every properties panel is built from: uppercase title with
// a lucide icon, an optional preview or headerExtra on the right, and children.
export function Open() {
  return (
    <div className="w-[320px]">
      <CollapsibleSection id="grid" title="Grid" icon={Grid3x3} defaultOpen>
        <PropertyField label="Size">
          <NumberInput value={64} onChange={noop} aria-label="Grid size" />
        </PropertyField>
      </CollapsibleSection>
    </div>
  );
}

export function Collapsed() {
  return (
    <div className="w-[320px]">
      <CollapsibleSection id="grid" title="Grid" icon={Grid3x3} defaultOpen={false}>
        <PropertyField label="Size">
          <NumberInput value={64} onChange={noop} aria-label="Grid size" />
        </PropertyField>
      </CollapsibleSection>
    </div>
  );
}

export function WithHeaderExtra() {
  return (
    <div className="w-[320px]">
      <CollapsibleSection
        id="environment"
        title="Environment"
        icon={Sun}
        defaultOpen={false}
        headerExtra={<ToggleSwitch checked onChange={noop} label="Enable environment" />}
      >
        <PropertyField label="Time">
          <NumberInput value={12} onChange={noop} min={0} max={23} aria-label="Hour" />
        </PropertyField>
      </CollapsibleSection>
    </div>
  );
}
