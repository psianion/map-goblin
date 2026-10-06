import { PropertyField, NumberInput, SelectInput, ToggleSwitch } from 'map-builder';

const noop = () => {};

export function Single() {
  return (
    <div className="w-[280px]">
      <PropertyField label="Grid size">
        <NumberInput value={64} onChange={noop} aria-label="Grid size" />
      </PropertyField>
    </div>
  );
}

export function Stack() {
  return (
    <div className="flex w-[280px] flex-col gap-2">
      <PropertyField label="Width">
        <NumberInput value={40} onChange={noop} min={1} aria-label="Width" />
      </PropertyField>
      <PropertyField label="Height">
        <NumberInput value={30} onChange={noop} min={1} aria-label="Height" />
      </PropertyField>
      <PropertyField label="Floor">
        <SelectInput
          value="cobble"
          onChange={noop}
          options={[
            { value: 'cobble', label: 'Cobblestone' },
            { value: 'plank', label: 'Timber plank' },
          ]}
        />
      </PropertyField>
      <PropertyField label="Locked">
        <ToggleSwitch checked={false} onChange={noop} />
      </PropertyField>
    </div>
  );
}
