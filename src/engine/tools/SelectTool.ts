import { Container, Graphics } from 'pixi.js';
import type { Point, Polygon } from '@/types/geometry';
import type { DrawingTool, PreviewShape } from './DrawingTool';
import { useStore } from '@/store/store';
import { SelectionMoveCommand, CutCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import { clipper2Engine } from '@/geometry/Clipper2Engine';
import type { DungeonLayer } from '@/store/types';

type SelectState = 'IDLE' | 'SELECTING' | 'SELECTED' | 'MOVING';

class ToolOverlay {
  readonly container = new Container();
  private selectionGraphics = new Graphics();

  constructor() {
    this.container.addChild(this.selectionGraphics);
  }

  setWorldToScreen(_fn: (wx: number, wy: number) => Point): void {
  }

  drawSelection(region: Polygon[]): void {
    this.selectionGraphics.clear();
    if (region.length === 0) return;
    this.selectionGraphics.setStrokeStyle({ color: 0x4488ff, width: 0.04 });
    for (const poly of region) {
      if (poly.length < 3) continue;
      this.selectionGraphics.moveTo(poly[0][0], poly[0][1]);
      for (let i = 1; i < poly.length; i++) {
        this.selectionGraphics.lineTo(poly[i][0], poly[i][1]);
      }
      this.selectionGraphics.closePath();
      this.selectionGraphics.fill({ color: 0x4488ff, alpha: 0.15 });
      this.selectionGraphics.stroke();
    }
  }

  clear(): void {
    this.selectionGraphics.clear();
  }
}

export class SelectTool implements DrawingTool {
  readonly type = 'select' as const;
  readonly overlay = new ToolOverlay();

  private state: SelectState = 'IDLE';
  private startPoint: Point | null = null;
  private currentPoint: Point | null = null;
  private moveStart: Point | null = null;

  onPointerDown(point: Point): void {
    const store = useStore.getState();
    const selectedRegion = store.selection.selectedRegion;

    if (this.state === 'SELECTED' && selectedRegion) {
      const testRect: [number, number][] = [
        [point.x - 0.01, point.y - 0.01],
        [point.x + 0.01, point.y - 0.01],
        [point.x + 0.01, point.y + 0.01],
        [point.x - 0.01, point.y + 0.01],
      ];
      const hit = clipper2Engine.intersection(selectedRegion, [testRect]);
      if (hit.length > 0) {
        this.state = 'MOVING';
        this.moveStart = point;
        this.currentPoint = point;
        return;
      }
    }

    this.state = 'SELECTING';
    this.startPoint = point;
    this.currentPoint = point;
    store.setSelectedRegion(null);
    this.overlay.clear();
  }

  onPointerMove(point: Point): void {
    this.currentPoint = point;
    if (this.state === 'MOVING' && this.moveStart) {
      const selectedRegion = useStore.getState().selection.selectedRegion;
      if (selectedRegion) {
        const dx = point.x - this.moveStart.x;
        const dy = point.y - this.moveStart.y;
        const translated = selectedRegion.map((poly) =>
          poly.map(([px, py]): [number, number] => [px + dx, py + dy]),
        );
        this.overlay.drawSelection(translated);
      }
    }
  }

  onPointerUp(point: Point): void {
    if (this.state === 'SELECTING' && this.startPoint) {
      this.finishSelection(this.startPoint, point);
    } else if (this.state === 'MOVING' && this.moveStart) {
      this.finishMove(this.moveStart, point);
    }
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.cancel();
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      this.deleteSelection();
    }
  }

  getPreview(): PreviewShape | null {
    if (this.state === 'SELECTING' && this.startPoint && this.currentPoint) {
      const s = this.startPoint;
      const e = this.currentPoint;
      return {
        type: 'polygon',
        points: [
          { x: s.x, y: s.y },
          { x: e.x, y: s.y },
          { x: e.x, y: e.y },
          { x: s.x, y: e.y },
        ],
      };
    }
    return null;
  }

  cancel(): void {
    this.state = 'IDLE';
    this.startPoint = null;
    this.currentPoint = null;
    this.moveStart = null;
    useStore.getState().setSelectedRegion(null);
    this.overlay.clear();
  }

  isActive(): boolean {
    return this.state !== 'IDLE';
  }

  private deleteSelection(): void {
    const store = useStore.getState();
    const region = store.selection.selectedRegion;
    if (!region) return;
    const activeLayerId = store.ui.activeLayerId;
    const activeLayer = store.layers.find(
      (l): l is DungeonLayer => l.id === activeLayerId && l.type === 'dungeon',
    );
    if (!activeLayer) return;

    const prevFloor = activeLayer.mergedFloor;
    undoManager.execute(new CutCommand(activeLayerId, prevFloor, region));
    store.setSelectedRegion(null);
    this.overlay.clear();
    this.state = 'IDLE';
  }

  private finishSelection(start: Point, end: Point): void {
    this.startPoint = null;
    this.currentPoint = null;

    const dx = Math.abs(end.x - start.x);
    const dy = Math.abs(end.y - start.y);
    if (dx < 0.01 && dy < 0.01) {
      this.state = 'IDLE';
      return;
    }

    const store = useStore.getState();
    const activeLayerId = store.ui.activeLayerId;
    const activeLayer = store.layers.find(
      (l): l is DungeonLayer => l.id === activeLayerId && l.type === 'dungeon',
    );
    if (!activeLayer?.mergedFloor) {
      this.state = 'IDLE';
      return;
    }

    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    const minY = Math.min(start.y, end.y);
    const maxY = Math.max(start.y, end.y);
    const selRect: [number, number][] = [
      [minX, minY],
      [maxX, minY],
      [maxX, maxY],
      [minX, maxY],
    ];

    const selectedRegion = clipper2Engine.intersection(
      activeLayer.mergedFloor,
      [selRect],
    ) as [number, number][][];

    if (selectedRegion.length === 0) {
      this.state = 'IDLE';
      return;
    }

    store.setSelectedRegion(selectedRegion);
    this.overlay.drawSelection(selectedRegion);
    this.state = 'SELECTED';
  }

  private finishMove(start: Point, end: Point): void {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    this.moveStart = null;
    this.currentPoint = null;

    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
      this.state = 'SELECTED';
      return;
    }

    const store = useStore.getState();
    const selectedRegion = store.selection.selectedRegion;
    if (!selectedRegion) {
      this.state = 'IDLE';
      return;
    }

    const activeLayerId = store.ui.activeLayerId;
    const activeLayer = store.layers.find(
      (l): l is DungeonLayer => l.id === activeLayerId && l.type === 'dungeon',
    );
    if (!activeLayer) {
      this.state = 'IDLE';
      return;
    }

    const translated = selectedRegion.map((poly) =>
      poly.map(([px, py]): [number, number] => [px + dx, py + dy]),
    );

    const prevFloor = activeLayer.mergedFloor ?? [];
    const withoutSelected = clipper2Engine.difference(prevFloor, selectedRegion) as [number, number][][];
    const newFloor = clipper2Engine.union(withoutSelected, translated) as [number, number][][];

    undoManager.execute(
      new SelectionMoveCommand(activeLayerId, activeLayer.mergedFloor, newFloor),
    );

    store.setSelectedRegion(translated);
    this.overlay.drawSelection(translated);
    this.state = 'SELECTED';
  }
}
