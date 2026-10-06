import { LightProperties } from 'map-builder';

const noop = () => {};

// Valid LightChild objects composed from the real interface — the two lights a
// DM actually places: a warm sconce and a cool shaft from above.
const torch = {
  id: 'preview-light-1',
  name: 'Torch sconce',
  childType: 'light' as const,
  visible: true,
  color: '#c8a45c',
  radius: 240,
  featherRadius: 90,
  intensity: 0.85,
  falloff: 'quadratic' as const,
  position: { x: 320, y: 240 },
};

const moonShaft = {
  ...torch,
  id: 'preview-light-2',
  name: 'Moon shaft',
  color: '#8fb3d9',
  radius: 420,
  featherRadius: 200,
  intensity: 0.45,
  falloff: 'linear' as const,
};

export function Torch() {
  return (
    <div className="w-[320px] overflow-hidden rounded-lg border border-border">
      <LightProperties light={torch} onDeselect={noop} />
    </div>
  );
}

export function CoolMoonlight() {
  return (
    <div className="w-[320px] overflow-hidden rounded-lg border border-border">
      <LightProperties light={moonShaft} onDeselect={noop} />
    </div>
  );
}

export function Collapsed() {
  return (
    <div className="w-[320px] overflow-hidden rounded-lg border border-border">
      <LightProperties
        light={torch}
        onDeselect={noop}
        openSections={new Set()}
        onToggleSection={noop}
      />
    </div>
  );
}
