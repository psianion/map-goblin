import type { Command, DungeonLayer, Level, Room, RoomArea, RoomKey, RoomLook, ShapeChild, ThresholdSegment } from './types';
import { ROOM_RUNTIME_KEYS } from '../shared/types';
import { patchLook } from '../shared/lookScope';
import { pointInRing, readingOrder, roomFace } from '../shared/roomUtils';
import { serializableRoom, useStore } from './store';
import { AddChildCommand, CompositeCommand } from './commands';

/*
 * Room, area and level edits. Every one is a Command through `undoManager`, so each
 * is one undo step. `affectsRooms` is set on the ones that move what a face is made
 * of — a room's existence, its anchor, a threshold — and nowhere else: a rename, a
 * number, a look or an area pin changes no face, and skipping the refresh keeps
 * those edits free.
 */

// ─── Shared plumbing ─────────────────────────────────────

/** The authored room state of one layer: what these commands snapshot. */
interface RoomsState {
  rooms: Room[];
  areas: RoomArea[];
  thresholds: ThresholdSegment[];
}

function dungeonLayer(layerId: string): DungeonLayer | null {
  const layer = useStore.getState().layers.find((l) => l.id === layerId);
  return layer && layer.type === 'dungeon' ? layer : null;
}

function readRooms(layer: DungeonLayer): RoomsState {
  return structuredClone({
    rooms: (layer.rooms ?? []).map(serializableRoom),
    areas: layer.areas ?? [],
    thresholds: layer.thresholds ?? [],
  });
}

/**
 * Write a snapshot back. Snapshots hold authored fields only; each room picks its
 * derived fields (face, centroid, doors…) back up from the live room of the same
 * id, so a command that moves no geometry leaves the faces exactly as they are
 * and one that does is followed by the refresh anyway.
 */
function writeRooms(layerId: string, next: RoomsState): void {
  useStore.setState((state) => {
    const layer = state.layers.find((l) => l.id === layerId);
    if (!layer || layer.type !== 'dungeon') return;
    const live = new Map((layer.rooms ?? []).map((r) => [r.id, r]));
    layer.rooms = next.rooms.map((room) => {
      const out = structuredClone(room) as unknown as Record<string, unknown>;
      const cur = live.get(room.id) as unknown as Record<string, unknown> | undefined;
      if (cur) for (const key of ROOM_RUNTIME_KEYS) if (cur[key] !== undefined) out[key] = cur[key];
      return out as unknown as Room;
    });
    if (next.areas.length > 0) layer.areas = structuredClone(next.areas);
    else delete layer.areas;
    if (next.thresholds.length > 0) layer.thresholds = structuredClone(next.thresholds);
    else delete layer.thresholds;
  });
}

/**
 * One edit of a layer's rooms, areas and thresholds as a before/after pair. The
 * pair is taken on the first execute, from the state the edit actually ran on, so
 * redo replays exactly that result. `edit` returning null refuses the command
 * (nothing is written and undo does nothing).
 */
abstract class RoomsEditCommand implements Command {
  abstract readonly label: string;
  readonly affectsRooms: boolean;
  protected readonly layerId: string;
  private before: RoomsState | null = null;
  private after: RoomsState | null = null;

  protected constructor(layerId: string, affectsRooms: boolean) {
    this.layerId = layerId;
    this.affectsRooms = affectsRooms;
  }

  /** Compute the new state from a private copy of the current one. `live` is the layer as it is. */
  protected abstract edit(s: RoomsState, live: DungeonLayer): RoomsState | null;

  /** Side effects outside the layer (prep, map settings), run after the write. */
  protected onExecute(): void {}
  protected onUndo(): void {}

  execute(): void {
    if (!this.after) {
      const layer = dungeonLayer(this.layerId);
      if (!layer) return;
      const before = readRooms(layer);
      const after = this.edit(structuredClone(before), layer);
      if (!after) return;
      this.before = before;
      this.after = after;
    }
    writeRooms(this.layerId, this.after);
    this.onExecute();
  }

  undo(): void {
    if (!this.before) return;
    writeRooms(this.layerId, this.before);
    this.onUndo();
  }
}

/** Room keys before and after an edit, so undo puts back exactly the keys it touched. */
class KeyEdits {
  private readonly before = new Map<string, RoomKey | null>();
  private readonly after = new Map<string, RoomKey | null>();

  /** Record the edit `roomId → key` (null removes), reading the current key on first use. */
  set(roomId: string, key: RoomKey | null): void {
    if (!this.before.has(roomId)) this.before.set(roomId, structuredClone(currentKey(roomId) ?? null));
    this.after.set(roomId, key && structuredClone(key));
  }

  apply(): void {
    for (const [roomId, key] of this.after) useStore.getState().setRoomKey(roomId, key);
  }

  revert(): void {
    for (const [roomId, key] of this.before) useStore.getState().setRoomKey(roomId, key);
  }
}

function currentKey(roomId: string): RoomKey | undefined {
  return useStore.getState().prep?.rooms.find((k) => k.roomId === roomId);
}

function setStartingRoom(roomId: string | undefined): void {
  useStore.setState((state) => {
    if (roomId) state.mapSettings.startingRoomId = roomId;
    else delete state.mapSettings.startingRoomId;
  });
}

// ─── Rooms ───────────────────────────────────────────────

/** Adds a room (a drawn one, or one accepted from Suggest). A room id already on the layer is refused. */
export class AddRoomCommand extends RoomsEditCommand {
  readonly label = 'Add room';
  private readonly room: Room;

  constructor(layerId: string, room: Room) {
    super(layerId, true);
    this.room = structuredClone(room);
  }

  protected edit(s: RoomsState): RoomsState | null {
    if (s.rooms.some((r) => r.id === this.room.id)) return null;
    s.rooms.push(serializableRoom(this.room));
    return s;
  }
}

/** Adds the suggestions the DM accepted, as one undo step. Ids already on the layer are skipped. */
export class AcceptRoomsCommand extends RoomsEditCommand {
  readonly label: string;
  private readonly rooms: Room[];

  constructor(layerId: string, rooms: Room[]) {
    super(layerId, true);
    this.rooms = structuredClone(rooms);
    this.label = rooms.length === 1 ? 'Accept room' : 'Accept rooms';
  }

  protected edit(s: RoomsState): RoomsState | null {
    const known = new Set(s.rooms.map((r) => r.id));
    const fresh = this.rooms.filter((r) => !known.has(r.id));
    if (fresh.length === 0) return null;
    s.rooms.push(...fresh.map(serializableRoom));
    return s;
  }
}

/**
 * Removes a room. The floor under it stays — a room is a place, the floor is
 * geometry. Its key goes with it (and comes back on undo), and the map stops
 * starting the table there.
 */
export class RemoveRoomCommand extends RoomsEditCommand {
  readonly label = 'Delete room';
  private readonly roomId: string;
  private readonly keys = new KeyEdits();
  private wasStart = false;

  constructor(layerId: string, roomId: string) {
    super(layerId, true);
    this.roomId = roomId;
  }

  protected edit(s: RoomsState): RoomsState | null {
    if (!s.rooms.some((r) => r.id === this.roomId)) return null;
    s.rooms = s.rooms.filter((r) => r.id !== this.roomId);
    this.keys.set(this.roomId, null);
    this.wasStart = useStore.getState().mapSettings.startingRoomId === this.roomId;
    return s;
  }

  protected onExecute(): void {
    this.keys.apply();
    if (this.wasStart) setStartingRoom(undefined);
  }

  protected onUndo(): void {
    this.keys.revert();
    if (this.wasStart) setStartingRoom(this.roomId);
  }
}

/** Renames a room. The name is the room's own field now; undo writes the previous one back. */
export class RenameRoomCommand implements Command {
  readonly label = 'Rename room';
  private readonly layerId: string;
  private readonly roomId: string;
  private readonly before: string;
  private readonly after: string;

  constructor(layerId: string, roomId: string, before: string, after: string) {
    this.layerId = layerId;
    this.roomId = roomId;
    this.before = before;
    this.after = after;
  }

  execute(): void {
    useStore.getState().updateRoom(this.layerId, this.roomId, { name: this.after });
  }

  undo(): void {
    useStore.getState().updateRoom(this.layerId, this.roomId, { name: this.before });
  }
}

/** Sets (or, with undefined, clears) one room's display number. */
export class SetRoomNumberCommand extends RoomsEditCommand {
  readonly label = 'Room number';
  private readonly roomId: string;
  private readonly number: number | undefined;

  constructor(layerId: string, roomId: string, number: number | undefined) {
    super(layerId, false);
    this.roomId = roomId;
    this.number = number;
  }

  protected edit(s: RoomsState): RoomsState | null {
    const room = s.rooms.find((r) => r.id === this.roomId);
    if (!room) return null;
    if (this.number === undefined) delete room.number;
    else room.number = this.number;
    return s;
  }
}

/**
 * The rooms list's drag to reorder: `orderedIds` become numbers 1..n in that order
 * and the layer's rooms array follows. Rooms left out keep their relative order
 * after them, numbered on from there.
 */
export class ReorderRoomsCommand extends RoomsEditCommand {
  readonly label = 'Reorder rooms';
  private readonly orderedIds: string[];

  constructor(layerId: string, orderedIds: string[]) {
    super(layerId, false);
    this.orderedIds = [...orderedIds];
  }

  protected edit(s: RoomsState): RoomsState | null {
    const byId = new Map(s.rooms.map((r) => [r.id, r]));
    const listed = this.orderedIds.map((id) => byId.get(id)).filter((r): r is Room => !!r);
    const listedIds = new Set(listed.map((r) => r.id));
    const rest = s.rooms
      .filter((r) => !listedIds.has(r.id))
      .sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity));
    s.rooms = [...listed, ...rest];
    s.rooms.forEach((r, i) => {
      r.number = i + 1;
    });
    return s;
  }
}

/** Renumbers every room on the layer 1..n top-left to bottom-right, by where each sits. */
export class RenumberByReadingOrderCommand extends RoomsEditCommand {
  readonly label = 'Renumber rooms';

  constructor(layerId: string) {
    super(layerId, false);
  }

  protected edit(s: RoomsState, live: DungeonLayer): RoomsState | null {
    // Reading order wants the faces' centroids, which only the live rooms carry.
    const order = readingOrder(live.rooms ?? []).map((r) => r.id);
    const byId = new Map(s.rooms.map((r) => [r.id, r]));
    s.rooms = order.map((id) => byId.get(id)).filter((r): r is Room => !!r);
    s.rooms.forEach((r, i) => {
      r.number = i + 1;
    });
    return s;
  }
}

/** Moves a room's anchor (its badge dragged): the room now names whichever face holds the new point. */
export class SetRoomAnchorCommand extends RoomsEditCommand {
  readonly label = 'Move room';
  private readonly roomId: string;
  private readonly anchor: [number, number];

  constructor(layerId: string, roomId: string, anchor: [number, number]) {
    super(layerId, true);
    this.roomId = roomId;
    this.anchor = [anchor[0], anchor[1]];
  }

  protected edit(s: RoomsState): RoomsState | null {
    const room = s.rooms.find((r) => r.id === this.roomId);
    if (!room) return null;
    room.anchor = [...this.anchor];
    return s;
  }
}

/** Pins or resets keys of a room's look. A key set to undefined goes back to inheriting. */
export class SetRoomLookCommand extends RoomsEditCommand {
  readonly label = 'Room look';
  private readonly roomId: string;
  private readonly patch: Partial<RoomLook>;

  constructor(layerId: string, roomId: string, patch: Partial<RoomLook>) {
    super(layerId, false);
    this.roomId = roomId;
    this.patch = { ...patch };
  }

  protected edit(s: RoomsState): RoomsState | null {
    const room = s.rooms.find((r) => r.id === this.roomId);
    if (!room) return null;
    const look = patchLook(room.look, this.patch);
    if (look) room.look = look;
    else delete room.look;
    return s;
  }
}

// ─── Thresholds, split, merge ────────────────────────────

export class AddThresholdCommand extends RoomsEditCommand {
  readonly label = 'Add threshold';
  private readonly threshold: ThresholdSegment;

  constructor(layerId: string, threshold: ThresholdSegment) {
    super(layerId, true);
    this.threshold = structuredClone(threshold);
  }

  protected edit(s: RoomsState): RoomsState | null {
    if (s.thresholds.some((t) => t.id === this.threshold.id)) return null;
    s.thresholds.push(structuredClone(this.threshold));
    return s;
  }
}

export class RemoveThresholdCommand extends RoomsEditCommand {
  readonly label = 'Remove threshold';
  private readonly thresholdId: string;

  constructor(layerId: string, thresholdId: string) {
    super(layerId, true);
    this.thresholdId = thresholdId;
  }

  protected edit(s: RoomsState): RoomsState | null {
    if (!s.thresholds.some((t) => t.id === this.thresholdId)) return null;
    s.thresholds = s.thresholds.filter((t) => t.id !== this.thresholdId);
    return s;
  }
}

/**
 * Splits a room along a new threshold. The keeper keeps its id — and with it its
 * name, key and fog; `otherRoom` is the half that is new. With `fogMode: 'copy'`
 * the new half records `derivedFrom = keeperId`, and the server copies the
 * keeper's fog to it at publish; `'hidden'` starts it unexplored.
 *
 * When the DM gives the id to the half the keeper's anchor is not in, pass that
 * half's point as `keeperAnchor` so the keeper moves with its id.
 */
export class SplitRoomCommand extends RoomsEditCommand {
  readonly label = 'Split room';
  private readonly keeperId: string;
  private readonly threshold: ThresholdSegment;
  private readonly otherRoom: Room;
  private readonly fogMode: 'copy' | 'hidden';
  private readonly keeperAnchor: [number, number] | undefined;

  constructor(
    layerId: string,
    keeperId: string,
    threshold: ThresholdSegment,
    otherRoom: Room,
    fogMode: 'copy' | 'hidden',
    keeperAnchor?: [number, number],
  ) {
    super(layerId, true);
    this.keeperId = keeperId;
    this.threshold = structuredClone(threshold);
    this.otherRoom = structuredClone(otherRoom);
    this.fogMode = fogMode;
    this.keeperAnchor = keeperAnchor && [keeperAnchor[0], keeperAnchor[1]];
  }

  protected edit(s: RoomsState): RoomsState | null {
    const keeper = s.rooms.find((r) => r.id === this.keeperId);
    if (!keeper || s.rooms.some((r) => r.id === this.otherRoom.id)) return null;
    if (this.keeperAnchor) keeper.anchor = [...this.keeperAnchor];
    const other = serializableRoom(this.otherRoom);
    if (this.fogMode === 'copy') other.derivedFrom = this.keeperId;
    else delete other.derivedFrom;
    // A new half sits in its parent's area unless the caller said otherwise.
    if (other.areaId === undefined && keeper.areaId !== undefined) other.areaId = keeper.areaId;
    s.thresholds.push(structuredClone(this.threshold));
    s.rooms.push(other);
    return s;
  }
}

/** Joins two room keys: the keeper's text first, the dropped room's after it. */
function mergeKeys(keep: RoomKey | undefined, drop: RoomKey | undefined, keepId: string): RoomKey | null {
  if (!drop) return keep ?? null;
  if (!keep) return { ...structuredClone(drop), roomId: keepId };
  const join = (a: string, b: string) => [a, b].filter((t) => t.trim() !== '').join('\n\n');
  const out: RoomKey = {
    roomId: keepId,
    readAloud: join(keep.readAloud, drop.readAloud),
    notes: join(keep.notes, drop.notes),
    treasure: join(keep.treasure, drop.treasure),
    traps: [...keep.traps, ...drop.traps],
    checks: [...keep.checks, ...drop.checks],
  };
  if (keep.encounter && drop.encounter) {
    out.encounter = { name: keep.encounter.name, monsters: [...keep.encounter.monsters, ...drop.encounter.monsters] };
  } else if (keep.encounter ?? drop.encounter) {
    out.encounter = structuredClone((keep.encounter ?? drop.encounter)!);
  }
  return structuredClone(out);
}

/** How far either side of a threshold the merge probes for the two faces. */
const PROBE = 0.25;

/** Whether a threshold has one room's face on one side and the other's on the other. */
function divides(t: ThresholdSegment, a: [number, number][], b: [number, number][]): boolean {
  for (let i = 0; i + 1 < t.points.length; i++) {
    const [x0, y0] = t.points[i];
    const [x1, y1] = t.points[i + 1];
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 1e-6) continue;
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    const nx = (-(y1 - y0) / len) * PROBE;
    const ny = ((x1 - x0) / len) * PROBE;
    const p: [number, number] = [mx + nx, my + ny];
    const q: [number, number] = [mx - nx, my - ny];
    const inA = (pt: [number, number]) => pointInRing(pt[0], pt[1], a);
    const inB = (pt: [number, number]) => pointInRing(pt[0], pt[1], b);
    if ((inA(p) && inB(q)) || (inB(p) && inA(q))) return true;
  }
  return false;
}

/**
 * Merges `dropId` into `keepId`. The keeper keeps its id; any threshold dividing
 * the two goes, the dropped room goes, its id is recorded in the keeper's
 * `mergedFrom` (the server ORs its fog in at publish), and its key's text is
 * appended to the keeper's. A wall between them stays: walls are geometry, and the
 * DM removes one deliberately.
 */
export class MergeRoomsCommand extends RoomsEditCommand {
  readonly label = 'Merge rooms';
  private readonly keepId: string;
  private readonly dropId: string;
  private readonly keys = new KeyEdits();
  private dropWasStart = false;

  constructor(layerId: string, keepId: string, dropId: string) {
    super(layerId, true);
    this.keepId = keepId;
    this.dropId = dropId;
  }

  protected edit(s: RoomsState, live: DungeonLayer): RoomsState | null {
    if (this.keepId === this.dropId) return null;
    const keep = s.rooms.find((r) => r.id === this.keepId);
    const drop = s.rooms.find((r) => r.id === this.dropId);
    if (!keep || !drop) return null;
    const liveKeep = live.rooms?.find((r) => r.id === this.keepId);
    const liveDrop = live.rooms?.find((r) => r.id === this.dropId);
    const a = liveKeep ? roomFace(liveKeep) : [];
    const b = liveDrop ? roomFace(liveDrop) : [];
    if (a.length >= 3 && b.length >= 3) s.thresholds = s.thresholds.filter((t) => !divides(t, a, b));
    s.rooms = s.rooms.filter((r) => r.id !== this.dropId);
    keep.mergedFrom = [...new Set([...(keep.mergedFrom ?? []), this.dropId, ...(drop.mergedFrom ?? [])])];
    const merged = mergeKeys(currentKey(this.keepId), currentKey(this.dropId), this.keepId);
    if (merged) this.keys.set(this.keepId, merged);
    this.keys.set(this.dropId, null);
    this.dropWasStart = useStore.getState().mapSettings.startingRoomId === this.dropId;
    return s;
  }

  protected onExecute(): void {
    this.keys.apply();
    if (this.dropWasStart) setStartingRoom(this.keepId);
  }

  protected onUndo(): void {
    this.keys.revert();
    if (this.dropWasStart) setStartingRoom(this.dropId);
  }
}

// ─── Areas ───────────────────────────────────────────────

/** Adds an area and puts `roomIds` in it. */
export class AddAreaCommand extends RoomsEditCommand {
  readonly label = 'New area';
  private readonly area: RoomArea;
  private readonly roomIds: string[];

  constructor(layerId: string, area: RoomArea, roomIds: string[]) {
    super(layerId, false);
    this.area = structuredClone(area);
    this.roomIds = [...roomIds];
  }

  protected edit(s: RoomsState): RoomsState | null {
    if (s.areas.some((a) => a.id === this.area.id)) return null;
    s.areas.push(structuredClone(this.area));
    for (const r of s.rooms) if (this.roomIds.includes(r.id)) r.areaId = this.area.id;
    return s;
  }
}

export class RenameAreaCommand extends RoomsEditCommand {
  readonly label = 'Rename area';
  private readonly areaId: string;
  private readonly name: string;

  constructor(layerId: string, areaId: string, name: string) {
    super(layerId, false);
    this.areaId = areaId;
    this.name = name;
  }

  protected edit(s: RoomsState): RoomsState | null {
    const area = s.areas.find((a) => a.id === this.areaId);
    if (!area) return null;
    area.name = this.name;
    return s;
  }
}

/** Removes an area. Its rooms stay, out of any area. */
export class RemoveAreaCommand extends RoomsEditCommand {
  readonly label = 'Remove area';
  private readonly areaId: string;

  constructor(layerId: string, areaId: string) {
    super(layerId, false);
    this.areaId = areaId;
  }

  protected edit(s: RoomsState): RoomsState | null {
    if (!s.areas.some((a) => a.id === this.areaId)) return null;
    s.areas = s.areas.filter((a) => a.id !== this.areaId);
    for (const r of s.rooms) if (r.areaId === this.areaId) delete r.areaId;
    return s;
  }
}

/** Puts rooms in an area, or (null) takes them out of any. */
export class AssignRoomsToAreaCommand extends RoomsEditCommand {
  readonly label = 'Move to area';
  private readonly roomIds: string[];
  private readonly areaId: string | null;

  constructor(layerId: string, roomIds: string[], areaId: string | null) {
    super(layerId, false);
    this.roomIds = [...roomIds];
    this.areaId = areaId;
  }

  protected edit(s: RoomsState): RoomsState | null {
    if (this.areaId !== null && !s.areas.some((a) => a.id === this.areaId)) return null;
    for (const r of s.rooms) {
      if (!this.roomIds.includes(r.id)) continue;
      if (this.areaId === null) delete r.areaId;
      else r.areaId = this.areaId;
    }
    return s;
  }
}

/** Pins or resets keys of an area's look; every room in it inherits what the area pins. */
export class SetAreaLookCommand extends RoomsEditCommand {
  readonly label = 'Area look';
  private readonly areaId: string;
  private readonly patch: Partial<RoomLook>;

  constructor(layerId: string, areaId: string, patch: Partial<RoomLook>) {
    super(layerId, false);
    this.areaId = areaId;
    this.patch = { ...patch };
  }

  protected edit(s: RoomsState): RoomsState | null {
    const area = s.areas.find((a) => a.id === this.areaId);
    if (!area) return null;
    const look = patchLook(area.look, this.patch);
    if (look) area.look = look;
    else delete area.look;
    return s;
  }
}

// ─── Levels ──────────────────────────────────────────────

export class AddLevelCommand implements Command {
  readonly label = 'New level';
  private readonly level: Level;

  constructor(level: Level) {
    this.level = structuredClone(level);
  }

  execute(): void {
    useStore.getState().addLevel(structuredClone(this.level));
  }

  undo(): void {
    // Straight splice rather than removeLevel: the level being undone is empty by
    // construction, and removeLevel's last-level guard must not block an undo.
    useStore.setState((state) => {
      state.levels = state.levels.filter((l) => l.id !== this.level.id);
      if (state.ui.activeLevelId === this.level.id) {
        const active = state.layers.find((l) => l.id === state.ui.activeLayerId);
        state.ui.activeLevelId = active?.levelId ?? state.levels[0]?.id ?? '';
      }
    });
  }
}

export class RenameLevelCommand implements Command {
  readonly label = 'Rename level';
  private readonly levelId: string;
  private readonly name: string;
  private before: string | null = null;

  constructor(levelId: string, name: string) {
    this.levelId = levelId;
    this.name = name;
  }

  execute(): void {
    const level = useStore.getState().levels.find((l) => l.id === this.levelId);
    if (!level) return;
    this.before ??= level.name;
    useStore.getState().updateLevel(this.levelId, { name: this.name });
  }

  undo(): void {
    if (this.before !== null) useStore.getState().updateLevel(this.levelId, { name: this.before });
  }
}

/**
 * Removes a level; its layers move to the first level left. Refused for the last
 * level (`refused` reads true after execute), since every layer needs one.
 */
export class RemoveLevelCommand implements Command {
  readonly label = 'Delete level';
  private readonly levelId: string;
  private snapshot: Level | null = null;
  private index = -1;
  private movedLayerIds: string[] = [];
  refused = false;

  constructor(levelId: string) {
    this.levelId = levelId;
  }

  execute(): void {
    const { levels, layers } = useStore.getState();
    const index = levels.findIndex((l) => l.id === this.levelId);
    if (index < 0 || levels.length <= 1) {
      this.refused = true;
      return;
    }
    this.refused = false;
    this.snapshot = structuredClone(levels[index]);
    this.index = index;
    this.movedLayerIds = layers.filter((l) => l.levelId === this.levelId).map((l) => l.id);
    useStore.getState().removeLevel(this.levelId);
  }

  undo(): void {
    if (!this.snapshot) return;
    const store = useStore.getState();
    store.addLevel(structuredClone(this.snapshot), this.index);
    for (const id of this.movedLayerIds) store.setLayerLevel(id, this.levelId);
  }
}

/** Moves a layer to another level. */
export class MoveLayerToLevelCommand implements Command {
  readonly label = 'Move layer to level';
  private readonly layerId: string;
  private readonly levelId: string;
  private before: string | null = null;

  constructor(layerId: string, levelId: string) {
    this.layerId = layerId;
    this.levelId = levelId;
  }

  execute(): void {
    const layer = useStore.getState().layers.find((l) => l.id === this.layerId);
    if (!layer) return;
    this.before ??= layer.levelId;
    useStore.getState().setLayerLevel(this.layerId, this.levelId);
  }

  undo(): void {
    if (this.before !== null) useStore.getState().setLayerLevel(this.layerId, this.before);
  }
}

/** Pins or resets keys of a level's look; every layer on it inherits what its style leaves unset. */
export class SetLevelLookCommand implements Command {
  readonly label = 'Level look';
  private readonly levelId: string;
  private readonly patch: Partial<RoomLook>;
  private before: RoomLook | undefined | null = null;

  constructor(levelId: string, patch: Partial<RoomLook>) {
    this.levelId = levelId;
    this.patch = { ...patch };
  }

  execute(): void {
    const level = useStore.getState().levels.find((l) => l.id === this.levelId);
    if (!level) return;
    if (this.before === null) this.before = level.look && structuredClone(level.look);
    useStore.getState().updateLevel(this.levelId, { look: patchLook(this.before, this.patch) });
  }

  undo(): void {
    if (this.before !== null) useStore.getState().updateLevel(this.levelId, { look: this.before });
  }
}

// ─── Map-wide room settings and keys ─────────────────────

/** The room the table starts in by default (null clears it). */
export class SetStartingRoomCommand implements Command {
  readonly label = 'Starting room';
  private readonly roomId: string | null;
  private before: string | undefined | null = null;

  constructor(roomId: string | null) {
    this.roomId = roomId;
  }

  execute(): void {
    if (this.before === null) this.before = useStore.getState().mapSettings.startingRoomId;
    setStartingRoom(this.roomId ?? undefined);
  }

  undo(): void {
    if (this.before !== null) setStartingRoom(this.before);
  }
}

/** Writes one room's key (null removes it). One undo step per field edit in the key editor. */
export class SetRoomKeyCommand implements Command {
  readonly label = 'Room key';
  private readonly keys = new KeyEdits();

  constructor(roomId: string, key: RoomKey | null) {
    this.keys.set(roomId, key && { ...key, roomId });
  }

  execute(): void {
    this.keys.apply();
  }

  undo(): void {
    this.keys.revert();
  }
}

// ─── Drawing a room ──────────────────────────────────────

/**
 * Draw room: the floor shape and the room on it land as one composite, so one undo
 * removes both. With `roomWalls: 'none'` the floor's outline is pinned to no stone
 * set (the existing "no stones" path), so the room gets a floor and no walls.
 */
export function createDrawRoomCommand(
  layerId: string,
  shape: ShapeChild,
  room: Room,
  roomWalls: 'with' | 'none' = 'with',
): Command {
  const floor: ShapeChild =
    roomWalls === 'none' ? { ...shape, styleOverrides: { ...(shape.styleOverrides ?? {}), wallTextureSetId: '' } } : shape;
  return new CompositeCommand('Draw room', [
    new AddChildCommand('Draw room', layerId, floor),
    new AddRoomCommand(layerId, room),
  ]);
}

