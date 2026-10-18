import { OrientationCompass } from 'map-builder';

const noop = () => {};

export function Cardinals() {
  return (
    <div className="flex items-center gap-6">
      <OrientationCompass value={0} onChange={noop} />
      <OrientationCompass value={90} onChange={noop} />
      <OrientationCompass value={180} onChange={noop} />
      <OrientationCompass value={270} onChange={noop} />
    </div>
  );
}

export function OffAxis() {
  return (
    <div className="flex items-center gap-6">
      <OrientationCompass value={35} onChange={noop} />
      <OrientationCompass value={215} onChange={noop} />
    </div>
  );
}
