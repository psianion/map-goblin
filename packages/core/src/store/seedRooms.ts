import type { RoomChild } from '../shared/types';
import { AddChildCommand, CompositeCommand } from './commands';
import { authoredRoomChildren } from '../shared/authoredRooms';
import { undoManager } from './undoManager';
import { useStore } from './store';

/**
 * Turn the rooms detection currently sees into rooms the DM owns.
 *
 * The ids are fresh uuids, deliberately NOT `computeStableRoomId`: that hash of
 * the centroid is the churn this whole feature exists to end, and re-deriving it
 * here out of habit would hand the authored rooms the same fragile identity they
 * are replacing. The old ids are therefore not carried over — seeding is a
 * one-way door, which is why it lands as a single undoable entry.
 *
 * A layer that already has drawn rooms is skipped: its `layer.rooms` is the
 * authored set, so seeding from it would only clone what is already there.
 */
export function seedRoomsFromDetection(layerId: string): number {
  const layer = useStore.getState().layers.find((l) => l.id === layerId);
  if (!layer || layer.type !== 'dungeon') return 0;
  if (authoredRoomChildren(layer.children).length > 0) return 0;

  const seeds: RoomChild[] = (layer.rooms ?? [])
    .filter((room) => room.boundary.length >= 3)
    .map((room) => ({
      id: crypto.randomUUID(),
      name: room.name,
      childType: 'room',
      visible: true,
      contours: [room.boundary.map(([x, y]): [number, number] => [x, y])],
    }));
  if (seeds.length === 0) return 0;

  undoManager.execute(
    new CompositeCommand(
      'Seed rooms from detection',
      seeds.map((child) => new AddChildCommand('Seed room', layerId, child)),
    ),
  );
  return seeds.length;
}
