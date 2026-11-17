import { MapCard } from '../../shell/MapCard';
import { DoorActions } from './DoorActions';
import { doorLabel, doorStatusLabel } from './doors';
import { useDoorSelection } from './selection';
import { useLiveDoors } from './useLiveDoors';
import { useSessionStore } from '../../session/store';
import { serverRooms } from '../fog/fog';

/** The door card: beside the selected door, its state and its controls. */
export function DoorCard() {
  const selectedId = useDoorSelection((s) => s.selectedId);
  const doors = useLiveDoors();
  const mapData = useSessionStore((s) => s.mapData);
  const index = doors.findIndex((d) => d.door.id === selectedId);
  const entry = index >= 0 ? doors[index] : undefined;
  if (!entry) return null;
  const [x, y] = entry.door.position;
  return (
    <MapCard
      testId="door-card"
      title={doorLabel(entry.door, index, serverRooms(mapData))}
      at={() => ({ x, y })}
      onClose={() => useDoorSelection.getState().select(null)}
    >
      <span className="text-xs text-text-2" data-testid="door-status">
        {doorStatusLabel(entry.door, entry.live)}
      </span>
      <DoorActions entry={entry} frame={false} />
    </MapCard>
  );
}
