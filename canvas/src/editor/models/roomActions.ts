// What the rooms UI does to the store: suggest and accept, select and jump, areas from a
// selection, keys field by field, levels with their first layer. Every map edit is a
// command through `undoManager`, one undo step each; selection and view state are not.
import { useStore } from '@/store/store';
import {
  AcceptRoomsCommand,
  AddAreaCommand,
  AddLayerCommand,
  AddLevelCommand,
  CompositeCommand,
  SetRoomKeyCommand,
} from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import { createDungeonLayer } from '@/store/factories';
import { notify } from '@dnd/ui/toast';
import { suggestDivides, suggestRooms } from '@dnd/core/src/shared/suggestRooms';
import { roomContextOf } from '@dnd/core/src/shared/roomFloor';
import { pointInRing, roomFace } from '@dnd/core/src/shared/roomUtils';
import { emptyRoomKey, roomKeyOf } from '@dnd/core/src/shared/prep';
import type { DungeonLayer, Layer, MapBuilderStore, Room, RoomKey, ThresholdSegment } from '@/store/types';
import { jumpToPoint } from './jumpTo';
import { isKeyEmpty, SUGGEST_NOTHING } from './roomModel';

export function activeDungeon(state: MapBuilderStore = useStore.getState()): DungeonLayer | null {
  const layer = state.layers.find((l) => l.id === state.ui.activeLayerId);
  return layer && layer.type === 'dungeon' ? (layer as DungeonLayer) : null;
}

/* ── Suggest ────────────────────────────────────────────── */

/** The layer the proposals were made on, while it is still a map layer. */
function suggestionLayer(state: MapBuilderStore, layerId: string): DungeonLayer | null {
  const layer = state.layers.find((l) => l.id === layerId);
  return layer && layer.type === 'dungeon' ? (layer as DungeonLayer) : null;
}

/** The ghosts for `divides`, leaving out any whose face holds a spot the DM took a ghost away from. */
function ghostsFor(state: MapBuilderStore, layer: DungeonLayer, divides: ThresholdSegment[], rejected: [number, number][]): Room[] {
  const found = suggestRooms(layer, roomContextOf(state, layer), divides);
  return found.filter((r) => !rejected.some(([x, y]) => pointInRing(x, y, roomFace(r))));
}

/**
 * Propose rooms for every closed space of the active layer that holds none, with the divide
 * lines that split a floor where it narrows (chambers and passages apart). The proposals sit
 * in `ui.roomSuggestions` as ghosts and dashed lines until accepted or dismissed. Returns how
 * many rooms were found; with none, a toast (and the panel) say why.
 */
export function suggestOnActiveLayer(): number {
  const state = useStore.getState();
  const layer = activeDungeon(state);
  if (!layer) {
    notify.warning('Pick a map layer first');
    return 0;
  }
  const ctx = roomContextOf(state, layer);
  const divides = suggestDivides(layer, ctx);
  const found = suggestRooms(layer, ctx, divides);
  if (found.length === 0) {
    state.setRoomSuggestions(null);
    notify.info(SUGGEST_NOTHING);
    return 0;
  }
  state.setRoomSuggestions({ layerId: layer.id, rooms: found, divides, rejected: [] });
  return found.length;
}

/** Take one proposed divide line away: the ghosts are found again from the lines left. */
export function removeSuggestedLine(lineId: string): void {
  const state = useStore.getState();
  const list = state.ui.roomSuggestions;
  if (!list?.divides?.some((d) => d.id === lineId)) return;
  const layer = suggestionLayer(state, list.layerId);
  if (!layer) return;
  const divides = list.divides.filter((d) => d.id !== lineId);
  state.setRoomSuggestions({ ...list, divides, rooms: ghostsFor(state, layer, divides, list.rejected ?? []) });
}

/** Take one ghost away. Its spot is kept, so finding the ghosts again leaves it out. */
export function rejectSuggestedRoom(roomId: string): void {
  const state = useStore.getState();
  const list = state.ui.roomSuggestions;
  const room = list?.rooms.find((r) => r.id === roomId);
  if (!list || !room) return;
  state.setRoomSuggestions({ ...list, rooms: list.rooms.filter((r) => r.id !== roomId), rejected: [...(list.rejected ?? []), room.anchor] });
}

/**
 * Keep one ghost: it becomes a room on the layer the proposals were made on, with the lines
 * still proposed (its face was found with them), as one undo step. The other ghosts stay.
 */
export function acceptSuggestedRoom(roomId: string): void {
  const state = useStore.getState();
  const list = state.ui.roomSuggestions;
  const room = list?.rooms.find((r) => r.id === roomId);
  if (!list || !room || !suggestionLayer(state, list.layerId)) return;
  state.setRoomSuggestions({ ...list, rooms: list.rooms.filter((r) => r.id !== roomId), divides: [] });
  undoManager.execute(new AcceptRoomsCommand(list.layerId, [room], list.divides ?? []));
}

/** Add every proposal still standing to the layer they were made on, lines first, as one undo step. */
export function acceptAllSuggestions(): void {
  const state = useStore.getState();
  const suggestions = state.ui.roomSuggestions;
  state.setRoomSuggestions(null);
  if (!suggestions || suggestions.rooms.length === 0) return;
  const { layerId, rooms } = suggestions;
  if (!suggestionLayer(state, layerId)) return;
  undoManager.execute(new AcceptRoomsCommand(layerId, rooms, suggestions.divides ?? []));
  notify.subtle(`${rooms.length} room${rooms.length === 1 ? '' : 's'} added`, { icon: 'plus' });
}

export function dismissSuggestions(): void {
  useStore.getState().setRoomSuggestions(null);
}

/* ── Outline ────────────────────────────────────────────── */

/** A room card's Outline it: the Outline tool in hand, its next outline going to this room. */
export function startOutlineFor(roomId: string, layerId: string): void {
  const s = useStore.getState();
  if (s.ui.activeLayerId !== layerId) s.setActiveLayerId(layerId);
  s.setActiveTool('outline');
  useStore.setState((d) => {
    d.ui.outlineRoomId = roomId;
  });
}

/** Drop a pending Outline it. */
export function clearOutlineTarget(): void {
  if (useStore.getState().ui.outlineRoomId === null) return;
  useStore.setState((d) => {
    d.ui.outlineRoomId = null;
  });
}

/* ── Selecting ──────────────────────────────────────────── */

/** Where a room's badge sits: its anchor (always inside it). */
export function roomPoint(room: Pick<Room, 'anchor' | 'centroid'>): { x: number; y: number } {
  const [x, y] = room.anchor ?? room.centroid ?? [0, 0];
  return { x, y };
}

/** Select a room, draw on its layer, and bring it into view beside `sheet`. */
export function selectRoom(room: Room, layerId: string, sheet: Element | null = null): void {
  const s = useStore.getState();
  if (s.ui.activeLayerId !== layerId) s.setActiveLayerId(layerId);
  s.setSelectedIds([room.id]);
  jumpToPoint(roomPoint(room), sheet);
}

/** Select an area (its card shows; the overlay draws its extent). */
export function selectArea(areaId: string, layerId: string): void {
  const s = useStore.getState();
  if (s.ui.activeLayerId !== layerId) s.setActiveLayerId(layerId);
  s.setSelectedIds([areaId]);
}

/** The selected rooms, grouped by layer: only one layer's rooms can form an area. */
export function selectedRoomsByLayer(state: MapBuilderStore = useStore.getState()): Map<string, string[]> {
  const ids = new Set(state.selection.selectedIds);
  const out = new Map<string, string[]>();
  for (const layer of state.layers) {
    if (layer.type !== 'dungeon') continue;
    const hit = ((layer as DungeonLayer).rooms ?? []).filter((r) => ids.has(r.id)).map((r) => r.id);
    if (hit.length > 0) out.set(layer.id, hit);
  }
  return out;
}

/** "Area N": one past the highest numbered area name on the layer. */
export function nextAreaName(layer: DungeonLayer): string {
  const max = (layer.areas ?? []).reduce((m, a) => {
    const hit = /^Area (\d+)$/.exec(a.name);
    return hit ? Math.max(m, Number(hit[1])) : m;
  }, 0);
  return `Area ${max + 1}`;
}

/**
 * A new area holding the selected rooms (one layer's; the active layer's when the
 * selection spans several). Returns the new area's id, or null with nothing to group.
 */
export function newAreaFromSelection(): string | null {
  const state = useStore.getState();
  const byLayer = selectedRoomsByLayer(state);
  const layerId = byLayer.has(state.ui.activeLayerId) ? state.ui.activeLayerId : [...byLayer.keys()][0];
  const roomIds = layerId ? byLayer.get(layerId) : undefined;
  const layer = state.layers.find((l) => l.id === layerId) as DungeonLayer | undefined;
  if (!layer || !roomIds || roomIds.length === 0) {
    notify.info('Select rooms on the map or in the list first');
    return null;
  }
  const area = { id: crypto.randomUUID(), name: nextAreaName(layer) };
  undoManager.execute(new AddAreaCommand(layer.id, area, roomIds));
  return area.id;
}

/** Open the rooms sheet on one room's key. */
export function openRoomKey(roomId: string): void {
  const s = useStore.getState();
  s.setRoomsSheetRoomId(roomId);
  s.setRoomsSheetOpen(true);
}

/* ── Keys ───────────────────────────────────────────────── */

export function currentKey(roomId: string): RoomKey {
  return structuredClone(roomKeyOf(useStore.getState().prep, roomId) ?? emptyRoomKey(roomId));
}

/**
 * Write part of a room's key as one undo step; nothing when it changes nothing. A key
 * left with nothing in it is removed, so "has a key" always means it says something.
 */
export function writeRoomKey(roomId: string, patch: Partial<RoomKey>): void {
  const before = currentKey(roomId);
  const next: RoomKey = { ...before, ...structuredClone(patch), roomId };
  if (next.encounter && next.encounter.name.trim() === '' && next.encounter.monsters.length === 0) delete next.encounter;
  if (JSON.stringify(next) === JSON.stringify(before)) return;
  undoManager.execute(new SetRoomKeyCommand(roomId, isKeyEmpty(next) ? null : next));
}

/* ── Levels ─────────────────────────────────────────────── */

function nextName(prefix: string, names: string[]): string {
  const re = new RegExp(`^${prefix} (\\d+)$`);
  const max = names.reduce((m, n) => {
    const hit = re.exec(n);
    return hit ? Math.max(m, Number(hit[1])) : m;
  }, 0);
  return `${prefix} ${Math.max(max, names.length) + 1}`;
}

export function nextLayerName(layers: readonly Layer[]): string {
  const max = layers.reduce((m, l) => {
    const hit = l.type === 'dungeon' ? /^Layer (\d+)$/.exec(l.name) : null;
    return hit ? Math.max(m, Number(hit[1])) : m;
  }, 0);
  return `Layer ${max + 1}`;
}

/**
 * A new level with one empty dungeon layer on it, as one undo step, and switch to it:
 * the filmstrip then shows that first layer, ready to draw on.
 */
export function addLevelWithLayer(): string {
  const state = useStore.getState();
  const level = { id: crypto.randomUUID(), name: nextName('Level', state.levels.map((l) => l.name)) };
  const layer = createDungeonLayer(nextLayerName(state.layers), level.id);
  undoManager.execute(
    new CompositeCommand('New level', [new AddLevelCommand(level), new AddLayerCommand('New level', layer)]),
  );
  const s = useStore.getState();
  s.setActiveLevelId(level.id);
  s.setActiveLayerId(layer.id);
  notify.subtle(`${level.name} added`, { icon: 'plus' });
  return level.id;
}

/** A new dungeon layer on a level, and draw on it. */
export function addLayerToLevel(levelId: string): void {
  const state = useStore.getState();
  const layer = createDungeonLayer(nextLayerName(state.layers), levelId);
  undoManager.execute(new AddLayerCommand('Add layer', layer));
  useStore.getState().setActiveLayerId(layer.id);
  notify.subtle('Layer added', { icon: 'plus' });
}
