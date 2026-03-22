import type { Point } from '@/types/geometry';
import type { DrawingTool, PreviewShape } from './DrawingTool';
import type { DoorChild, DungeonLayer } from '@/store/types';
import { snapToNearestWall, type WallSnapResult } from '@/shared/wallSnap';
import { AddChildCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import { useStore } from '@/store/store';

export class DoorTool implements DrawingTool {
  readonly type = 'door' as const;
  snapResult: WallSnapResult | null = null;

  onPointerDown(_point: Point): void {
    if (!this.snapResult) return;

    const store = useStore.getState();
    const activeLayerId = store.ui.activeLayerId;
    const activeLayer = store.layers.find(
      (l): l is DungeonLayer => l.id === activeLayerId && l.type === 'dungeon',
    );
    if (!activeLayer) return;

    const toolSettings = store.tools.settings;

    // Check for door overlap on this wall
    const existingDoors = activeLayer.children.filter(
      (c) => c.childType === 'door' && (c as DoorChild).wallId === this.snapResult!.wallId,
    ) as DoorChild[];

    const doorWidth = toolSettings.doorWidth || 1;
    const wall = activeLayer.standaloneWalls.find((w) => w.id === this.snapResult!.wallId);
    if (!wall) return;

    // Validate: check overlap
    for (const existing of existingDoors) {
      const dist = Math.sqrt(
        (existing.position[0] - this.snapResult.position[0]) ** 2 +
        (existing.position[1] - this.snapResult.position[1]) ** 2,
      );
      if (dist < (existing.width + doorWidth) / 2) {
        return; // overlap — reject placement
      }
    }

    // M8: Reject door wider than the wall it's being placed on
    const wallStart = wall.points[0];
    const wallEnd = wall.points[wall.points.length - 1];
    const wallLen = Math.sqrt(
      (wallEnd[0] - wallStart[0]) ** 2 + (wallEnd[1] - wallStart[1]) ** 2,
    );
    if (doorWidth > wallLen) return; // door too wide for wall

    // L6: Auto-name by style — e.g., "Portcullis 1", "Archway 2"
    const styleName =
      toolSettings.doorStyle.charAt(0).toUpperCase() + toolSettings.doorStyle.slice(1);
    const stylePattern = new RegExp(`^${styleName} (\\d+)$`);
    const doorNumbers = activeLayer.children
      .filter((c) => c.childType === 'door')
      .map((c) => {
        const match = c.name.match(stylePattern);
        return match ? parseInt(match[1], 10) : 0;
      });
    const nextNum = doorNumbers.length > 0 ? Math.max(...doorNumbers) + 1 : 1;

    const door: DoorChild = {
      id: crypto.randomUUID(),
      name: `${styleName} ${nextNum}`,
      childType: 'door',
      visible: true,
      wallId: this.snapResult.wallId,
      position: this.snapResult.position,
      angle: this.snapResult.angle,
      width: doorWidth,
      style: toolSettings.doorStyle ?? 'single',
      state: 'closed',
      isSecret: toolSettings.doorSecret ?? false,
    };

    undoManager.execute(new AddChildCommand('Place door', activeLayerId, door));
  }

  onPointerMove(point: Point): void {
    const store = useStore.getState();
    const activeLayerId = store.ui.activeLayerId;
    const activeLayer = store.layers.find(
      (l): l is DungeonLayer => l.id === activeLayerId && l.type === 'dungeon',
    );
    if (!activeLayer) return;

    // H7: Use a fixed world-unit threshold that gives ~1.5 grid cells of snap range.
    // World coords use 1 unit = 1 grid cell, so 1.5 is always correct regardless of zoom.
    // (The old value of 2 was fine but 1.5 is more precise and avoids snapping across gaps.)
    const snapThreshold = 1.5;

    // M9: Overlap detection uses Euclidean center distance which is a simplification.
    // For most cases this is accurate enough since doors are placed along a single wall.
    // A full parametric interval check would be needed for exact edge-case accuracy.
    this.snapResult = snapToNearestWall(
      [point.x, point.y],
      activeLayer.standaloneWalls,
      snapThreshold,
    );
  }

  onPointerUp(_point: Point): void {
    // Single-click tool — no drag behavior
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') this.cancel();
  }

  getPreview(): PreviewShape | null {
    if (!this.snapResult) return null;
    const store = useStore.getState();
    const doorWidth = store.tools.settings.doorWidth || 1;
    const halfWidth = doorWidth / 2;
    const angle = this.snapResult.angle;
    const cx = this.snapResult.position[0];
    const cy = this.snapResult.position[1];

    // Line along the wall at the snap point
    return {
      type: 'line',
      points: [
        { x: cx - Math.cos(angle) * halfWidth, y: cy - Math.sin(angle) * halfWidth },
        { x: cx + Math.cos(angle) * halfWidth, y: cy + Math.sin(angle) * halfWidth },
      ],
    };
  }

  cancel(): void {
    this.snapResult = null;
  }

  isActive(): boolean {
    return false; // single-click tool
  }
}
