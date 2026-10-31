import type { Command, DungeonLayer, Layer, MapBuilderStore } from './types';
import type { AnyChild, Room } from '../shared/types';
import { useStore } from './store';
import { RemoveLayerCommand } from './commands';
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

/** The dungeon layers on a level, in draw order. */
export function layersOnLevel(state: Pick<MapBuilderStore, 'layers'>, levelId: string): Layer[] {
  return state.layers.filter((l) => l.type !== 'background' && l.levelId === levelId);
}

/** Why a layer may not be deleted right now, or null when it may. */
export function layerDeleteBlock(state: Pick<MapBuilderStore, 'layers'>, layerId: string): string | null {
  const layer = state.layers.find((l) => l.id === layerId);
  if (!layer) return 'That layer is gone';
  if (layer.type === 'background') return 'The background stays';
  if (layer.locked) return 'Layer is locked';
  if (layersOnLevel(state, layer.levelId).length <= 1) return LAST_LAYER_MESSAGE;
  return null;
}

/** Why a layer may not move to another level, or null: a level never ends up empty. */
export function layerMoveBlock(state: Pick<MapBuilderStore, 'layers'>, layerId: string): string | null {
  const layer = state.layers.find((l) => l.id === layerId);
  if (!layer || layer.type === 'background') return 'Only map layers move between levels';
  if (layersOnLevel(state, layer.levelId).length <= 1) return LAST_LAYER_MESSAGE;
  return null;
}

/** A fresh copy of a layer's rooms, areas and children, every id new and every link inside remapped. */
function cloneLayerContent(source: DungeonLayer, id: string, name: string): DungeonLayer {
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
  const childIds = new Map<string, string>();
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
  return copy;
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
