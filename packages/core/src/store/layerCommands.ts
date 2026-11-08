import type { Command, DungeonLayer, ImageLayer, Layer, MapBuilderStore } from './types';
import type { AnyChild, Level, Room } from '../shared/types';
import { conditionZoneId, type RoomKey, type RoomNote, type ScenePrep, type TriggerDef } from '../shared/prep';
import { useStore } from './store';
import { CompositeCommand, PropertyCommand, RemoveLayerCommand } from './commands';
import { shownLevelId } from './selectors';
import { MoveLayerToLevelCommand, RemoveLevelCommand } from './roomCommands';
import { getChildBounds, getWallBounds } from '../engine/hitTest';

/*
 * Layer and level verbs the Layers pass adds: duplicate a layer, reorder levels, delete
 * a level with its layers, and the guards a delete or a move answers to. Every command
 * here sets `restoresUi`, so its undo puts back the active layer and the level on show.
 */

/** World box of a layer's own content. */
export interface LayerBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * What a layer holds, as one box: its floors and every other child (hidden ones too, so
 * hiding an object does not re-frame its tile) and its drawn walls. Null when empty.
 */
export function layerContentBounds(layer: Layer): LayerBounds | null {
  if (layer.type !== 'dungeon') return null;
  let out: LayerBounds | null = null;
  const add = (b: { x: number; y: number; width: number; height: number }) => {
    if (![b.x, b.y, b.width, b.height].every(Number.isFinite)) return;
    if (!out) out = { minX: b.x, minY: b.y, maxX: b.x + b.width, maxY: b.y + b.height };
    else {
      out.minX = Math.min(out.minX, b.x);
      out.minY = Math.min(out.minY, b.y);
      out.maxX = Math.max(out.maxX, b.x + b.width);
      out.maxY = Math.max(out.maxY, b.y + b.height);
    }
  };
  for (const child of layer.children) add(getChildBounds(child));
  for (const wall of layer.standaloneWalls) if (wall.points.length > 0) add(getWallBounds(wall));
  return out;
}

/** How many objects a layer holds: its children, drawn walls and rooms. */
export function layerObjectCount(layer: Layer): number {
  if (layer.type !== 'dungeon') return 0;
  return layer.children.length + layer.standaloneWalls.length + (layer.rooms?.length ?? 0);
}

/** The refusal toast for deleting the last layer of a level. */
export const LAST_LAYER_MESSAGE = 'A level needs one layer. Delete the level instead.';

/** The layers on a level (its dungeon layers and traces), in draw order. */
export function layersOnLevel(state: Pick<MapBuilderStore, 'layers'>, levelId: string): Layer[] {
  return state.layers.filter((l) => l.type !== 'background' && l.levelId === levelId);
}

/** How many dungeon layers a level holds: a level keeps one, whatever traces it has. */
const dungeonCount = (state: Pick<MapBuilderStore, 'layers'>, levelId: string) =>
  layersOnLevel(state, levelId).filter((l) => l.type === 'dungeon').length;

/** Why a layer may not be deleted right now, or null when it may. */
export function layerDeleteBlock(state: Pick<MapBuilderStore, 'layers'>, layerId: string): string | null {
  const layer = state.layers.find((l) => l.id === layerId);
  if (!layer) return 'That layer is gone';
  if (layer.type === 'background') return 'The background stays';
  if (layer.locked) return 'Layer is locked';
  if (layer.type === 'dungeon' && dungeonCount(state, layer.levelId) <= 1) return LAST_LAYER_MESSAGE;
  return null;
}

/** Why a layer may not move to another level, or null: a level never ends up empty. */
export function layerMoveBlock(state: Pick<MapBuilderStore, 'layers'>, layerId: string): string | null {
  const layer = state.layers.find((l) => l.id === layerId);
  if (!layer || layer.type !== 'dungeon') return 'Only map layers move between levels';
  if (dungeonCount(state, layer.levelId) <= 1) return LAST_LAYER_MESSAGE;
  return null;
}

/**
 * Adds a trace (a background image layer) at the bottom of its level, under the level's
 * other layers. Its picture is in `customImages` already, outside the undo stack as an
 * imported image's is.
 */
export class AddTraceLayerCommand implements Command {
  readonly label = 'Import trace';
  readonly restoresUi = true;
  private readonly layer: ImageLayer;

  constructor(layer: ImageLayer) {
    this.layer = structuredClone(layer);
  }

  execute(): void {
    const s = useStore.getState();
    s.addLayer(structuredClone(this.layer));
    const layers = useStore.getState().layers;
    const at = layers.findIndex((l) => l.type !== 'background' && l.levelId === this.layer.levelId);
    const from = layers.findIndex((l) => l.id === this.layer.id);
    if (at >= 0 && at < from) useStore.getState().reorderLayers(from, at);
  }

  undo(): void {
    useStore.getState().removeLayer(this.layer.id);
  }
}

/**
 * The trace toggle: hides every trace on the level on show when any shows, else shows them
 * all. One undo step; null when the level has none.
 */
export function traceToggleCommand(state: Pick<MapBuilderStore, 'layers' | 'levels' | 'ui'>): Command | null {
  const level = shownLevelId(state);
  const traces = state.layers.filter((l): l is ImageLayer => l.type === 'image' && (state.levels.length === 0 || l.levelId === level));
  if (traces.length === 0) return null;
  const show = !traces.some((l) => l.visible);
  const label = show ? 'Show trace' : 'Hide trace';
  return new CompositeCommand(
    label,
    traces.map((l) => new PropertyCommand(label, { type: 'layer', layerId: l.id }, { visible: l.visible }, { visible: show })),
  );
}

/**
 * A fresh copy of a layer's rooms, areas and children, every id new and every link inside
 * remapped. `ids`, when given, collects each child's and room's old id against its new one,
 * for links from outside the layer (prep) to follow.
 */
function cloneLayerContent(source: DungeonLayer, id: string, name: string, ids = new Map<string, string>()): DungeonLayer {
  const copy = structuredClone(source) as DungeonLayer;
  copy.id = id;
  copy.name = name;
  copy.mergedFloor = source.mergedFloor ? structuredClone(source.mergedFloor) : null;

  const wallIds = new Map<string, string>();
  for (const wall of copy.standaloneWalls) {
    const next = crypto.randomUUID();
    wallIds.set(wall.id, next);
    wall.id = next;
  }
  const groupIds = new Map<string, string>();
  for (const g of copy.groups ?? []) {
    const next = crypto.randomUUID();
    groupIds.set(g.id, next);
    g.id = next;
  }
  const childIds = ids;
  for (const child of copy.children) childIds.set(child.id, crypto.randomUUID());
  copy.children = copy.children.map((c): AnyChild => {
    const out = { ...c, id: childIds.get(c.id)! } as AnyChild;
    if (out.groupId) {
      if (groupIds.has(out.groupId)) out.groupId = groupIds.get(out.groupId);
      else delete out.groupId;
    }
    if (out.childType === 'door') {
      if (wallIds.has(out.wallId)) out.wallId = wallIds.get(out.wallId)!;
      // Which rooms a door joins is derived again for the copy's own rooms.
      delete out.roomA;
      delete out.roomB;
    }
    if (out.childType === 'light' && out.attachedTo) {
      if (childIds.has(out.attachedTo)) out.attachedTo = childIds.get(out.attachedTo);
      else delete out.attachedTo;
    }
    return out;
  });

  const areaIds = new Map<string, string>();
  for (const a of copy.areas ?? []) {
    const next = crypto.randomUUID();
    areaIds.set(a.id, next);
    a.id = next;
  }
  // Rooms are places: a copy is a new place, with no lineage and no key notes of its own.
  copy.rooms = copy.rooms?.map((r): Room => {
    const out: Room = { ...r, id: crypto.randomUUID() };
    ids.set(r.id, out.id);
    delete out.derivedFrom;
    delete out.mergedFrom;
    delete out.doors;
    if (out.areaId) {
      if (areaIds.has(out.areaId)) out.areaId = areaIds.get(out.areaId);
      else delete out.areaId;
    }
    return out;
  });
  if (copy.rooms && copy.rooms.length === 0) delete copy.rooms;
  if (copy.thresholds) copy.thresholds = copy.thresholds.map((t) => ({ ...t, id: crypto.randomUUID() }));
  if (copy.materials) copy.materials = copy.materials.map((p) => ({ ...p, id: crypto.randomUUID() }));
  // A label that follows a room or a door follows the copy's own.
  for (const child of copy.children) {
    if (child.childType === 'text' && child.bound && ids.has(child.bound.id)) {
      child.bound = { ...child.bound, id: ids.get(child.bound.id)! };
    }
  }
  return copy;
}

/** What a level clone adds: the level, its layers, and the prep copied onto them. */
interface LevelClonePlan {
  level: Level;
  index: number;
  layers: Layer[];
  keys: RoomKey[];
  notes: RoomNote[];
  triggers: TriggerDef[];
}

/** The level clone's prep: every key, note and trigger anchored on the source, onto the copy's ids. */
function clonePrep(prep: ScenePrep | null, ids: Map<string, string>): Pick<LevelClonePlan, 'keys' | 'notes' | 'triggers'> {
  if (!prep) return { keys: [], notes: [], triggers: [] };
  const keys = prep.rooms.filter((k) => ids.has(k.roomId)).map((k) => ({ ...structuredClone(k), roomId: ids.get(k.roomId)! }));
  const notes = prep.notes
    .filter((n) => (n.roomId ? ids.has(n.roomId) : ids.has(n.zoneId)))
    .map((n): RoomNote => {
      const out = { ...structuredClone(n), id: crypto.randomUUID() };
      if (out.roomId) out.roomId = ids.get(out.roomId)!;
      if (ids.has(out.zoneId)) out.zoneId = ids.get(out.zoneId)!;
      return out;
    });
  const triggers = prep.triggers
    .filter((t) => ids.has(conditionZoneId(t.when) ?? ('roomId' in t.when ? t.when.roomId : '')))
    .map((t): TriggerDef => {
      const out = structuredClone(t);
      out.id = crypto.randomUUID();
      if ('zoneId' in out.when) out.when.zoneId = ids.get(out.when.zoneId)!;
      else out.when.roomId = ids.get(out.when.roomId)!;
      out.actions = out.actions.map((a) => (a.kind === 'light' && ids.has(a.lightId) ? { ...a, lightId: ids.get(a.lightId)! } : a));
      return out;
    });
  return { keys, notes, triggers };
}

/**
 * Clones a level as "<name> copy", directly above it: every layer on it, traces too, copied
 * with new ids (rooms, zones, doors and lights included, every link inside remapped), and the
 * prep anchored on it (room keys, notes, triggers) copied onto the clone's own rooms, zones and
 * lights. One undo step; the caller shows the clone.
 */
export class CloneLevelCommand implements Command {
  readonly label = 'Clone level';
  readonly affectsRooms = true;
  readonly restoresUi = true;
  readonly sourceId: string;
  /** The clone's id, fixed at construction so redo brings back the same level. */
  readonly newId: string;
  private plan: LevelClonePlan | null = null;
  /** Whether the map had a prep block before the clone; undo drops one the clone started. */
  private hadPrep = true;

  constructor(levelId: string) {
    this.sourceId = levelId;
    this.newId = crypto.randomUUID();
  }

  execute(): void {
    const state = useStore.getState();
    if (!this.plan) {
      const index = state.levels.findIndex((l) => l.id === this.sourceId);
      if (index < 0) return;
      const source = state.levels[index];
      const ids = new Map<string, string>();
      // A trace is copied as it is: its picture is shared, not copied.
      const layers = layersOnLevel(state, source.id).map((l): Layer =>
        l.type === 'dungeon'
          ? { ...cloneLayerContent(l, crypto.randomUUID(), l.name, ids), levelId: this.newId }
          : { ...structuredClone(l), id: crypto.randomUUID(), levelId: this.newId },
      );
      const level: Level = { ...structuredClone(source), id: this.newId, name: `${source.name || 'Level'} copy` };
      this.plan = { level, index, layers, ...clonePrep(state.prep, ids) };
      this.hadPrep = state.prep !== null;
    }
    const plan = this.plan;
    state.addLevel(structuredClone(plan.level), plan.index);
    for (const layer of plan.layers) useStore.getState().addLayer(structuredClone(layer));
    const s = useStore.getState();
    for (const key of plan.keys) s.setRoomKey(key.roomId, structuredClone(key));
    for (const note of plan.notes) s.upsertNote(structuredClone(note));
    for (const trigger of plan.triggers) s.upsertTrigger(structuredClone(trigger));
  }

  undo(): void {
    const plan = this.plan;
    if (!plan) return;
    const s = useStore.getState();
    for (const trigger of plan.triggers) s.removeTrigger(trigger.id);
    for (const note of plan.notes) s.removeNote(note.id);
    for (const key of plan.keys) s.setRoomKey(key.roomId, null);
    for (const layer of plan.layers) useStore.getState().removeLayer(layer.id);
    // Straight splice, as AddLevelCommand's undo: the level is empty again by now.
    useStore.setState((state) => {
      state.levels = state.levels.filter((l) => l.id !== this.newId);
      if (state.ui.activeLevelId === this.newId) {
        const active = state.layers.find((l) => l.id === state.ui.activeLayerId);
        state.ui.activeLevelId = active?.levelId ?? state.levels[0]?.id ?? '';
      }
      const prep = state.prep;
      if (!this.hadPrep && prep && prep.triggers.length + prep.notes.length + prep.rooms.length === 0) state.prep = null;
    });
  }
}

/**
 * Duplicates a dungeon layer as "<name> copy", directly above the source. Every id in the
 * copy is new (rooms included: a copy is a new place), and the links inside it (door
 * walls, groups, attached lights, room areas) point at the copy's own records.
 */
export class DuplicateLayerCommand implements Command {
  readonly label = 'Duplicate layer';
  readonly affectsRooms = true;
  readonly restoresUi = true;
  readonly sourceId: string;
  /** The copy's id, fixed at construction so redo brings back the same layer. */
  readonly newId: string;
  private copy: DungeonLayer | null = null;

  constructor(layerId: string) {
    this.sourceId = layerId;
    this.newId = crypto.randomUUID();
  }

  execute(): void {
    const state = useStore.getState();
    const index = state.layers.findIndex((l) => l.id === this.sourceId);
    const source = state.layers[index];
    if (!source || source.type !== 'dungeon') return;
    this.copy ??= cloneLayerContent(source, this.newId, `${source.name || 'Layer'} copy`);
    state.addLayer(structuredClone(this.copy));
    const at = useStore.getState().layers.findIndex((l) => l.id === this.newId);
    if (at >= 0 && at !== index + 1) useStore.getState().reorderLayers(at, index + 1);
  }

  undo(): void {
    useStore.getState().removeLayer(this.newId);
  }
}

/** Moves a level in the level order. */
export class ReorderLevelCommand implements Command {
  readonly label = 'Reorder levels';
  readonly restoresUi = true;
  private readonly from: number;
  private readonly to: number;

  constructor(from: number, to: number) {
    this.from = from;
    this.to = to;
  }

  execute(): void {
    useStore.getState().reorderLevel(this.from, this.to);
  }

  undo(): void {
    useStore.getState().reorderLevel(this.to, this.from);
  }
}

/**
 * Deletes a level and what is on it, one undo step: either its layers move to `moveTo`
 * first, or (`moveTo` null) they are deleted with their objects. `refused` reads true
 * after execute when the level could not go (the last level, or one the map lost).
 */
export class RemoveLevelCascadeCommand implements Command {
  readonly label = 'Delete level';
  readonly restoresUi = true;
  readonly affectsRooms = true;
  private readonly levelId: string;
  private readonly moveTo: string | null;
  private steps: Command[] | null = null;
  refused = false;

  constructor(levelId: string, moveTo: string | null) {
    this.levelId = levelId;
    this.moveTo = moveTo;
  }

  execute(): void {
    const state = useStore.getState();
    if (!this.steps) {
      if (state.levels.length <= 1 || !state.levels.some((l) => l.id === this.levelId)) {
        this.refused = true;
        return;
      }
      const ids = layersOnLevel(state, this.levelId).map((l) => l.id);
      const target = this.moveTo && this.moveTo !== this.levelId && state.levels.some((l) => l.id === this.moveTo) ? this.moveTo : null;
      this.steps = [
        ...ids.map((id) => (target ? new MoveLayerToLevelCommand(id, target) : new RemoveLayerCommand('Delete layer', id))),
        new RemoveLevelCommand(this.levelId),
      ];
    }
    for (const step of this.steps) step.execute();
  }

  undo(): void {
    if (!this.steps) return;
    for (let i = this.steps.length - 1; i >= 0; i--) this.steps[i].undo();
  }
}
