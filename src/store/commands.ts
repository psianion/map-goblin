import type { AnyChild, Command, DungeonLayer, DungeonStyle, Layer } from './types';
import { useStore } from './store';
import type { MapStylePreset } from './presetRegistry';

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
 * Adds a child to a dungeon layer. Removes it on undo.
 */
export class AddChildCommand implements Command {
  readonly label: string;
  private layerId: string;
  private child: AnyChild;

  constructor(label: string, layerId: string, child: AnyChild) {
    this.label = label;
    this.layerId = layerId;
    this.child = structuredClone(child);
  }

  execute(): void {
    useStore.getState().addChild(this.layerId, structuredClone(this.child));
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
      const layer = state.layers.find((l) => l.id === this.layerId);
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
  removedWall: import('./types').WallSegment | null = null;
  layerId: string;
  wallId: string;

  constructor(layerId: string, wallId: string) {
    this.layerId = layerId;
    this.wallId = wallId;
  }

  execute(): void {
    const store = useStore.getState();
    const layer = store.layers.find(l => l.id === this.layerId);
    if (layer && layer.type === 'dungeon') {
      const wall = (layer as import('./types').DungeonLayer).standaloneWalls.find(w => w.id === this.wallId);
      if (wall) this.removedWall = structuredClone(wall);
    }
    store.removeWall(this.layerId, this.wallId);
  }

  undo(): void {
    if (this.removedWall) {
      useStore.getState().addWall(this.layerId, structuredClone(this.removedWall));
    }
  }
}

export class UpdateWallCommand implements Command {
  readonly label = 'Update wall';
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
    (c): c is import('@/shared/types').DoorChild =>
      c.childType === 'door' && (c as import('@/shared/types').DoorChild).wallId === wallId,
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

export class CloseAllDoorsCommand implements Command {
  readonly label = 'Close all doors';
  previousStates: Record<string, import('@/shared/types').DoorState> = {};
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
          const door = child as import('@/shared/types').DoorChild;
          this.previousStates[door.id] = door.state;
        }
      }
    }
    store.closeAllDoors(this.layerId);
  }

  undo(): void {
    const store = useStore.getState();
    for (const [doorId, state] of Object.entries(this.previousStates)) {
      store.updateChild(this.layerId, doorId, { state } as Partial<import('@/shared/types').DoorChild>);
    }
  }
}

/**
 * Command for applying a style preset to a dungeon layer.
 * Captures the full previous style for single-step undo.
 */
export class PresetApplyCommand implements Command {
  readonly label: string;
  private readonly layerId: string;
  private readonly presetStyle: Partial<DungeonStyle>;
  private readonly previousStyle: DungeonStyle;

  constructor(label: string, layerId: string, preset: MapStylePreset, previousStyle: DungeonStyle) {
    this.label = label;
    this.layerId = layerId;
    this.presetStyle = structuredClone(preset.dungeonStyle);
    this.previousStyle = structuredClone(previousStyle);
  }

  execute(): void {
    const state = useStore.getState();
    const layer = state.layers.find((l) => l.id === this.layerId);
    if (!layer || layer.type !== 'dungeon') return;
    state.updateLayer(this.layerId, {
      style: { ...layer.style, ...this.presetStyle },
    } as Partial<DungeonLayer>);
  }

  undo(): void {
    const state = useStore.getState();
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
