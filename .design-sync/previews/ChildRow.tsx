import { ChildRow, useStore } from 'map-builder';

// A child row inside a layer's tree. ChildRow needs both the child and its
// owning layer, so the child is seeded through the store's own addChild and the
// layer is read straight back out — no hand-built stand-ins.
const store = useStore.getState();
const layer = store.layers.find((l) => l.type !== 'background')!;

const light = {
  id: 'preview-childrow-light',
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

const label = {
  id: 'preview-childrow-text',
  name: 'Room label',
  childType: 'text' as const,
  visible: false,
  text: 'Warren Clearing',
  position: { x: 260, y: 180 },
  rotation: 0,
  scale: 1,
  fontSize: 24,
  color: '#eae8e9',
  width: 220,
  height: 32,
};

store.addChild(layer.id, light);
store.addChild(layer.id, label);

const withChildren = useStore.getState().layers.find((l) => l.id === layer.id)!;

export function Light() {
  return (
    <div className="w-[300px] overflow-hidden rounded-lg border border-border">
      <ChildRow child={light} layer={withChildren} posInSet={1} setSize={2} />
    </div>
  );
}

export function HiddenText() {
  return (
    <div className="w-[300px] overflow-hidden rounded-lg border border-border">
      <ChildRow child={label} layer={withChildren} posInSet={2} setSize={2} />
    </div>
  );
}
