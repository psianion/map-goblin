import { Container } from 'pixi.js';
import type { Point } from '@/types/geometry';
import type { DrawingTool, PreviewShape } from './DrawingTool';
import { useStore } from '@/store/store';
import { MoveObjectCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import type { ImagesLayer, PlacedObject } from '@/store/types';

type ObjectToolState = 'IDLE' | 'MOVING';

class ToolOverlay {
  readonly container = new Container();
  setWorldToScreen(_fn: (wx: number, wy: number) => Point): void {}
}

function hitTestObject(obj: PlacedObject, point: Point): boolean {
  const halfSize = (obj.scale || 1) * 0.5;
  return (
    Math.abs(point.x - obj.position.x) < halfSize &&
    Math.abs(point.y - obj.position.y) < halfSize
  );
}

export class ObjectTool implements DrawingTool {
  readonly type = 'object' as const;
  readonly overlay = new ToolOverlay();

  private state: ObjectToolState = 'IDLE';
  private moveStart: Point | null = null;
  private movingObjectIds: string[] = [];

  onPointerDown(point: Point, event?: PointerEvent): void {
    const store = useStore.getState();
    const activeLayerId = store.ui.activeLayerId;
    const activeLayer = store.layers.find(
      (l): l is ImagesLayer => l.id === activeLayerId && l.type === 'images',
    );
    if (!activeLayer) return;

    const hitObject = [...activeLayer.objects].reverse().find((obj) => hitTestObject(obj, point));

    if (hitObject) {
      const shiftHeld = event?.shiftKey ?? false;
      const currentSelected = store.ui.selectedObjectIds;

      if (shiftHeld) {
        if (currentSelected.includes(hitObject.id)) {
          store.setSelectedObjectIds(currentSelected.filter((id) => id !== hitObject.id));
        } else {
          store.setSelectedObjectIds([...currentSelected, hitObject.id]);
        }
      } else if (!currentSelected.includes(hitObject.id)) {
        store.setSelectedObjectIds([hitObject.id]);
      }

      this.state = 'MOVING';
      this.moveStart = point;
      this.movingObjectIds = store.ui.selectedObjectIds.includes(hitObject.id)
        ? [...store.ui.selectedObjectIds]
        : [hitObject.id];
    } else {
      store.setSelectedObjectIds([]);
      this.state = 'IDLE';
    }
  }

  onPointerMove(_point: Point): void {
    // No preview rendering needed for object tool
  }

  onPointerUp(point: Point): void {
    if (this.state === 'MOVING' && this.moveStart) {
      const dx = point.x - this.moveStart.x;
      const dy = point.y - this.moveStart.y;

      if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) {
        const store = useStore.getState();
        const activeLayerId = store.ui.activeLayerId;

        for (const objId of this.movingObjectIds) {
          const layer = store.layers.find(
            (l): l is ImagesLayer => l.id === activeLayerId && l.type === 'images',
          );
          const obj = layer?.objects.find((o) => o.id === objId);
          if (!obj) continue;

          const oldPos = { ...obj.position };
          const newPos = { x: obj.position.x + dx, y: obj.position.y + dy };

          undoManager.execute(
            new MoveObjectCommand(activeLayerId, objId, oldPos, newPos),
          );
        }
      }
    }

    this.state = 'IDLE';
    this.moveStart = null;
    this.movingObjectIds = [];
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.cancel();
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      this.deleteSelected();
    }
  }

  private deleteSelected(): void {
    const store = useStore.getState();
    const selectedIds = store.ui.selectedObjectIds;
    if (selectedIds.length === 0) return;
    const activeLayerId = store.ui.activeLayerId;
    const layer = store.layers.find(
      (l): l is ImagesLayer => l.id === activeLayerId && l.type === 'images',
    );
    if (!layer) return;

    for (const objId of selectedIds) {
      store.removePlacedObject(activeLayerId, objId);
    }
    store.setSelectedObjectIds([]);
  }

  getPreview(): PreviewShape | null {
    return null;
  }

  cancel(): void {
    this.state = 'IDLE';
    this.moveStart = null;
    this.movingObjectIds = [];
    useStore.getState().setSelectedObjectIds([]);
  }

  isActive(): boolean {
    return this.state !== 'IDLE';
  }
}
