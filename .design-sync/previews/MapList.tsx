import { MapList } from 'map-builder';

const noop = () => {};

const base = {
  createdAt: Date.parse('2026-08-02T10:00:00Z'),
  updatedAt: Date.parse('2026-08-27T18:30:00Z'),
  gridSize: { width: 40, height: 30 },
};

const maps = [
  { ...base, id: 'map-warren', name: 'Goblin Warren — clearing', layerCount: 4 },
  { ...base, id: 'map-mine', name: 'Cave mine — lower shaft', layerCount: 7 },
  { ...base, id: 'map-keep', name: 'Fieldstone Keep — gatehouse', layerCount: 3 },
];

export function Populated() {
  return (
    <div className="w-[320px]">
      <MapList
        maps={maps}
        activeMapId="map-warren"
        onSwitch={noop}
        onRename={noop}
        onDuplicate={noop}
        onDelete={noop}
        onSettings={noop}
      />
    </div>
  );
}

export function Empty() {
  return (
    <div className="w-[320px]">
      <MapList
        maps={[]}
        activeMapId={undefined}
        onSwitch={noop}
        onRename={noop}
        onDuplicate={noop}
        onDelete={noop}
        onSettings={noop}
      />
    </div>
  );
}
