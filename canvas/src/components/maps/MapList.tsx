import { MapCard } from './MapCard';
import type { MapMeta } from '@/store/types';

interface MapListProps {
  maps: MapMeta[];
  activeMapId: string | null;
  onSwitch: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}

export function MapList({
  maps,
  activeMapId,
  onSwitch,
  onRename,
  onDuplicate,
  onDelete,
}: MapListProps) {
  // Already expected sorted by updatedAt desc from parent
  if (maps.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-4 py-8">
        <p className="text-sm text-text-muted text-center font-mono">
          No maps yet. Create one to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto min-h-0 flex flex-col gap-1 px-2 py-2">
      {maps.map((map) => (
        <MapCard
          key={map.id}
          map={map}
          isActive={map.id === activeMapId}
          onSwitch={onSwitch}
          onRename={onRename}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}
