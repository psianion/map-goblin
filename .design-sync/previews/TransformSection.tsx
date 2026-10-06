import { TransformSection, useStore } from 'map-builder';

const noop = () => {};

// TransformSection resolves the child's PARENT LAYER from the store and
// returns null when it can't find one, so the child has to actually live in a
// layer — seeding it through addChild is what makes this render at all.
const store = useStore.getState();
const layer = store.layers.find((l) => l.type !== 'background')!;

const crate = {
  id: 'preview-asset-1',
  name: 'Supply crate',
  childType: 'asset' as const,
  visible: true,
  objectType: 'asset' as const,
  assetId: 'gg-demo/props/crate',
  position: { x: 288, y: 192 },
  // radians, not degrees — the panel renders this as ~15°
  rotation: Math.PI / 12,
  scale: 1.25,
  width: 96,
  height: 96,
  tint: '#ffffff',
  flipX: false,
  flipY: false,
};

store.addChild(layer.id, crate);

export function Open() {
  return (
    <div className="w-[320px] overflow-hidden rounded-lg border border-border">
      <TransformSection
        child={crate}
        openSections={new Set(['transform'])}
        onToggleSection={noop}
      />
    </div>
  );
}

export function Collapsed() {
  return (
    <div className="w-[320px] overflow-hidden rounded-lg border border-border">
      <TransformSection child={crate} openSections={new Set()} onToggleSection={noop} />
    </div>
  );
}
