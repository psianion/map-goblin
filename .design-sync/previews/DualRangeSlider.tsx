import { DualRangeSlider } from 'map-builder';

const noop = () => {};

export function Default() {
  return (
    <div className="w-[300px]">
      <DualRangeSlider min={0} max={1440} step={15} value={[420, 1140]} onChange={noop} />
    </div>
  );
}

export function FormattedAsClock() {
  const clock = (v: number) =>
    `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
  return (
    <div className="w-[300px]">
      <DualRangeSlider
        min={0}
        max={1440}
        step={15}
        value={[360, 1200]}
        onChange={noop}
        formatValue={clock}
      />
    </div>
  );
}

export function NarrowBand() {
  return (
    <div className="w-[300px]">
      <DualRangeSlider min={0} max={100} step={1} value={[45, 55]} onChange={noop} />
    </div>
  );
}
