import { CatalogFilters } from 'map-builder';

const noop = () => {};

const themes = ['dungeon', 'cave', 'forest', 'keep'];
const materials = ['stone', 'timber', 'earth', 'moss'];

export function Unfiltered() {
  return (
    <div className="w-[340px]">
      <CatalogFilters
        filters={{ type: '', theme: '', material: '', query: '' }}
        onChange={noop}
        availableThemes={themes}
        availableMaterials={materials}
      />
    </div>
  );
}

export function Narrowed() {
  return (
    <div className="w-[340px]">
      <CatalogFilters
        filters={{ type: 'floor', theme: 'cave', material: 'stone', query: 'rough' }}
        onChange={noop}
        availableThemes={themes}
        availableMaterials={materials}
      />
    </div>
  );
}
