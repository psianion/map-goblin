import { ColorField } from 'map-builder';

const noop = () => {};

export function Default() {
  return (
    <div className="w-[240px]">
      <ColorField value="#6b7f5c" onChange={noop} />
    </div>
  );
}

export function WarmTorchlight() {
  return (
    <div className="w-[240px]">
      <ColorField value="#c8a45c" onChange={noop} />
    </div>
  );
}
