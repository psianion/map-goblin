import { NumberInput } from 'map-builder';

const noop = () => {};

export function Default() {
  return (
    <div className="flex items-center gap-3">
      <NumberInput value={64} onChange={noop} aria-label="Grid size" />
      <NumberInput value={1.5} onChange={noop} step={0.1} aria-label="Scale" />
    </div>
  );
}

export function Bounded() {
  return (
    <div className="flex items-center gap-3">
      <NumberInput value={0} onChange={noop} min={0} max={360} aria-label="Rotation at minimum" />
      <NumberInput value={360} onChange={noop} min={0} max={360} aria-label="Rotation at maximum" />
    </div>
  );
}

export function Disabled() {
  return <NumberInput value={64} onChange={noop} disabled aria-label="Grid size (locked)" />;
}

export function InFieldRow() {
  return (
    <div className="flex w-[260px] flex-col gap-2 text-sm">
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground">Width</span>
        <NumberInput value={40} onChange={noop} min={1} aria-label="Width in squares" />
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground">Height</span>
        <NumberInput value={30} onChange={noop} min={1} aria-label="Height in squares" />
      </div>
    </div>
  );
}
