import type { Point } from '@/types/geometry';
import type { DrawingTool, PreviewShape } from './DrawingTool';
import { useStore } from '@/store/store';
import { AddChildCommand, RemoveChildCommand, CompositeCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import { poissonDiskSample } from '@/geometry/poissonDisk';
import type { AssetChild, DungeonLayer } from '@/store/types';

const MAX_OBJECTS_PER_STROKE = 500;

export class ScatterBrushTool implements DrawingTool {
  readonly type = 'scatterBrush' as const;
  private brushing = false;
  private lastSamplePoint: Point | null = null;
  private currentPoint: Point | null = null;
  private placedChildren: AssetChild[] = [];
  private removedChildIds: string[] = [];

  onPointerDown(point: Point): void {
    this.brushing = true;
    this.lastSamplePoint = point;
    this.currentPoint = point;
    this.placedChildren = [];
    this.removedChildIds = [];

    const store = useStore.getState();
    if (store.tools.eraseMode) {
      this.eraseAt(point);
    } else {
      this.sampleAt(point);
    }
  }

  onPointerMove(point: Point): void {
    this.currentPoint = point;
    if (!this.brushing || !this.lastSamplePoint) return;

    const store = useStore.getState();
    const spacing = store.tools.settings.scatterBrush.spacing;

    const dx = point.x - this.lastSamplePoint.x;
    const dy = point.y - this.lastSamplePoint.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist >= spacing) {
      if (store.tools.eraseMode) {
        this.eraseAt(point);
      } else {
        if (this.placedChildren.length < MAX_OBJECTS_PER_STROKE) {
          this.sampleAt(point);
        }
      }
      this.lastSamplePoint = point;
    }
  }

  onPointerUp(): void {
    if (!this.brushing) return;
    this.brushing = false;
    this.lastSamplePoint = null;

    const store = useStore.getState();
    const activeLayerId = store.ui.activeLayerId;
    const activeLayer = store.layers.find(
      (l): l is DungeonLayer => l.id === activeLayerId && l.type === 'dungeon',
    );
    if (!activeLayer) return;

    if (store.tools.eraseMode) {
      if (this.removedChildIds.length > 0) {
        // Re-add preview-removed children so the commands can cleanly remove them
        for (const childId of this.removedChildIds) {
          const child = this._removedSnapshots.get(childId);
          if (child) store.addChild(activeLayerId, child);
        }
        const commands = this.removedChildIds.map(
          (id) => new RemoveChildCommand('Scatter erase', activeLayerId, id),
        );
        undoManager.execute(new CompositeCommand('Scatter erase', commands));
      }
    } else {
      if (this.placedChildren.length > 0) {
        // Remove preview-placed children so the commands can cleanly add them
        for (const child of this.placedChildren) {
          store.removeChild(activeLayerId, child.id);
        }
        const commands = this.placedChildren.map(
          (c) => new AddChildCommand('Scatter place', activeLayerId, c),
        );
        undoManager.execute(new CompositeCommand('Scatter place', commands));
      }
    }

    this.placedChildren = [];
    this.removedChildIds = [];
    this._removedSnapshots.clear();
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') this.cancel();
  }

  getPreview(): PreviewShape | null {
    if (!this.currentPoint) return null;
    const store = useStore.getState();
    const r = store.tools.settings.scatterBrush.brushRadius;
    return {
      type: 'circle',
      points: [this.currentPoint, { x: r, y: 0 }],
    };
  }

  cancel(): void {
    this.brushing = false;
    this.lastSamplePoint = null;
    this.currentPoint = null;
    this.placedChildren = [];
    this.removedChildIds = [];
    this._removedSnapshots.clear();
  }

  isActive(): boolean {
    return this.brushing;
  }

  // Temporary store for removed child snapshots during a stroke (for re-add before command)
  private _removedSnapshots = new Map<string, AssetChild>();

  private getActiveDungeonLayer(): DungeonLayer | null {
    const store = useStore.getState();
    const activeLayerId = store.ui.activeLayerId;
    const layer = store.layers.find(
      (l): l is DungeonLayer => l.id === activeLayerId && l.type === 'dungeon',
    );
    return layer ?? null;
  }

  private sampleAt(center: Point): void {
    const store = useStore.getState();
    const settings = store.tools.settings.scatterBrush;

    if (settings.assetIds.length === 0) return;

    const remaining = MAX_OBJECTS_PER_STROKE - this.placedChildren.length;
    if (remaining <= 0) return;

    const layer = this.getActiveDungeonLayer();
    if (!layer) return;

    const points = poissonDiskSample(
      center,
      settings.brushRadius,
      settings.density,
      remaining,
    );

    for (const pt of points) {
      const assetId = settings.assetIds[Math.floor(Math.random() * settings.assetIds.length)];
      const [minRot, maxRot] = settings.rotationRange;
      const [minScale, maxScale] = settings.scaleRange;

      const child: AssetChild = {
        id: crypto.randomUUID(),
        name: 'Asset',
        childType: 'asset',
        visible: true,
        objectType: 'asset',
        assetId,
        position: { x: pt.x, y: pt.y },
        rotation: minRot + Math.random() * (maxRot - minRot),
        scale: minScale + Math.random() * (maxScale - minScale),
        width: 1,
        height: 1,
        tint: '#ffffff',
        flipX: false,
        flipY: false,
      };

      // Immediately add to store for visual feedback
      store.addChild(layer.id, child);
      this.placedChildren.push(child);
    }
  }

  private eraseAt(center: Point): void {
    const layer = this.getActiveDungeonLayer();
    if (!layer) return;

    const store = useStore.getState();
    const r = store.tools.settings.scatterBrush.brushRadius;
    const rSq = r * r;

    const toRemove = layer.children.filter((c): c is AssetChild => {
      if (c.childType !== 'asset') return false;
      if (this.removedChildIds.includes(c.id)) return false;
      const dx = c.position.x - center.x;
      const dy = c.position.y - center.y;
      return dx * dx + dy * dy <= rSq;
    });

    for (const child of toRemove) {
      this._removedSnapshots.set(child.id, child);
      store.removeChild(layer.id, child.id);
      this.removedChildIds.push(child.id);
    }
  }
}
