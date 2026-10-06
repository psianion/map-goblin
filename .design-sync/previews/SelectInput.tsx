import { SelectInput } from 'map-builder';

const noop = () => {};

export function Default() {
  return (
    <div className="w-[240px]">
      <SelectInput
        value="packed-earth"
        onChange={noop}
        options={[
          { value: 'packed-earth', label: 'Packed earth' },
          { value: 'cobble', label: 'Cobblestone' },
          { value: 'plank', label: 'Timber plank' },
          { value: 'cave-rock', label: 'Cave rock' },
          { value: 'grass', label: 'Grass' },
        ]}
      />
    </div>
  );
}

export function InFieldRows() {
  return (
    <div className="flex w-[280px] flex-col gap-3 text-sm">
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground">Door type</span>
        <SelectInput
          value="wooden"
          onChange={noop}
          options={[
            { value: 'wooden', label: 'Wooden' },
            { value: 'iron', label: 'Iron' },
            { value: 'portcullis', label: 'Portcullis' },
          ]}
        />
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground">Light falloff</span>
        <SelectInput
          value="smooth"
          onChange={noop}
          options={[
            { value: 'smooth', label: 'Smooth' },
            { value: 'linear', label: 'Linear' },
            { value: 'hard', label: 'Hard edge' },
          ]}
        />
      </div>
    </div>
  );
}
