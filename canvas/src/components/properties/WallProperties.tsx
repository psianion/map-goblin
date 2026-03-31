import { useStore } from '@/store/store';
import { SelectInput } from '@/components/inputs/SelectInput';
import { PropertyField } from './PropertyField';
import type { WallType, WallDirection } from '@/shared/types';
import { UpdateWallCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import type { DungeonLayer } from '@/store/types';

const WALL_TYPE_OPTIONS = [
  { value: 'normal', label: 'Normal' },
  { value: 'terrain', label: 'Terrain' },
  { value: 'invisible', label: 'Invisible' },
  { value: 'ethereal', label: 'Ethereal' },
  { value: 'window', label: 'Window' },
];

const DIRECTION_OPTIONS = [
  { value: 'both', label: 'Both' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
];

interface WallPropertiesProps {
  layerId: string;
  wallId: string;
}

export function WallProperties({ layerId, wallId }: WallPropertiesProps) {
  const wall = useStore((state) => {
    const layer = state.layers.find((l) => l.id === layerId);
    if (!layer || layer.type !== 'dungeon') return null;
    return (layer as DungeonLayer).standaloneWalls.find((w) => w.id === wallId) ?? null;
  });

  if (!wall) return null;

  const handleTypeChange = (value: string) => {
    undoManager.execute(new UpdateWallCommand(
      layerId, wallId,
      { wallType: wall.wallType },
      { wallType: value as WallType },
    ));
  };

  const handleDirectionChange = (value: string) => {
    undoManager.execute(new UpdateWallCommand(
      layerId, wallId,
      { direction: wall.direction },
      { direction: value as WallDirection },
    ));
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-panel-heading uppercase text-text-muted">Wall Properties</span>
      <PropertyField label="Type">
        <SelectInput
          value={wall.wallType}
          options={WALL_TYPE_OPTIONS}
          onChange={handleTypeChange}
        />
      </PropertyField>
      <PropertyField label="Direction">
        <SelectInput
          value={wall.direction}
          options={DIRECTION_OPTIONS}
          onChange={handleDirectionChange}
        />
      </PropertyField>
    </div>
  );
}
