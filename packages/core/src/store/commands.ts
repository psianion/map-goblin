import type { AnyChild, ChildGroupInfo, Command, DungeonLayer, DungeonStyle, FogLook, Layer } from './types';
import { useStore } from './store';
import type { MapStylePreset } from './presetRegistry';
import { styleValueOrDefault } from '../shared/wallLook';
import { RemoveRoomCommand } from './roomCommands';
import { lightsOn } from './attachedLights';
import { createDuplicateCommand } from './propEdits';

// ─── PropertyCommand ─────────────────────────────────────

interface PropertyTarget {
  type: 'layer' | 'child';
  layerId: string;
  childId?: string; // required when type === 'child'
}

/**
 * Generic command for toggling simple properties on layers or children
 * (e.g. locked, visible). Routes to updateLayer or updateChild.
 */
export class PropertyCommand implements Command {
  readonly label: string;
  readonly target: PropertyTarget;
  readonly affectsRooms: boolean;
  private before: Record<string, unknown>;
  private after: Record<string, unknown>;

  constructor(
    label: string,
    target: PropertyTarget,
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ) {
    this.label = label;
    this.target = target;
    this.before = structuredClone(before);
    this.after = structuredClone(after);
    // Region moves and cuts commit the floor outline through this command, so
    // the room-defining fields are what mark it as geometry.
    this.affectsRooms =
      target.type === 'layer' && ('mergedFloor' in after || 'standaloneWalls' in after);
  }

  execute(): void {
    const store = useStore.getState();
    if (this.target.type === 'layer') {
      store.updateLayer(this.target.layerId, this.after as Partial<Layer>);
    } else {
      store.updateChild(this.target.layerId, this.target.childId!, this.after as Partial<AnyChild>);
    }
  }

  undo(): void {
    const store = useStore.getState();
    if (this.target.type === 'layer') {
      store.updateLayer(this.target.layerId, this.before as Partial<Layer>);
    } else {
      store.updateChild(this.target.layerId, this.target.childId!, this.before as Partial<AnyChild>);
    }
  }
}

/**
 * Groups multiple commands into a single undoable operation.
 */
export class CompositeCommand implements Command {
  readonly label: string;
  private commands: Command[];

  constructor(label: string, commands: Command[]) {
    this.label = label;
    this.commands = commands;
  }

  /** One re-derive for the whole group, not one per member. */
  get affectsRooms(): boolean {
    return this.commands.some((c) => c.affectsRooms);
  }

  execute(): void {
    for (const cmd of this.commands) {
      cmd.execute();
    }
  }

  undo(): void {
    for (let i = this.commands.length - 1; i >= 0; i--) {
      this.commands[i].undo();
    }
  }
}

/**
 * Child types whose add/remove moves the room faces: shapes are what
 * `mergedFloor` is unioned from, and a door needs a roomA/B the moment it
 * appears. Lights, labels and assets sit on top of the geometry.
 */
function childAffectsRooms(child: AnyChild | null): boolean {
  return child?.childType === 'shape' || child?.childType === 'door';
}

/**
 * Adds a child to a dungeon layer, on top or at `index` (placing a prop under the
 * others). Removes it on undo.
 */
export class AddChildCommand implements Command {
  readonly label: string;
  readonly affectsRooms: boolean;
  private layerId: string;
  private child: AnyChild;
  private index: number | undefined;

  constructor(label: string, layerId: string, child: AnyChild, index?: number) {
    this.label = label;
    this.layerId = layerId;
    this.child = structuredClone(child);
    this.index = index;
    this.affectsRooms = childAffectsRooms(this.child);
  }

  execute(): void {
    useStore.getState().addChild(this.layerId, structuredClone(this.child), this.index);
  }

  undo(): void {
    useStore.getState().removeChild(this.layerId, this.child.id);
  }
}

/**
 * Removes a child from a dungeon layer. Restores it at its original index on undo.
 */
export class RemoveChildCommand implements Command {
  readonly label: string;
  private layerId: string;
  private childId: string;
  private snapshot: AnyChild | null = null;
  private originalIndex: number = -1;

  constructor(label: string, layerId: string, childId: string) {
    this.label = label;
    this.layerId = layerId;
    this.childId = childId;
  }

  /** Read from the snapshot, so it only answers once execute has run. */
  get affectsRooms(): boolean {
    return childAffectsRooms(this.snapshot);
  }

  execute(): void {
    const state = useStore.getState();
    const layer = state.layers.find((l) => l.id === this.layerId);
    if (!layer || layer.type !== 'dungeon') return;
    const dungeonLayer = layer as DungeonLayer;
    this.originalIndex = dungeonLayer.children.findIndex((c) => c.id === this.childId);
    if (this.originalIndex === -1) return;
    this.snapshot = structuredClone(dungeonLayer.children[this.originalIndex]);
    state.removeChild(this.layerId, this.childId);
  }

  undo(): void {
    if (!this.snapshot) return;
    const state = useStore.getState();
    state.addChild(this.layerId, structuredClone(this.snapshot));
    if (this.originalIndex >= 0) {
      // Re-read: `state` was captured before the add, and the store hands back a
      // NEW layers array on every write. Searching the stale one never found the
      // child, so the reorder below silently never ran and an undone delete came
      // back at the end of the list — which is also its z-order on the canvas.
      const layer = useStore.getState().layers.find((l) => l.id === this.layerId);
      if (!layer || layer.type !== 'dungeon') return;
      const currentIndex = (layer as DungeonLayer).children.findIndex(
        (c) => c.id === this.childId,
      );
      if (currentIndex !== -1 && currentIndex !== this.originalIndex) {
        state.reorderChild(this.layerId, currentIndex, this.originalIndex);
      }
    }
  }
}

/**
 * Reorders a child within a dungeon layer (z-order swap).
 */
export class ReorderChildCommand implements Command {
  readonly label: string;
  private layerId: string;
  private fromIndex: number;
  private toIndex: number;

  constructor(label: string, layerId: string, fromIndex: number, toIndex: number) {
    this.label = label;
    this.layerId = layerId;
    this.fromIndex = fromIndex;
    this.toIndex = toIndex;
  }

  execute(): void {
    useStore.getState().reorderChild(this.layerId, this.fromIndex, this.toIndex);
  }

  undo(): void {
    useStore.getState().reorderChild(this.layerId, this.toIndex, this.fromIndex);
  }
}

/**
 * Puts a layer's children in `order` (z-order: later draws on top). Ids it does not
 * list keep their slots (see `setChildOrder`). Undo restores the order it found.
 */
export class ChildOrderCommand implements Command {
  readonly label: string;
  private readonly layerId: string;
  private readonly order: string[];
  private prior: string[] = [];

  constructor(label: string, layerId: string, order: string[]) {
    this.label = label;
    this.layerId = layerId;
    this.order = [...order];
  }

  execute(): void {
    const layer = useStore.getState().layers.find((l) => l.id === this.layerId);
    this.prior = layer?.type === 'dungeon' ? layer.children.map((c) => c.id) : [];
    useStore.getState().setChildOrder(this.layerId, this.order);
  }

  undo(): void {
    useStore.getState().setChildOrder(this.layerId, this.prior);
  }
}

/**
 * Entry type for TransformChildrenCommand — captures full before/after child snapshots.
 */
export interface TransformChildEntry {
  layerId: string;
  childId: string;
  before: AnyChild;
  after: AnyChild;
}

/**
 * Transforms multiple children across one or more layers in a single undoable operation.
 * Stores full before/after snapshots for each child.
 */
export class TransformChildrenCommand implements Command {
  readonly label: string;
  private entries: TransformChildEntry[];

  constructor(label: string, entries: TransformChildEntry[]) {
    this.label = label;
    this.entries = entries.map((e) => ({
      layerId: e.layerId,
      childId: e.childId,
      before: structuredClone(e.before),
      after: structuredClone(e.after),
    }));
  }

  execute(): void {
    const state = useStore.getState();
    for (const entry of this.entries) {
      state.updateChild(entry.layerId, entry.childId, structuredClone(entry.after));
    }
  }

  undo(): void {
    const state = useStore.getState();
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      state.updateChild(entry.layerId, entry.childId, structuredClone(entry.before));
    }
  }
}

/**
 * Updates a single child's properties. Captures before/after for undo/redo.
 */
export class UpdateChildCommand implements Command {
  readonly label: string;
  private layerId: string;
  private childId: string;
  private before: Partial<AnyChild>;
  private after: Partial<AnyChild>;

  constructor(
    label: string,
    layerId: string,
    childId: string,
    before: Partial<AnyChild>,
    after: Partial<AnyChild>,
  ) {
    this.label = label;
    this.layerId = layerId;
    this.childId = childId;
    this.before = structuredClone(before);
    this.after = structuredClone(after);
  }

  execute(): void {
    useStore.getState().updateChild(this.layerId, this.childId, structuredClone(this.after));
  }

  undo(): void {
    useStore.getState().updateChild(this.layerId, this.childId, structuredClone(this.before));
  }
}

/**
 * Command for reordering a layer in the layer stack.
 */
export class ReorderLayerCommand implements Command {
  readonly label: string;
  private fromIndex: number;
  private toIndex: number;

  constructor(label: string, fromIndex: number, toIndex: number) {
    this.label = label;
    this.fromIndex = fromIndex;
    this.toIndex = toIndex;
  }

  execute(): void {
    useStore.getState().reorderLayers(this.fromIndex, this.toIndex);
  }

  undo(): void {
    useStore.getState().reorderLayers(this.toIndex, this.fromIndex);
  }
}

/**
 * Command for adding a layer.
 */
export class AddLayerCommand implements Command {
  readonly label: string;
  private layer: Layer;
  private layerId: string;

  constructor(label: string, layer: Layer) {
    this.label = label;
    this.layer = structuredClone(layer);
    this.layerId = layer.id;
  }

  execute(): void {
    // A new layer joins the level on show (a layer naming a level the map knows,
    // such as an undone delete, keeps its own). Stamped on the first run so redo
    // puts it back on the same level whatever is on show by then.
    const { levels, ui } = useStore.getState();
    if (!levels.some((l) => l.id === this.layer.levelId)) {
      this.layer.levelId = levels.some((l) => l.id === ui.activeLevelId) ? ui.activeLevelId : (levels[0]?.id ?? '');
    }
    useStore.getState().addLayer(structuredClone(this.layer));
  }

  undo(): void {
    useStore.getState().removeLayer(this.layerId);
  }
}

/**
 * Command for removing a layer. Captures layer data and index for undo restoration.
 */
export class RemoveLayerCommand implements Command {
  readonly label: string;
  private layerId: string;
  private snapshot: Layer | null = null;
  private layerIndex: number = -1;

  constructor(label: string, layerId: string) {
    this.label = label;
    this.layerId = layerId;
  }

  execute(): void {
    const state = useStore.getState();
    const layers = state.layers;
    this.layerIndex = layers.findIndex((l) => l.id === this.layerId);
    if (this.layerIndex === -1) return;
    this.snapshot = structuredClone(layers[this.layerIndex]);
    state.removeLayer(this.layerId);
  }

  undo(): void {
    if (!this.snapshot) return;
    const state = useStore.getState();
    state.addLayer(structuredClone(this.snapshot));
    if (this.layerIndex >= 0) {
      const currentIndex = state.layers.findIndex((l) => l.id === this.layerId);
      if (currentIndex !== -1 && currentIndex !== this.layerIndex) {
        state.reorderLayers(currentIndex, this.layerIndex);
      }
    }
  }
}

/**
 * Command for adding a standalone wall segment.
 */
export class AddWallCommand implements Command {
  readonly label: string;
  readonly affectsRooms = true;
  private layerId: string;
  private wall: import('./types').WallSegment;

  constructor(label: string, layerId: string, wall: import('./types').WallSegment) {
    this.label = label;
    this.layerId = layerId;
    this.wall = structuredClone(wall);
  }

  execute(): void {
    useStore.getState().addWall(this.layerId, structuredClone(this.wall));
  }

  undo(): void {
    useStore.getState().removeWall(this.layerId, this.wall.id);
  }
}

export class RemoveWallCommand implements Command {
  readonly label = 'Remove wall';
  readonly affectsRooms = true;
  removedWall: import('./types').WallSegment | null = null;
  layerId: string;
  wallId: string;
  /** Where the wall sat in `standaloneWalls`, so undo puts it back in the same draw order. */
  private originalIndex = -1;

  constructor(layerId: string, wallId: string) {
    this.layerId = layerId;
    this.wallId = wallId;
  }

  execute(): void {
    const store = useStore.getState();
    const layer = store.layers.find(l => l.id === this.layerId);
    if (layer && layer.type === 'dungeon') {
      const walls = (layer as import('./types').DungeonLayer).standaloneWalls;
      this.originalIndex = walls.findIndex(w => w.id === this.wallId);
      if (this.originalIndex >= 0) this.removedWall = structuredClone(walls[this.originalIndex]);
    }
    store.removeWall(this.layerId, this.wallId);
  }

  undo(): void {
    if (this.removedWall) {
      useStore
        .getState()
        .addWall(this.layerId, structuredClone(this.removedWall), this.originalIndex >= 0 ? this.originalIndex : undefined);
    }
  }
}

export class UpdateWallCommand implements Command {
  readonly label = 'Update wall';
  readonly affectsRooms = true;
  layerId: string;
  wallId: string;
  before: Partial<import('./types').WallSegment>;
  after: Partial<import('./types').WallSegment>;

  constructor(
    layerId: string,
    wallId: string,
    before: Partial<import('./types').WallSegment>,
    after: Partial<import('./types').WallSegment>,
  ) {
    this.layerId = layerId;
    this.wallId = wallId;
    this.before = before;
    this.after = after;
  }

  execute(): void {
    useStore.getState().updateWall(this.layerId, this.wallId, this.after);
  }

  undo(): void {
    useStore.getState().updateWall(this.layerId, this.wallId, this.before);
  }
}

/**
 * Same job as UpdateWallCommand, for a wall derived from the floor outline.
 * Those rings are recomputed from the shapes on every change, so their hand
 * edits live on the layer keyed by ring index rather than on a WallSegment.
 */
export class UpdateFloorWallEditsCommand implements Command {
  readonly label = 'Update wall';
  readonly affectsRooms = true;
  private layerId: string;
  private ringKey: string;
  private before: import('../shared/types').WallEdits | undefined;
  private after: import('../shared/types').WallEdits | undefined;

  constructor(
    layerId: string,
    ringKey: string,
    before: import('../shared/types').WallEdits | undefined,
    after: import('../shared/types').WallEdits | undefined,
  ) {
    this.layerId = layerId;
    this.ringKey = ringKey;
    this.before = structuredClone(before);
    this.after = structuredClone(after);
  }

  execute(): void {
    useStore.getState().setFloorWallEdits(this.layerId, this.ringKey, this.after);
  }

  undo(): void {
    useStore.getState().setFloorWallEdits(this.layerId, this.ringKey, this.before);
  }
}

/**
 * Creates a wall removal command that cascade-deletes all door children
 * attached to the removed wall. Returns a CompositeCommand if there are
 * attached doors, or a plain RemoveWallCommand if none.
 *
 * Always use this helper instead of constructing RemoveWallCommand directly
 * so that orphaned doors are never left in the layer after wall deletion.
 */
export function createWallRemovalCommand(layerId: string, wallId: string): Command {
  const state = useStore.getState();
  const layer = state.layers.find((l) => l.id === layerId);
  if (!layer || layer.type !== 'dungeon') {
    return new RemoveWallCommand(layerId, wallId);
  }
  const dungeonLayer = layer as import('./types').DungeonLayer;
  const attachedDoors = dungeonLayer.children.filter(
    (c): c is import('../shared/types').DoorChild =>
      c.childType === 'door' && (c as import('../shared/types').DoorChild).wallId === wallId,
  );
  if (attachedDoors.length === 0) {
    return new RemoveWallCommand(layerId, wallId);
  }
  const commands: Command[] = [
    ...attachedDoors.map((d) => new RemoveChildCommand('Remove door', layerId, d.id)),
    new RemoveWallCommand(layerId, wallId),
  ];
  return new CompositeCommand('Remove wall', commands);
}

/** What deleting a selection takes with it, for the toast. */
export interface SelectionRemoval {
  /** One undo step for the whole selection; null when nothing selected still exists. */
  command: Command | null;
  /** Children removed for being selected (doors that go with their wall not counted). */
  children: number;
  walls: number;
  /** Doors that went with a deleted wall, picked or not: a door never outlives its wall. */
  doors: number;
  /** Rooms removed (their floors stay: a room is a place on the floor, not the floor). */
  rooms?: number;
}

/**
 * Removal of a selection that may hold drawn walls as well as children, as one undo
 * step. Walls go through `createWallRemovalCommand`, so the doors bound to them go too;
 * a selected door that rides along with its wall is removed once, by the wall.
 */
export function createSelectionRemovalCommand(
  ids: readonly string[],
  label = 'Delete',
  groupLabel = label,
): SelectionRemoval {
  const layers = useStore
    .getState()
    .layers.filter((l): l is DungeonLayer => l.type === 'dungeon');
  const walls: { layerId: string; wallId: string }[] = [];
  const childIds: { layerId: string; id: string }[] = [];
  const rooms: { layerId: string; roomId: string }[] = [];
  for (const id of ids) {
    const roomLayer = layers.find((l) => (l.rooms ?? []).some((r) => r.id === id));
    if (roomLayer) {
      rooms.push({ layerId: roomLayer.id, roomId: id });
      continue;
    }
    const wallLayer = layers.find((l) => (l.standaloneWalls ?? []).some((w) => w.id === id));
    if (wallLayer) {
      walls.push({ layerId: wallLayer.id, wallId: id });
      continue;
    }
    const childLayer = layers.find((l) => l.children.some((c) => c.id === id));
    if (childLayer) childIds.push({ layerId: childLayer.id, id });
  }
  const withWall = new Set<string>();
  for (const { layerId, wallId } of walls) {
    const layer = layers.find((l) => l.id === layerId);
    for (const c of layer?.children ?? []) {
      if (c.childType === 'door' && (c as import('../shared/types').DoorChild).wallId === wallId) withWall.add(c.id);
    }
  }
  const kept = childIds.filter((c) => !withWall.has(c.id));
  const commands: Command[] = [
    ...kept.map((c) => createChildRemovalCommand(c.layerId, c.id, label)),
    ...walls.map((w) => createWallRemovalCommand(w.layerId, w.wallId)),
    ...rooms.map((r) => new RemoveRoomCommand(r.layerId, r.roomId)),
  ];
  return {
    command: commands.length === 0 ? null : new CompositeCommand(groupLabel, commands),
    children: kept.length,
    walls: walls.length,
    doors: withWall.size,
    rooms: rooms.length,
  };
}

/**
 * Creates a child removal command that cascade-deletes any lights attached
 * to it (M1 — a `LightChild.attachedTo` pointing at an asset). Returns a
 * CompositeCommand when there are attached lights, or a plain
 * RemoveChildCommand otherwise.
 *
 * Always use this helper instead of constructing RemoveChildCommand directly
 * for a child that could have lights glued to it, so a deleted lamp never
 * leaves its light behind.
 */
export function createChildRemovalCommand(layerId: string, childId: string, label = 'Delete'): Command {
  // On any layer: a lamp's light may sit on a lighting layer above the lamp.
  const attachedLights = lightsOn(useStore.getState().layers, [childId]);
  if (attachedLights.length === 0) {
    return new RemoveChildCommand(label, layerId, childId);
  }
  const commands: Command[] = [
    ...attachedLights.map((l) => new RemoveChildCommand(label, l.layerId, l.light.id)),
    new RemoveChildCommand(label, layerId, childId),
  ];
  return new CompositeCommand(label, commands);
}

export class CloseAllDoorsCommand implements Command {
  readonly label = 'Close all doors';
  previousStates: Record<string, import('../shared/types').DoorState> = {};
  layerId: string;

  constructor(layerId: string) {
    this.layerId = layerId;
  }

  execute(): void {
    const store = useStore.getState();
    const layer = store.layers.find(l => l.id === this.layerId);
    if (layer && layer.type === 'dungeon') {
      for (const child of (layer as import('./types').DungeonLayer).children) {
        if (child.childType === 'door') {
          const door = child as import('../shared/types').DoorChild;
          this.previousStates[door.id] = door.state;
        }
      }
    }
    store.closeAllDoors(this.layerId);
  }

  undo(): void {
    const store = useStore.getState();
    for (const [doorId, state] of Object.entries(this.previousStates)) {
      store.updateChild(this.layerId, doorId, { state } as Partial<import('../shared/types').DoorChild>);
    }
  }
}

/**
 * Command for the map's ambient light color. Routes through `setAmbientLight` like the
 * live-drag preview does — undo/redo just replays it with the other color.
 */
export class SetAmbientLightCommand implements Command {
  readonly label = 'Ambient color';
  private readonly before: string;
  private readonly after: string;

  constructor(before: string, after: string) {
    this.before = before;
    this.after = after;
  }

  execute(): void {
    useStore.getState().setAmbientLight(this.after);
  }

  undo(): void {
    useStore.getState().setAmbientLight(this.before);
  }
}

/**
 * Command for the map's fog look (D7) — one entry per commit, same idiom as ambient light:
 * undo/redo just replays `setFogLook` with the other object. `undefined` is a real state here
 * (the map has never authored a look, so the table falls back to `DEFAULT_FOG_LOOK`), not a
 * sentinel for "no change" — that's why this takes `FogLook | undefined` rather than reusing
 * `SetAmbientLightCommand`'s plain-string shape.
 */
export class SetFogLookCommand implements Command {
  readonly label = 'Fog look';
  private readonly before: FogLook | undefined;
  private readonly after: FogLook | undefined;

  constructor(before: FogLook | undefined, after: FogLook | undefined) {
    this.before = before && structuredClone(before);
    this.after = after && structuredClone(after);
  }

  execute(): void {
    useStore.getState().setFogLook(this.after);
  }

  undo(): void {
    useStore.getState().setFogLook(this.before);
  }
}

/**
 * Command for the map's environment settings — environment type, time palette, natural light,
 * orientation, time mode. One command for the section rather than six, because the fields are
 * authored together and the undo entry a DM expects is "the change I just made to Environment".
 *
 * `before` carries the same keys `after` does, at their previous values — `undefined` where a
 * field had never been authored, which `setEnvironmentSettings` takes back off the map.
 */
export class SetEnvironmentSettingsCommand implements Command {
  readonly label = 'Environment';
  private readonly before: Partial<import('../shared/world').MapEnvironment>;
  private readonly after: Partial<import('../shared/world').MapEnvironment>;

  constructor(
    before: Partial<import('../shared/world').MapEnvironment>,
    after: Partial<import('../shared/world').MapEnvironment>,
  ) {
    this.before = structuredClone(before);
    this.after = structuredClone(after);
  }

  execute(): void {
    useStore.getState().setEnvironmentSettings(this.after);
  }

  undo(): void {
    useStore.getState().setEnvironmentSettings(this.before);
  }
}


/**
 * Command for applying a style preset to a dungeon layer.
 *
 * A preset chooses the style for what gets drawn *next*. It is not a restyle of
 * the map, and it used to behave like one: shapes carry only sparse
 * `styleOverrides` and resolve everything else from `layer.style` at render
 * time, so rewriting the layer style silently repainted every shape already on
 * the map. Existing shapes are therefore pinned to their current appearance
 * before the layer style moves under them.
 */
/** The look pins a standalone wall can carry; see `WallSegment`. */
type WallPins = { textureSetId?: string; textureTint?: string; width?: number };

export class PresetApplyCommand implements Command {
  readonly label: string;
  private readonly layerId: string;
  private readonly presetStyle: Partial<DungeonStyle>;
  private readonly previousStyle: DungeonStyle;
  /** `styleOverrides` each shape had before the apply, keyed by child id. */
  private readonly previousOverrides = new Map<string, Record<string, unknown> | undefined>();
  /** The style pins each standalone wall had before the apply, keyed by wall id. */
  private readonly previousWallPins = new Map<string, WallPins>();

  constructor(label: string, layerId: string, preset: MapStylePreset, previousStyle: DungeonStyle) {
    this.label = label;
    this.layerId = layerId;
    // A key whose value is `undefined` survives structuredClone and then wins
    // the spread below, unsetting whatever the layer had. That is what switched
    // wall texture to none and made every authored wall vanish. A preset that
    // does not name a field means "leave it alone", never "clear it".
    this.presetStyle = Object.fromEntries(
      Object.entries(structuredClone(preset.dungeonStyle)).filter(([, v]) => v !== undefined),
    ) as Partial<DungeonStyle>;
    this.previousStyle = structuredClone(previousStyle);
  }

  execute(): void {
    const state = useStore.getState();
    const layer = state.layers.find((l) => l.id === this.layerId);
    if (!layer || layer.type !== 'dungeon') return;

    // Snapshot of the pre-apply layer style — `layer` is the state object from
    // before the writes below, so these stay the old values throughout.
    const keys = Object.keys(this.presetStyle) as (keyof DungeonStyle)[];
    const before = layer.style;

    this.previousOverrides.clear();
    for (const child of layer.children) {
      if (child.childType !== 'shape') continue;
      const existing = child.styleOverrides as Record<string, unknown> | undefined;
      this.previousOverrides.set(child.id, existing ? structuredClone(existing) : undefined);
      // An override the shape already had is its own authored intent — keep it.
      // A key the layer never set pins the value the renderer used for it, never
      // `undefined`: that loses to the new layer value and does not survive a save.
      const pinned: Record<string, unknown> = { ...existing };
      for (const key of keys) {
        if (pinned[key] === undefined) pinned[key] = styleValueOrDefault(before, key);
      }
      state.updateChild(this.layerId, child.id, { styleOverrides: pinned });
    }

    // Standalone walls get the same treatment. They are not `LayerChild`ren, so
    // they carry their own pins rather than a `styleOverrides` bag, but the rule is
    // identical: a wall already drawn keeps the look it was drawn with, and a pin
    // the wall already had is its own authored intent.
    this.previousWallPins.clear();
    for (const wall of layer.standaloneWalls) {
      const pin: WallPins = {};
      if ('wallTextureSetId' in this.presetStyle && wall.textureSetId === undefined) {
        // '' is "no set": a wall drawn bare stays bare under a preset that brings stones.
        pin.textureSetId = before.wallTextureSetId ?? '';
      }
      if ('wallTextureTint' in this.presetStyle && wall.textureTint === undefined) {
        pin.textureTint = before.wallTextureTint;
      }
      if ('wallWidth' in this.presetStyle && wall.width === undefined) {
        pin.width = before.wallWidth;
        // A width is only read back as a pin beside a look pin (see migration's
        // `hasDrawTimeWidth`), so it never travels alone.
        if (wall.textureTint === undefined) pin.textureTint = before.wallTextureTint;
      }
      if (Object.keys(pin).length === 0) continue;
      this.previousWallPins.set(wall.id, {
        textureSetId: wall.textureSetId,
        textureTint: wall.textureTint,
        width: wall.width,
      });
      state.updateWall(this.layerId, wall.id, pin);
    }

    state.updateLayer(this.layerId, {
      style: { ...before, ...this.presetStyle },
    } as Partial<DungeonLayer>);
  }

  undo(): void {
    const state = useStore.getState();
    for (const [childId, overrides] of this.previousOverrides) {
      state.updateChild(this.layerId, childId, {
        styleOverrides: overrides ? structuredClone(overrides) : undefined,
      });
    }
    for (const [wallId, pins] of this.previousWallPins) {
      state.updateWall(this.layerId, wallId, {
        textureSetId: pins.textureSetId,
        textureTint: pins.textureTint,
        width: pins.width,
      });
    }
    state.updateLayer(this.layerId, {
      style: structuredClone(this.previousStyle),
    } as Partial<DungeonLayer>);
  }
}

/**
 * Command for a single field change on a dungeon layer's style.
 */
export class LayerStyleChangeCommand implements Command {
  readonly label: string;
  private readonly layerId: string;
  private readonly field: keyof DungeonStyle;
  private readonly prevValue: unknown;
  private readonly newValue: unknown;

  constructor(
    label: string,
    layerId: string,
    field: keyof DungeonStyle,
    prevValue: unknown,
    newValue: unknown,
  ) {
    this.label = label;
    this.layerId = layerId;
    this.field = field;
    this.prevValue = structuredClone(prevValue);
    this.newValue = structuredClone(newValue);
  }

  execute(): void {
    const state = useStore.getState();
    const layer = state.layers.find((l) => l.id === this.layerId) as DungeonLayer | undefined;
    if (!layer) return;
    state.updateLayer(this.layerId, {
      style: { ...layer.style, [this.field]: structuredClone(this.newValue) },
    } as Partial<DungeonLayer>);
  }

  undo(): void {
    const state = useStore.getState();
    const layer = state.layers.find((l) => l.id === this.layerId) as DungeonLayer | undefined;
    if (!layer) return;
    state.updateLayer(this.layerId, {
      style: { ...layer.style, [this.field]: structuredClone(this.prevValue) },
    } as Partial<DungeonLayer>);
  }
}

/**
 * Command for the map's global terrain visible/opacity. PropertyCommand can't
 * address `mapSettings` (it only targets layers/children), so this is the
 * small equivalent for terrain appearance — routes through `setTerrainData`,
 * which lazily creates `mapSettings.terrain` (visible/opacity can be set
 * before any paint).
 */
export class TerrainAppearanceCommand implements Command {
  readonly label = 'Terrain appearance';
  private readonly before: { visible?: boolean; opacity?: number };
  private readonly after: { visible?: boolean; opacity?: number };
  /**
   * Whether `mapSettings.terrain` existed before this command's first
   * execute. Set lazily there (not in the constructor — construction and
   * first execute aren't always the same instant) and reused for every
   * later undo/redo. When it was absent, this command is what created the
   * record, so undoing it drops the whole thing rather than patching it back
   * to `before` — otherwise a visible/opacity toggle on a never-painted map
   * left a stray terrain record behind after undo.
   */
  private hadTerrain: boolean | null = null;

  constructor(
    before: { visible?: boolean; opacity?: number },
    after: { visible?: boolean; opacity?: number },
  ) {
    this.before = structuredClone(before);
    this.after = structuredClone(after);
  }

  execute(): void {
    if (this.hadTerrain === null) {
      this.hadTerrain = useStore.getState().mapSettings.terrain !== undefined;
    }
    useStore.getState().setTerrainData(this.after);
  }

  undo(): void {
    if (!this.hadTerrain) {
      useStore.setState((state) => {
        state.mapSettings.terrain = undefined;
      });
      return;
    }
    useStore.getState().setTerrainData(this.before);
  }
}

// ─── Child groups ────────────────────────────────────────

interface GroupSnapshot {
  /** Omitted when the command only moves group metadata. */
  children?: AnyChild[];
  groups?: ChildGroupInfo[];
}

/**
 * Writes a dungeon layer's children array and/or its group metadata wholesale.
 * Grouping reorders children *and* rewrites membership on several of them at
 * once, so a snapshot is what restores the exact prior order, groupIds and
 * group list — a pile of per-child updates would not.
 */
export class ChildGroupsCommand implements Command {
  readonly label: string;
  private readonly layerId: string;
  private readonly before: GroupSnapshot;
  private readonly after: GroupSnapshot;

  constructor(label: string, layerId: string, before: GroupSnapshot, after: GroupSnapshot) {
    this.label = label;
    this.layerId = layerId;
    this.before = structuredClone(before);
    this.after = structuredClone(after);
  }

  private apply(snap: GroupSnapshot): void {
    const patch: Partial<DungeonLayer> = { groups: structuredClone(snap.groups) };
    if (snap.children) patch.children = structuredClone(snap.children);
    useStore.getState().updateLayer(this.layerId, patch);
  }

  execute(): void {
    this.apply(this.after);
  }

  undo(): void {
    this.apply(this.before);
  }
}

function findDungeonLayer(layers: Layer[], layerId: string): DungeonLayer | null {
  const layer = layers.find((l) => l.id === layerId);
  return layer && layer.type === 'dungeon' ? layer : null;
}

/** Group metadata nobody is a member of any more is dead weight — drop it. */
function pruneGroups(groups: ChildGroupInfo[], children: AnyChild[]): ChildGroupInfo[] | undefined {
  const used = new Set(children.map((c) => c.groupId));
  const kept = groups.filter((g) => used.has(g.id));
  return kept.length > 0 ? kept : undefined;
}

function withGroupId(child: AnyChild, groupId: string | undefined): AnyChild {
  const clone = structuredClone(child);
  if (groupId === undefined) delete clone.groupId;
  else clone.groupId = groupId;
  return clone;
}

/**
 * The one existing group every already-grouped child in `childIds` belongs to,
 * or null when they are all loose or span two groups. Grouping such a selection
 * EXTENDS that group instead of minting a new one — otherwise re-grouping
 * "Goblin Camp" plus one loose object silently destroyed the folder and its
 * name. Two different groups still collapse into a fresh one (members stolen).
 */
export function soleGroupOfChildren(
  layers: Layer[],
  layerId: string,
  childIds: string[],
): ChildGroupInfo | null {
  const layer = findDungeonLayer(layers, layerId);
  if (!layer) return null;
  const ids = new Set(childIds);
  const groupIds = new Set(
    layer.children.filter((c) => ids.has(c.id) && c.groupId).map((c) => c.groupId as string),
  );
  if (groupIds.size !== 1) return null;
  return layer.groups?.find((g) => g.id === [...groupIds][0]) ?? null;
}

/**
 * Groups children into one named set: the members become contiguous at the
 * topmost member's slot (children order is z-order for assets and text), each
 * gets `groupId`, and a group record is appended. Children that already sat in
 * another group are stolen, which is also what "Add to group" does.
 *
 * When the grouped members all come from ONE existing group, that group is
 * extended instead — same id, name and merged flag (see soleGroupOfChildren).
 *
 * Returns null when there is nothing to group.
 */
export function createGroupChildrenCommand(
  layers: Layer[],
  layerId: string,
  childIds: string[],
  name: string,
  merged = false,
): Command | null {
  const layer = findDungeonLayer(layers, layerId);
  if (!layer) return null;
  const existing = soleGroupOfChildren(layers, layerId, childIds);
  const memberIds = new Set(childIds);
  // Extending pulls in the group's unselected members too, so the folder stays
  // one contiguous block instead of splitting around the moved rows.
  if (existing) {
    for (const c of layer.children) if (c.groupId === existing.id) memberIds.add(c.id);
  }
  const members = layer.children.filter((c) => memberIds.has(c.id));
  if (members.length === 0) return null;

  const groupId = existing ? existing.id : crypto.randomUUID();
  const topmost = layer.children.reduce((max, c, i) => (memberIds.has(c.id) ? i : max), 0);
  const rest = layer.children.filter((c) => !memberIds.has(c.id));
  const insertAt = layer.children.filter((c, i) => !memberIds.has(c.id) && i < topmost).length;
  const block = members.map((c) => withGroupId(c, groupId));
  const children = [...rest.slice(0, insertAt), ...block, ...rest.slice(insertAt)];
  const groups = pruneGroups(
    existing ? (layer.groups ?? []) : [...(layer.groups ?? []), { id: groupId, name, merged }],
    children,
  );

  return new ChildGroupsCommand(
    merged ? 'Merge' : 'Group',
    layerId,
    { children: layer.children, groups: layer.groups },
    { children, groups },
  );
}

/** Ungroup / Unmerge: members keep their place and lose the group. */
export function createDissolveGroupCommand(
  layers: Layer[],
  layerId: string,
  groupId: string,
): Command | null {
  const layer = findDungeonLayer(layers, layerId);
  if (!layer) return null;
  if (!layer.children.some((c) => c.groupId === groupId)) return null;
  const children = layer.children.map((c) => (c.groupId === groupId ? withGroupId(c, undefined) : c));
  return new ChildGroupsCommand(
    'Ungroup',
    layerId,
    { children: layer.children, groups: layer.groups },
    { children, groups: pruneGroups(layer.groups ?? [], children) },
  );
}

/** Drops children out of whatever group they are in, leaving the group alive. */
export function createRemoveFromGroupCommand(
  layers: Layer[],
  layerId: string,
  childIds: string[],
): Command | null {
  const layer = findDungeonLayer(layers, layerId);
  if (!layer) return null;
  const ids = new Set(childIds);
  if (!layer.children.some((c) => ids.has(c.id) && c.groupId)) return null;
  const children = layer.children.map((c) => (ids.has(c.id) ? withGroupId(c, undefined) : c));
  return new ChildGroupsCommand(
    'Remove from group',
    layerId,
    { children: layer.children, groups: layer.groups },
    { children, groups: pruneGroups(layer.groups ?? [], children) },
  );
}

/** Merge or unmerge a group: merged behaves as one object, a plain group is a folder. */
export class SetGroupMergedCommand implements Command {
  readonly label: string;
  private readonly layerId: string;
  private readonly groupId: string;
  private readonly merged: boolean;
  private prior: boolean | undefined;

  constructor(layerId: string, groupId: string, merged: boolean) {
    this.label = merged ? 'Merge group' : 'Unmerge group';
    this.layerId = layerId;
    this.groupId = groupId;
    this.merged = merged;
  }

  private write(merged: boolean | undefined): void {
    const layer = findDungeonLayer(useStore.getState().layers, this.layerId);
    if (!layer?.groups) return;
    const groups = layer.groups.map((g) => {
      if (g.id !== this.groupId) return g;
      const next = { ...g, merged };
      if (merged === undefined) delete next.merged;
      return next;
    });
    useStore.getState().updateLayer(this.layerId, { groups });
  }

  execute(): void {
    const layer = findDungeonLayer(useStore.getState().layers, this.layerId);
    this.prior = layer?.groups?.find((g) => g.id === this.groupId)?.merged;
    this.write(this.merged);
  }

  undo(): void {
    this.write(this.prior);
  }
}

export function createRenameGroupCommand(
  layers: Layer[],
  layerId: string,
  groupId: string,
  name: string,
): Command | null {
  const layer = findDungeonLayer(layers, layerId);
  if (!layer?.groups?.some((g) => g.id === groupId)) return null;
  return new ChildGroupsCommand(
    'Rename group',
    layerId,
    { groups: layer.groups },
    { groups: layer.groups.map((g) => (g.id === groupId ? { ...g, name } : g)) },
  );
}

/**
 * Deletes every member and the group record as one undoable unit. Member
 * removal goes through `createChildRemovalCommand`, so attached lights still
 * cascade and each child still comes back at its own index on undo.
 */
export function createDeleteGroupCommand(
  layers: Layer[],
  layerId: string,
  groupId: string,
  label = 'Delete group',
): Command | null {
  const layer = findDungeonLayer(layers, layerId);
  if (!layer) return null;
  const members = layer.children.filter((c) => c.groupId === groupId);
  if (members.length === 0) return null;
  const meta = new ChildGroupsCommand(
    label,
    layerId,
    { groups: layer.groups },
    { groups: pruneGroups(layer.groups ?? [], layer.children.filter((c) => c.groupId !== groupId)) },
  );
  return new CompositeCommand(label, [
    ...members.map((c) => createChildRemovalCommand(layerId, c.id, label)),
    meta,
  ]);
}

/**
 * Clones a group: fresh ids, " (copy)" names and the one-unit offset every
 * duplicate uses, under a new group record. Built on the one duplicate path
 * (`createDuplicateCommand`), so attached lights come along.
 */
export function createDuplicateGroupCommand(
  layers: Layer[],
  layerId: string,
  groupId: string,
): Command | null {
  const layer = findDungeonLayer(layers, layerId);
  if (!layer) return null;
  const ids = layer.children.filter((c) => c.groupId === groupId).map((c) => c.id);
  return createDuplicateCommand(layers, ids, { label: 'Duplicate group' }).command;
}

/**
 * Command for per-shape style overrides.
 * Uses updateChild — never directly mutates child objects.
 */
export class ShapeStyleCommand implements Command {
  readonly label: string;
  private readonly layerId: string;
  private readonly childId: string;
  private readonly prevOverrides: Partial<DungeonStyle> | undefined;
  private readonly newOverrides: Partial<DungeonStyle> | undefined;

  constructor(
    label: string,
    layerId: string,
    childId: string,
    prevOverrides: Partial<DungeonStyle> | undefined,
    newOverrides: Partial<DungeonStyle> | undefined,
  ) {
    this.label = label;
    this.layerId = layerId;
    this.childId = childId;
    this.prevOverrides = prevOverrides ? structuredClone(prevOverrides) : undefined;
    this.newOverrides = newOverrides ? structuredClone(newOverrides) : undefined;
  }

  execute(): void {
    const state = useStore.getState();
    state.updateChild(this.layerId, this.childId, {
      styleOverrides: this.newOverrides ? structuredClone(this.newOverrides) : undefined,
    });
  }

  undo(): void {
    const state = useStore.getState();
    state.updateChild(this.layerId, this.childId, {
      styleOverrides: this.prevOverrides ? structuredClone(this.prevOverrides) : undefined,
    });
  }
}

// Room, area, level and room-key commands live beside these; one import path for all.
export * from './roomCommands';
