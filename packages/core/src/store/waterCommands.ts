// The Water panel's look on a layer that already holds water: Shallow, Deep, Blend
// distance and Border. A colour dragged or a slider run folds into one undo step.

import type { Command, DungeonLayer } from './types';
import { useStore } from './store';
import { undoManager } from './undoManager';
import type { WaterBody, WaterLook } from '../shared/waterMask';

export class WaterLookCommand implements Command {
  readonly label = 'Water look';
  readonly coalesceKey: string;
  private layerId: string;
  private before: WaterBody;
  private after: WaterBody;

  constructor(layerId: string, before: WaterBody, after: WaterBody) {
    this.layerId = layerId;
    this.coalesceKey = `water-look:${layerId}`;
    this.before = structuredClone(before);
    this.after = structuredClone(after);
  }

  execute(): void {
    useStore.getState().updateLayer(this.layerId, { water: structuredClone(this.after) });
  }

  undo(): void {
    useStore.getState().updateLayer(this.layerId, { water: structuredClone(this.before) });
  }

  merge(next: Command): boolean {
    if (!(next instanceof WaterLookCommand) || next.coalesceKey !== this.coalesceKey) return false;
    this.after = next.after;
    return true;
  }
}

/** Sets part of the look of the layer's water, as an undo step; nothing when the layer is dry. */
export function setLayerWaterLook(layerId: string, patch: Partial<WaterLook>): void {
  const layer = useStore.getState().layers.find((l): l is DungeonLayer => l.id === layerId && l.type === 'dungeon');
  if (!layer?.water) return;
  const after = { ...layer.water, ...patch };
  if ((Object.keys(patch) as (keyof WaterLook)[]).every((k) => layer.water![k] === after[k])) return;
  undoManager.execute(new WaterLookCommand(layerId, layer.water, after));
}
