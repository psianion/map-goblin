import { Container } from 'pixi.js';
import type { Point } from '@/types/geometry';
import type { DrawingTool, PreviewShape } from './DrawingTool';
import { useStore } from '@/store/store';
import { UpdateChildCommand, RemoveChildCommand, CompositeCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import type { AssetChild, DungeonLayer } from '@/store/types';

type ObjectToolState = 'IDLE' | 'MOVING';

class ToolOverlay {
  readonly container = new Container();
  setWorldToScreen(_fn: (wx: number, wy: number) => Point): void {}
}

function hitTestAssetChild(obj: AssetChild, point: Point): boolean {
  const halfW = (obj.width || 1) * 0.5;
  const halfH = (obj.height || 1) * 0.5;
  return (
    Math.abs(point.x - obj.position.x) < halfW &&
    Math.abs(point.y - obj.position.y) < halfH
  );
}

export class ObjectTool implements DrawingTool {
  readonly type = 'object' as const;
  readonly overlay = new ToolOverlay();

  private state: ObjectToolState = 'IDLE';
  private moveStart: Point | null = null;
  private movingChildIds: string[] = [];

  onPointerDown(point: Point, event?: PointerEvent): void {
    const store = useStore.getState();
    const activeLayerId = store.ui.activeLayerId;
    const activeLayer = store.layers.find(
      (l): l is DungeonLayer => l.id === activeLayerId && l.type === 'dungeon',
    );
    if (!activeLayer) return;

    const assetChildren = activeLayer.children.filter(
      (c): c is AssetChild => c.childType === 'asset',
    );
    const hitChild = [...assetChildren].reverse().find((c) => hitTestAssetChild(c, point));

    if (hitChild) {
      const shiftHeld = event?.shiftKey ?? false;
      const currentSelected = store.selection.selectedIds;

      if (shiftHeld) {
        if (currentSelected.includes(hitChild.id)) {
          store.setSelectedIds(currentSelected.filter((id) => id !== hitChild.id));
        } else {
          store.setSelectedIds([...currentSelected, hitChild.id]);
        }
      } else if (!currentSelected.includes(hitChild.id)) {
        store.setSelectedIds([hitChild.id]);
      }

      this.state = 'MOVING';
      this.moveStart = point;
      this.movingChildIds = store.selection.selectedIds.includes(hitChild.id)
        ? [...store.selection.selectedIds]
        : [hitChild.id];
    } else {
      store.setSelectedIds([]);
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
        const activeLayer = store.layers.find(
          (l): l is DungeonLayer => l.id === activeLayerId && l.type === 'dungeon',
        );
        if (!activeLayer) return;

        const commands = this.movingChildIds.flatMap((childId) => {
          const child = activeLayer.children.find(
            (c): c is AssetChild => c.id === childId && c.childType === 'asset',
          );
          if (!child) return [];
          const oldPos = { ...child.position };
          const newPos = { x: child.position.x + dx, y: child.position.y + dy };
          return [
            new UpdateChildCommand(
              'Move asset',
              activeLayerId,
              childId,
              { position: oldPos },
              { position: newPos },
            ),
          ];
        });

        if (commands.length === 1) {
          undoManager.execute(commands[0]);
        } else if (commands.length > 1) {
          undoManager.execute(new CompositeCommand('Move assets', commands));
        }
      }
    }

    this.state = 'IDLE';
    this.moveStart = null;
    this.movingChildIds = [];
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
    const selectedIds = store.selection.selectedIds;
    if (selectedIds.length === 0) return;

    const activeLayerId = store.ui.activeLayerId;
    const activeLayer = store.layers.find(
      (l): l is DungeonLayer => l.id === activeLayerId && l.type === 'dungeon',
    );
    if (!activeLayer) return;

    const commands = selectedIds
      .filter((id) => activeLayer.children.some((c) => c.id === id))
      .map((id) => new RemoveChildCommand('Delete asset', activeLayerId, id));

    if (commands.length === 0) return;

    if (commands.length === 1) {
      undoManager.execute(commands[0]);
    } else {
      undoManager.execute(new CompositeCommand('Delete assets', commands));
    }

    store.setSelectedIds([]);
  }

  getPreview(): PreviewShape | null {
    return null;
  }

  cancel(): void {
    this.state = 'IDLE';
    this.moveStart = null;
    this.movingChildIds = [];
    useStore.getState().setSelectedIds([]);
  }

  isActive(): boolean {
    return this.state !== 'IDLE';
  }
}
