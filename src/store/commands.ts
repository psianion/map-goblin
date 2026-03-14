import type { Command, DungeonLayer, DungeonStyle, Light, PlacedObject, ShapeRecord } from './types';
import { useStore } from './store';
import type { Polygon } from '@/types/geometry';
import { clipper2Engine } from '@/geometry/Clipper2Engine';
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
 * Command for changing a single property on a store object.
 */
export class ChangePropertyCommand<T> implements Command {
  readonly label: string;
  private oldValue: T;
  private newValue: T;
  private applyFn: (value: T) => void;

  constructor(label: string, oldValue: T, newValue: T, applyFn: (value: T) => void) {
    this.label = label;
    this.oldValue = oldValue;
    this.newValue = newValue;
    this.applyFn = applyFn;
  }

  execute(): void {
    this.applyFn(this.newValue);
  }

  undo(): void {
    this.applyFn(this.oldValue);
  }
}

/**
 * Command for drawing a shape (union or difference) on a dungeon layer.
 * Snapshots the full merged floor polygon for reliable undo.
 */
export class DrawShapeCommand implements Command {
  readonly label: string;
  private layerId: string;
  private previousMergedFloor: [number, number][][] | null;
  private newMergedFloor: [number, number][][] | null;
  private shapeRecord: { id: string; type: string; points: [number, number][]; roughnessEnabled: boolean; roughnessAmplitude?: number } | null;
  private isErase: boolean;

  constructor(
    label: string,
    layerId: string,
    previousMergedFloor: [number, number][][] | null,
    newMergedFloor: [number, number][][] | null,
    shapeRecord: { id: string; type: string; points: [number, number][]; roughnessEnabled: boolean; roughnessAmplitude?: number } | null,
    isErase: boolean,
  ) {
    this.label = label;
    this.layerId = layerId;
    this.previousMergedFloor = previousMergedFloor;
    this.newMergedFloor = newMergedFloor;
    this.shapeRecord = shapeRecord;
    this.isErase = isErase;
  }

  execute(): void {
    const store = useStore.getState();
    store.updateMergedFloor(this.layerId, this.newMergedFloor);
    if (this.shapeRecord && !this.isErase) {
      store.addShape(this.layerId, this.shapeRecord as Parameters<typeof store.addShape>[1]);
    }
  }

  undo(): void {
    const store = useStore.getState();
    store.updateMergedFloor(this.layerId, this.previousMergedFloor);
    if (this.shapeRecord && !this.isErase) {
      store.removeShape(this.layerId, this.shapeRecord.id);
    }
  }

  cleanup(): void {
    this.previousMergedFloor = null;
    this.newMergedFloor = null;
  }
}

/**
 * Command for adding a standalone wall segment.
 */
export class AddWallCommand implements Command {
  readonly label: string;
  private layerId: string;
  private wall: { id: string; points: [number, number][]; blocksLight: boolean; color: string; width: number; roughness: number };

  constructor(
    label: string,
    layerId: string,
    wall: { id: string; points: [number, number][]; blocksLight: boolean; color: string; width: number; roughness: number },
  ) {
    this.label = label;
    this.layerId = layerId;
    this.wall = wall;
  }

  execute(): void {
    useStore.getState().addWall(this.layerId, this.wall);
  }

  undo(): void {
    useStore.getState().removeWall(this.layerId, this.wall.id);
  }
}

/**
 * Command for adding a layer.
 */
export class AddLayerCommand implements Command {
  readonly label: string;
  private layer: Parameters<ReturnType<typeof useStore.getState>['addLayer']>[0];
  private layerId: string;

  constructor(label: string, layer: Parameters<ReturnType<typeof useStore.getState>['addLayer']>[0]) {
    this.label = label;
    this.layer = layer;
    this.layerId = layer.id;
  }

  execute(): void {
    useStore.getState().addLayer(this.layer);
  }

  undo(): void {
    useStore.getState().removeLayer(this.layerId);
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
 * Command for removing a layer (captures layer data for undo restoration).
 */
export class RemoveLayerCommand implements Command {
  readonly label: string;
  private layer: ReturnType<ReturnType<typeof useStore.getState>['getSerializableState']>['layers'][number] | null = null;
  private layerId: string;
  private layerIndex: number = -1;

  constructor(label: string, layerId: string) {
    this.label = label;
    this.layerId = layerId;
  }

  execute(): void {
    const state = useStore.getState();
    const layers = state.layers;
    this.layerIndex = layers.findIndex((l) => l.id === this.layerId);
    this.layer = structuredClone(layers[this.layerIndex]) as typeof this.layer;
    state.removeLayer(this.layerId);
  }

  undo(): void {
    if (!this.layer) return;
    const state = useStore.getState();
    state.addLayer(this.layer as Parameters<typeof state.addLayer>[0]);
    if (this.layerIndex >= 0) {
      const currentIndex = state.layers.findIndex((l) => l.id === this.layerId);
      if (currentIndex !== this.layerIndex) {
        state.reorderLayers(currentIndex, this.layerIndex);
      }
    }
  }
}

/**
 * Command for moving a selected region on a dungeon layer.
 * Snapshots merged floor before/after for reliable undo.
 */
export class SelectionMoveCommand implements Command {
  readonly label = 'Move selection';
  private layerId: string;
  private previousMergedFloor: [number, number][][] | null;
  private newMergedFloor: [number, number][][] | null;

  constructor(
    layerId: string,
    previousMergedFloor: [number, number][][] | null,
    newMergedFloor: [number, number][][] | null,
  ) {
    this.layerId = layerId;
    this.previousMergedFloor = previousMergedFloor;
    this.newMergedFloor = newMergedFloor;
  }

  execute(): void {
    useStore.getState().updateMergedFloor(this.layerId, this.newMergedFloor);
  }

  undo(): void {
    useStore.getState().updateMergedFloor(this.layerId, this.previousMergedFloor);
  }

  cleanup(): void {
    this.previousMergedFloor = null;
    this.newMergedFloor = null;
  }
}

/**
 * Command for pasting a polygon region onto a dungeon layer (boolean union).
 */
export class PasteCommand implements Command {
  readonly label = 'Paste';
  private layerId: string;
  private previousMergedFloor: Polygon[] | null;
  private newMergedFloor: Polygon[] | null = null;
  private pastedRegion: Polygon[];

  constructor(
    layerId: string,
    previousMergedFloor: Polygon[] | null,
    pastedRegion: Polygon[],
  ) {
    this.layerId = layerId;
    this.previousMergedFloor = previousMergedFloor;
    this.pastedRegion = pastedRegion;
  }

  execute(): void {
    if (!this.newMergedFloor) {
      const existing: Polygon[] = this.previousMergedFloor ?? [];
      const result = clipper2Engine.union(existing, this.pastedRegion);
      this.newMergedFloor = result;
    }
    useStore.getState().updateMergedFloor(this.layerId, this.newMergedFloor);
  }

  undo(): void {
    useStore.getState().updateMergedFloor(this.layerId, this.previousMergedFloor);
  }

  cleanup(): void {
    this.previousMergedFloor = null;
    this.newMergedFloor = null;
    this.pastedRegion = [];
  }
}

/**
 * Command for cutting (erasing) a selected region from a dungeon layer.
 */
export class CutCommand implements Command {
  readonly label = 'Cut selection';
  private layerId: string;
  private previousMergedFloor: Polygon[] | null;
  private newMergedFloor: Polygon[] | null = null;
  private cutRegion: Polygon[];

  constructor(
    layerId: string,
    previousMergedFloor: Polygon[] | null,
    cutRegion: Polygon[],
  ) {
    this.layerId = layerId;
    this.previousMergedFloor = previousMergedFloor;
    this.cutRegion = cutRegion;
  }

  execute(): void {
    if (!this.newMergedFloor) {
      const existing: Polygon[] = this.previousMergedFloor ?? [];
      const result = clipper2Engine.difference(existing, this.cutRegion);
      this.newMergedFloor = result;
    }
    useStore.getState().updateMergedFloor(this.layerId, this.newMergedFloor);
  }

  undo(): void {
    useStore.getState().updateMergedFloor(this.layerId, this.previousMergedFloor);
  }

  cleanup(): void {
    this.previousMergedFloor = null;
    this.newMergedFloor = null;
    this.cutRegion = [];
  }
}

/**
 * Command for placing a new object (asset or imported image) on an images layer.
 */
export class PlaceObjectCommand implements Command {
  readonly label: string;
  private layerId: string;
  private obj: PlacedObject;

  constructor(label: string, layerId: string, obj: PlacedObject) {
    this.label = label;
    this.layerId = layerId;
    this.obj = obj;
  }

  execute(): void {
    const store = useStore.getState();
    store.addPlacedObject(this.layerId, { ...this.obj, layerId: this.layerId });
    if (this.obj.assetId) {
      store.trackRecentUse(this.obj.assetId);
      store.addRecentAsset(this.obj.assetId);
    }
  }

  undo(): void {
    useStore.getState().removePlacedObject(this.layerId, this.obj.id);
  }
}

/**
 * Command for moving a placed object on an images layer.
 */
export class MoveObjectCommand implements Command {
  readonly label = 'Move object';
  private layerId: string;
  private objectId: string;
  private oldPosition: { x: number; y: number };
  private newPosition: { x: number; y: number };

  constructor(
    layerId: string,
    objectId: string,
    oldPosition: { x: number; y: number },
    newPosition: { x: number; y: number },
  ) {
    this.layerId = layerId;
    this.objectId = objectId;
    this.oldPosition = oldPosition;
    this.newPosition = newPosition;
  }

  execute(): void {
    this.applyPosition(this.newPosition);
  }

  undo(): void {
    this.applyPosition(this.oldPosition);
  }

  private applyPosition(pos: { x: number; y: number }): void {
    const state = useStore.getState();
    const layer = state.layers.find((l) => l.id === this.layerId);
    if (!layer || layer.type !== 'images') return;
    state.updateLayer(this.layerId, {
      objects: layer.objects.map((o) =>
        o.id === this.objectId ? { ...o, position: pos } : o,
      ),
    } as Partial<typeof layer>);
  }
}

/**
 * Command for resizing a placed object.
 */
export class ResizeObjectCommand implements Command {
  readonly label = 'Resize object';
  private layerId: string;
  private objectId: string;
  private oldScale: number;
  private newScale: number;

  constructor(layerId: string, objectId: string, oldScale: number, newScale: number) {
    this.layerId = layerId;
    this.objectId = objectId;
    this.oldScale = oldScale;
    this.newScale = newScale;
  }

  execute(): void {
    this.applyScale(this.newScale);
  }

  undo(): void {
    this.applyScale(this.oldScale);
  }

  private applyScale(scale: number): void {
    const state = useStore.getState();
    const layer = state.layers.find((l) => l.id === this.layerId);
    if (!layer || layer.type !== 'images') return;
    state.updateLayer(this.layerId, {
      objects: layer.objects.map((o) =>
        o.id === this.objectId ? { ...o, scale } : o,
      ),
    } as Partial<typeof layer>);
  }
}

/**
 * Command for rotating a placed object.
 */
export class RotateObjectCommand implements Command {
  readonly label = 'Rotate object';
  private layerId: string;
  private objectId: string;
  private oldRotation: number;
  private newRotation: number;

  constructor(layerId: string, objectId: string, oldRotation: number, newRotation: number) {
    this.layerId = layerId;
    this.objectId = objectId;
    this.oldRotation = oldRotation;
    this.newRotation = newRotation;
  }

  execute(): void {
    this.applyRotation(this.newRotation);
  }

  undo(): void {
    this.applyRotation(this.oldRotation);
  }

  private applyRotation(rotation: number): void {
    const state = useStore.getState();
    const layer = state.layers.find((l) => l.id === this.layerId);
    if (!layer || layer.type !== 'images') return;
    state.updateLayer(this.layerId, {
      objects: layer.objects.map((o) =>
        o.id === this.objectId ? { ...o, rotation } : o,
      ),
    } as Partial<typeof layer>);
  }
}

/**
 * Command for reordering objects in an images layer (z-ordering).
 */
export class ReorderObjectCommand implements Command {
  readonly label: string;
  private layerId: string;
  private oldIndex: number;
  private newIndex: number;

  constructor(label: string, layerId: string, oldIndex: number, newIndex: number) {
    this.label = label;
    this.layerId = layerId;
    this.oldIndex = oldIndex;
    this.newIndex = newIndex;
  }

  execute(): void {
    this.applyReorder(this.oldIndex, this.newIndex);
  }

  undo(): void {
    this.applyReorder(this.newIndex, this.oldIndex);
  }

  private applyReorder(fromIndex: number, toIndex: number): void {
    const state = useStore.getState();
    const layer = state.layers.find((l) => l.id === this.layerId);
    if (!layer || layer.type !== 'images') return;
    const objects = [...layer.objects];
    const [item] = objects.splice(fromIndex, 1);
    objects.splice(toIndex, 0, item);
    state.updateLayer(this.layerId, { objects } as Partial<typeof layer>);
  }
}

/**
 * Command for placing a new light.
 */
export class PlaceLightCommand implements Command {
  readonly label = 'Place Light';
  private light: Light;

  constructor(light: Light) {
    this.light = light;
  }

  execute(): void {
    useStore.getState().addLight(this.light);
  }

  undo(): void {
    useStore.getState().removeLight(this.light.id);
  }
}

/**
 * Command for moving an existing light.
 */
export class MoveLightCommand implements Command {
  readonly label = 'Move Light';
  private lightId: string;
  private from: { x: number; y: number };
  private to: { x: number; y: number };

  constructor(
    lightId: string,
    from: { x: number; y: number },
    to: { x: number; y: number },
  ) {
    this.lightId = lightId;
    this.from = from;
    this.to = to;
  }

  execute(): void {
    useStore.getState().updateLight(this.lightId, { position: this.to });
  }

  undo(): void {
    useStore.getState().updateLight(this.lightId, { position: this.from });
  }
}

/**
 * Command for applying a non-uniform transform to a placed object (position, size, rotation).
 * Uses updatePlacedObject for atomic before/after patches — clean undo/redo.
 */
export class TransformCommand implements Command {
  readonly label: string;
  private layerId: string;
  private objectId: string;
  private beforePatch: Partial<PlacedObject>;
  private afterPatch: Partial<PlacedObject>;

  constructor(
    layerId: string,
    objectId: string,
    beforePatch: Partial<PlacedObject>,
    afterPatch: Partial<PlacedObject>,
    label = 'Transform object',
  ) {
    this.layerId = layerId;
    this.objectId = objectId;
    this.beforePatch = beforePatch;
    this.afterPatch = afterPatch;
    this.label = label;
  }

  execute(): void {
    useStore.getState().updatePlacedObject(this.layerId, this.objectId, this.afterPatch);
  }

  undo(): void {
    useStore.getState().updatePlacedObject(this.layerId, this.objectId, this.beforePatch);
  }
}

/**
 * Command for transforming a dungeon shape — updates both the shape's transform field
 * and the pre-computed mergedFloor snapshot for reliable undo.
 */
export class ShapeTransformCommand implements Command {
  readonly label = 'Transform shape';
  private layerId: string;
  private shapeId: string;
  private beforeTransform: ShapeRecord['transform'];
  private afterTransform: ShapeRecord['transform'];
  private beforeMerged: Polygon[] | null;
  private afterMerged: Polygon[] | null;

  constructor(
    layerId: string,
    shapeId: string,
    beforeTransform: ShapeRecord['transform'],
    afterTransform: ShapeRecord['transform'],
    beforeMerged: Polygon[] | null,
    afterMerged: Polygon[] | null,
  ) {
    this.layerId = layerId;
    this.shapeId = shapeId;
    this.beforeTransform = beforeTransform;
    this.afterTransform = afterTransform;
    this.beforeMerged = beforeMerged;
    this.afterMerged = afterMerged;
  }

  execute(): void {
    useStore.setState((s) => {
      const l = s.layers.find((l) => l.id === this.layerId) as DungeonLayer | undefined;
      if (!l) return;
      const sh = l.shapes.find((s) => s.id === this.shapeId);
      if (sh) sh.transform = this.afterTransform;
      l.mergedFloor = this.afterMerged;
    });
  }

  undo(): void {
    useStore.setState((s) => {
      const l = s.layers.find((l) => l.id === this.layerId) as DungeonLayer | undefined;
      if (!l) return;
      const sh = l.shapes.find((s) => s.id === this.shapeId);
      if (sh) sh.transform = this.beforeTransform;
      l.mergedFloor = this.beforeMerged;
    });
  }

  cleanup(): void {
    this.beforeMerged = null;
    this.afterMerged = null;
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
    this.presetStyle = presetStyle;
    this.previousStyle = previousStyle;
  }

  execute(): void {
    const state = useStore.getState();
    const layer = state.layers.find((l) => l.id === this.layerId);
    if (!layer || layer.type !== 'dungeon') return;
    // Apply preset properties while preserving roughnessAmplitude and lineWidth
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
      style: { ...this.previousStyle },
    } as Partial<typeof layer>);
  }
}
