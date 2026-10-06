import { SliderInput } from 'map-builder';

const noop = () => {};

export function Default() {
  return (
    <div className="flex w-[280px] flex-col gap-4">
      <SliderInput value={48} onChange={noop} min={8} max={128} step={4} ariaLabel="Brush size" />
      <SliderInput value={70} onChange={noop} min={0} max={100} unit="%" ariaLabel="Opacity" />
    </div>
  );
}

export function Range() {
  return (
    <div className="flex w-[280px] flex-col gap-4">
      <SliderInput value={0} onChange={noop} min={0} max={100} unit="%" ariaLabel="At minimum" />
      <SliderInput value={50} onChange={noop} min={0} max={100} unit="%" ariaLabel="At midpoint" />
      <SliderInput value={100} onChange={noop} min={0} max={100} unit="%" ariaLabel="At maximum" />
    </div>
  );
}

export function Disabled() {
  return (
    <div className="w-[280px]">
      <SliderInput
        value={35}
        onChange={noop}
        min={0}
        max={100}
        unit="%"
        disabled
        ariaLabel="Light intensity (locked)"
      />
    </div>
  );
}
