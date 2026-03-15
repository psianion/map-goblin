import type { Point } from '@/types/geometry';
import type { DrawingTool, PreviewShape } from './DrawingTool';
import { useStore } from '@/store/store';
import { ScatterPlaceCommand, ScatterEraseCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import { poissonDiskSample } from '@/geometry/poissonDisk';
import type { PlacedObject, ImagesLayer } from '@/store/types';
import { createImagesLayer } from '@/store/factories';

const MAX_OBJECTS_PER_STROKE = 500;

export class ScatterBrushTool implements DrawingTool {
  readonly type = 'scatterBrush' as const;
  private brushing = false;
  private lastSamplePoint: Point | null = null;
  private currentPoint: Point | null = null;
  private placedObjects: PlacedObject[] = [];
  private removedObjects: PlacedObject[] = [];

  onPointerDown(point: Point): void {
    this.brushing = true;
    this.lastSamplePoint = point;
    this.currentPoint = point;
    this.placedObjects = [];
    this.removedObjects = [];

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

    // Check if we've moved far enough for a new sample
    const dx = point.x - this.lastSamplePoint.x;
    const dy = point.y - this.lastSamplePoint.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist >= spacing) {
      if (store.tools.eraseMode) {
        this.eraseAt(point);
      } else {
        if (this.placedObjects.length < MAX_OBJECTS_PER_STROKE) {
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
    const imagesLayer = this.getImagesLayer();
    if (!imagesLayer) return;

    if (store.tools.eraseMode) {
      if (this.removedObjects.length > 0) {
        // Re-add preview-removed objects so the command can cleanly remove them
        for (const obj of this.removedObjects) {
          store.addPlacedObject(imagesLayer.id, obj);
        }
        undoManager.execute(
          new ScatterEraseCommand(imagesLayer.id, [...this.removedObjects]),
        );
      }
    } else {
      if (this.placedObjects.length > 0) {
        // Remove preview-placed objects so the command can cleanly add them
        for (const obj of this.placedObjects) {
          store.removePlacedObject(imagesLayer.id, obj.id);
        }
        undoManager.execute(
          new ScatterPlaceCommand(imagesLayer.id, [...this.placedObjects]),
        );
      }
    }

    this.placedObjects = [];
    this.removedObjects = [];
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') this.cancel();
  }

  getPreview(): PreviewShape | null {
    if (!this.currentPoint) return null;
    const store = useStore.getState();
    const r = store.tools.settings.scatterBrush.brushRadius;
    // Circle preview at cursor position
    return {
      type: 'circle',
      points: [this.currentPoint, { x: r, y: 0 }],
    };
  }

  cancel(): void {
    this.brushing = false;
    this.lastSamplePoint = null;
    this.currentPoint = null;
    this.placedObjects = [];
    this.removedObjects = [];
  }

  isActive(): boolean {
    return this.brushing;
  }

  private sampleAt(center: Point): void {
    const store = useStore.getState();
    const settings = store.tools.settings.scatterBrush;

    if (settings.assetIds.length === 0) return;

    const remaining = MAX_OBJECTS_PER_STROKE - this.placedObjects.length;
    if (remaining <= 0) return;

    const points = poissonDiskSample(
      center,
      settings.brushRadius,
      settings.density,
      remaining,
    );

    const imagesLayer = this.getImagesLayer();
    if (!imagesLayer) return;

    for (const pt of points) {
      const assetId = settings.assetIds[Math.floor(Math.random() * settings.assetIds.length)];
      const [minRot, maxRot] = settings.rotationRange;
      const [minScale, maxScale] = settings.scaleRange;

      const obj: PlacedObject = {
        id: crypto.randomUUID(),
        layerId: imagesLayer.id,
        objectType: 'asset',
        assetId,
        position: { x: pt.x, y: pt.y },
        rotation: minRot + Math.random() * (maxRot - minRot),
        scale: minScale + Math.random() * (maxScale - minScale),
        width: 1,
        height: 1,
        tint: '#ffffff',
        groupId: null,
        flipX: false,
        flipY: false,
      };

      // Immediately add to store for visual feedback
      store.addPlacedObject(imagesLayer.id, obj);
      this.placedObjects.push(obj);
    }
  }

  private eraseAt(center: Point): void {
    const imagesLayer = this.getImagesLayer();
    if (!imagesLayer) return;

    const store = useStore.getState();
    const r = store.tools.settings.scatterBrush.brushRadius;
    const rSq = r * r;

    // Find objects within brush radius
    const toRemove = imagesLayer.objects.filter((obj) => {
      // Skip already-removed objects in this stroke
      if (this.removedObjects.some((ro) => ro.id === obj.id)) return false;
      const dx = obj.position.x - center.x;
      const dy = obj.position.y - center.y;
      return dx * dx + dy * dy <= rSq;
    });

    for (const obj of toRemove) {
      store.removePlacedObject(imagesLayer.id, obj.id);
      this.removedObjects.push(obj);
    }
  }

  private getImagesLayer(): ImagesLayer {
    const store = useStore.getState();
    // Prefer active layer if it's images type
    const activeLayer = store.layers.find((l) => l.id === store.ui.activeLayerId);
    if (activeLayer?.type === 'images') return activeLayer as ImagesLayer;
    // Fall back to first images layer
    const existing = store.layers.find((l): l is ImagesLayer => l.type === 'images');
    if (existing) return existing;
    // Auto-create an images layer if none exists
    const newLayer = createImagesLayer('Images');
    store.addLayer(newLayer);
    return newLayer;
  }
}
