import type { AnyChild, Command, DungeonLayer, DungeonStyle, Layer } from './types';
import { useStore } from './store';
import type { StylePreset } from './presets';

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

/**
 * Command for applying a style preset to a dungeon layer.
 * Captures the full previous style for single-step undo.
 */
export class ApplyPresetCommand implements Command {
  readonly label: string;
  private layerId: string;
  private presetStyle: StylePreset;
  private previousStyle: DungeonStyle;

  constructor(label: string, layerId: string, presetStyle: StylePreset, previousStyle: DungeonStyle) {
    this.label = label;
    this.layerId = layerId;
    this.presetStyle = structuredClone(presetStyle);
    this.previousStyle = structuredClone(previousStyle);
  }

  execute(): void {
    const state = useStore.getState();
    const layer = state.layers.find((l) => l.id === this.layerId);
    if (!layer || layer.type !== 'dungeon') return;
    state.updateLayer(this.layerId, {
      style: {
        ...layer.style,
        ...this.presetStyle,
      },
    } as Partial<typeof layer>);
  }

  undo(): void {
    const state = useStore.getState();
    const layer = state.layers.find((l) => l.id === this.layerId);
    if (!layer || layer.type !== 'dungeon') return;
    state.updateLayer(this.layerId, {
      style: structuredClone(this.previousStyle),
    } as Partial<typeof layer>);
  }
}
