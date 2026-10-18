import { CatalogEntryCard } from 'map-builder';

const noop = () => {};

const entry = {
  entryId: 'gg-demo/floor/cave-rock-01',
  packId: 'gg-demo',
  localId: 'floor/cave-rock-01',
  type: 'floor',
  theme: 'cave',
  material: 'stone',
  gridSize: '3x3',
  tags: ['rough', 'damp', 'natural'],
  tint: '#6b6257',
  thumbnailUrl: '',
};

export function Default() {
  return (
    <div className="w-[260px]">
      <CatalogEntryCard entry={entry} onInstallPack={noop} />
    </div>
  );
}

export function TimberWall() {
  return (
    <div className="w-[260px]">
      <CatalogEntryCard
        entry={{
          ...entry,
          entryId: 'gg-forge/wall/palisade-straight',
          packId: 'gg-forge',
          localId: 'wall/palisade-straight',
          type: 'wall',
          theme: 'keep',
          material: 'timber',
          gridSize: '4x1',
          tags: ['palisade', 'straight'],
          tint: '#8a7f5a',
        }}
        onInstallPack={noop}
      />
    </div>
  );
}
