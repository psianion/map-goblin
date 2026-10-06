import { MapCard } from 'map-builder';

const noop = () => {};

const warren = {
  id: 'map-warren',
  name: 'Goblin Warren — clearing',
  createdAt: Date.parse('2026-08-02T10:00:00Z'),
  updatedAt: Date.parse('2026-08-27T18:30:00Z'),
  gridSize: { width: 40, height: 30 },
  layerCount: 4,
};

export function Active() {
  return (
    <div className="w-[300px]">
      <MapCard
        map={warren}
        isActive
        onSwitch={noop}
        onRename={noop}
        onDuplicate={noop}
        onDelete={noop}
        onSettings={noop}
      />
    </div>
  );
}

/** Nothing drawn yet, so there is no size to print — the card says "Empty". */
export function BlankMap() {
  return (
    <div className="w-[300px]">
      <MapCard
        map={{ ...warren, id: 'map-blank', name: 'Untitled Map', gridSize: { width: 0, height: 0 }, layerCount: 2 }}
        isActive={false}
        onSwitch={noop}
        onRename={noop}
        onDuplicate={noop}
        onDelete={noop}
        onSettings={noop}
      />
    </div>
  );
}

export function Inactive() {
  return (
    <div className="w-[300px]">
      <MapCard
        map={{ ...warren, id: 'map-mine', name: 'Cave mine — lower shaft', layerCount: 7 }}
        isActive={false}
        onSwitch={noop}
        onRename={noop}
        onDuplicate={noop}
        onDelete={noop}
        onSettings={noop}
      />
    </div>
  );
}
