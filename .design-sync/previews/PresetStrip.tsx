import { PresetStrip } from 'map-builder';

const noop = () => {};

const presets = [
  { id: 'fieldstone', label: 'Fieldstone Keep', color: '#8a8375' },
  { id: 'palisade', label: 'Timber Palisade', color: '#8a7f5a' },
  { id: 'cave', label: 'Cave / Natural', color: '#6b6257' },
  { id: 'classic', label: 'Classic Dungeon', color: '#7f8a92' },
  { id: 'dark', label: 'Dark Stone', color: '#3f4a48' },
];

export function Default() {
  return (
    <div className="w-[340px]">
      <PresetStrip presets={presets} activeId="fieldstone" onSelect={noop} />
    </div>
  );
}

export function DifferentSelection() {
  return (
    <div className="w-[340px]">
      <PresetStrip presets={presets} activeId="cave" onSelect={noop} />
    </div>
  );
}

export function NoSelection() {
  return (
    <div className="w-[340px]">
      <PresetStrip presets={presets} onSelect={noop} />
    </div>
  );
}
