import { Container, Graphics } from 'pixi.js';
import type { Point } from '../../types/geometry';
import type { DrawingTool, PreviewShape } from './DrawingTool';
import type { DungeonLayer, ZoneChild } from '../../store/types';
import type { ZoneShape } from '../../shared/types';
import { AddChildCommand, RemoveChildCommand, UpdateChildCommand } from '../../store/commands';
import { undoManager } from '../../store/undoManager';
import { useStore } from '../../store/store';
import { notify } from '../../shared/notify';
import { getChildBounds } from '../hitTest';
import { blockedLayerReason, noEditableLayerMessage, resolveEditableLayer } from './layerGuard';

/** Circle placement never collapses to a dot — a click with no drag still reads as a zone. */
const MIN_CIRCLE_RADIUS = 0.5;

/** Same slack RectangleTool uses before it throws away a drag as accidental. */
const MIN_RECT_SIZE = 0.01;

/** How far the pointer must travel before a press on an existing zone counts as a move. */
const DRAG_SLOP = 0.15;

/** Ghost is always the "not committed yet" muted tone — accent is reserved for a selected zone (see zoneOverlay.ts). */
const MUTED_COLOR = 0x94a3b8;
const GHOST_ALPHA = 0.6;

function countZones(layer: DungeonLayer): number {
  return layer.children.filter((c) => c.childType === 'zone').length;
}

function activeDungeonLayer(): DungeonLayer | undefined {
  const store = useStore.getState();
  return store.layers.find(
    (l): l is DungeonLayer => l.id === store.ui.activeLayerId && l.type === 'dungeon',
  );
}

/**
 * Topmost zone whose bounds contain `point`, or null.
 *
 * The bounding box, not the exact shape — a circle or rect zone is small,
 * DM-only prep geometry, not something worth a precise point-in-shape test.
 */
function zoneAt(point: Point, layer: DungeonLayer): ZoneChild | null {
  const zones = layer.children.filter((c): c is ZoneChild => c.childType === 'zone' && c.visible);
  for (let i = zones.length - 1; i >= 0; i--) {
    const b = getChildBounds(zones[i]);
    if (point.x >= b.x && point.x <= b.x + b.width && point.y >= b.y && point.y <= b.y + b.height) {
      return zones[i];
    }
  }
  return null;
}

/** Translate a zone's shape by a world-space delta — how a drag-move is applied. */
function translateShape(shape: ZoneShape, dx: number, dy: number): ZoneShape {
  switch (shape.kind) {
    case 'point':
      return { kind: 'point', position: { x: shape.position.x + dx, y: shape.position.y + dy } };
    case 'circle':
      return {
        kind: 'circle',
        position: { x: shape.position.x + dx, y: shape.position.y + dy },
        radius: shape.radius,
      };
    case 'rect':
      return { kind: 'rect', x: shape.x + dx, y: shape.y + dy, width: shape.width, height: shape.height };
  }
}

/** Draws the shape a ghost/marker resolves to — shared between the placement ghost and drag preview. */
function drawZoneShape(g: Graphics, shape: ZoneShape, color: number): void {
  switch (shape.kind) {
    case 'point': {
      const { x, y } = shape.position;
      const r = 0.15;
      g.moveTo(x - r * 1.6, y).lineTo(x + r * 1.6, y);
      g.moveTo(x, y - r * 1.6).lineTo(x, y + r * 1.6);
      g.stroke({ color, width: 0.05, alpha: 0.9 });
      g.circle(x, y, r).fill({ color, alpha: 0.35 });
      break;
    }
    case 'circle':
      g.circle(shape.position.x, shape.position.y, shape.radius).fill({ color, alpha: 0.1 });
      g.circle(shape.position.x, shape.position.y, shape.radius).stroke({ color, width: 0.05, alpha: 0.85 });
      break;
    case 'rect':
      g.rect(shape.x, shape.y, shape.width, shape.height).fill({ color, alpha: 0.1 });
      g.rect(shape.x, shape.y, shape.width, shape.height).stroke({ color, width: 0.05, alpha: 0.85 });
      break;
  }
}

/**
 * Places, selects, drags and deletes zone markers (DM prep anchors — scene
 * triggers, room-info pins). Zones never affect rooms, fog or hit-testing
 * for other tools; `hitTestChildren` has no 'zone' case on purpose, so
 * Select can never grab one. The persistent zone markers themselves are an
 * editor-only overlay drawn canvas-side (see canvas/src/canvas/zoneOverlay.ts)
 * — this tool only owns placement, selection and the in-progress ghost.
 */
export class ZoneTool implements DrawingTool {
  readonly type = 'zone' as const;
  readonly cursor = 'crosshair';
  // No editsActiveLayer, same reason as DoorTool: selecting a zone has to keep
  // working on a locked layer so the properties panel can inspect it; this
  // tool enforces the placement/drag/delete guard itself instead.

  /** Zone under the cursor, for the hover cursor only. */
  hoveredZoneId: string | null = null;

  /** Circle/rect placement drag in progress. */
  private dragStart: Point | null = null;
  private dragCurrent: Point | null = null;
  private dragging = false;
  /** Layer the placement drag started on — see RectangleTool for why. */
  private startLayerId: string | null = null;

  /** Existing zone under a held pointer, and where the press started. */
  private pressedZoneId: string | null = null;
  private pressPoint: Point | null = null;
  /** Set once the press crosses DRAG_SLOP; the shape to restore on Escape/undo. */
  private dragFrom: ZoneShape | null = null;

  /** Ghost shown while placing — owned here, parented to the shared preview layer. */
  private ghost: Graphics;
  private ghostKey: string | null = null;

  constructor(previewContainer: Container) {
    this.ghost = new Graphics();
    this.ghost.label = 'zoneGhost';
    this.ghost.alpha = GHOST_ALPHA;
    previewContainer.addChild(this.ghost);
  }

  private mode(): 'point' | 'circle' | 'rect' {
    return useStore.getState().tools.settings.zone.mode;
  }

  onPointerDown(point: Point): void {
    const store = useStore.getState();
    const activeLayer = activeDungeonLayer();
    if (!activeLayer) {
      notify.warning(noEditableLayerMessage());
      return;
    }
    const reason = blockedLayerReason(activeLayer);
    if (reason === 'Layer is hidden') {
      notify.warning(reason);
      return;
    }
    const locked = reason === 'Layer is locked';

    const hit = zoneAt(point, activeLayer);
    if (hit) {
      // Selecting works even on a locked layer (DoorTool DR10) — inspecting a
      // zone in the properties panel is not editing it. onPointerMove is what
      // turns a locked-layer press into a refused drag.
      store.setSelectedIds([hit.id]);
      this.pressedZoneId = hit.id;
      this.pressPoint = point;
      return;
    }

    if (locked) {
      notify.warning('Layer is locked');
      return;
    }

    store.setSelectedIds([]);
    const activeLayerId = store.ui.activeLayerId;

    if (this.mode() === 'point') {
      this.clearGhost();
      this.commit(activeLayer, activeLayerId, { kind: 'point', position: { x: point.x, y: point.y } });
      return;
    }

    this.dragStart = point;
    this.dragCurrent = point;
    this.dragging = true;
    this.startLayerId = activeLayerId;
  }

  onPointerMove(point: Point): void {
    const activeLayer = activeDungeonLayer();
    if (!activeLayer) return;

    if (this.pressedZoneId && this.pressPoint) {
      const moved = Math.hypot(point.x - this.pressPoint.x, point.y - this.pressPoint.y);
      if (this.dragFrom || moved > DRAG_SLOP) {
        if (activeLayer.locked) {
          notify.warning('Layer is locked');
          this.pressedZoneId = null;
          this.pressPoint = null;
          return;
        }
        this.dragTo(point, activeLayer);
        return;
      }
    }

    if (this.dragging) {
      this.dragCurrent = point;
      this.updateDragGhost();
      return;
    }

    this.hoveredZoneId = zoneAt(point, activeLayer)?.id ?? null;
    this.updateHoverGhost(point);
  }

  /** Live-drags the pressed zone to the pointer; onPointerUp replays it as one undo entry. */
  private dragTo(point: Point, layer: DungeonLayer): void {
    const zone = layer.children.find(
      (c): c is ZoneChild => c.id === this.pressedZoneId && c.childType === 'zone',
    );
    if (!zone || !this.pressPoint) return;

    this.dragFrom ??= zone.shape;
    const dx = point.x - this.pressPoint.x;
    const dy = point.y - this.pressPoint.y;
    const shape = translateShape(this.dragFrom, dx, dy);
    useStore.getState().updateChild(layer.id, zone.id, { shape });
  }

  onPointerUp(point: Point): void {
    if (this.pressedZoneId) {
      const from = this.dragFrom;
      const zoneId = this.pressedZoneId;
      this.pressedZoneId = null;
      this.pressPoint = null;
      this.dragFrom = null;
      if (!from) return; // plain click — selection already applied, nothing to commit

      const layer = activeDungeonLayer();
      const moved = layer?.children.find((c): c is ZoneChild => c.id === zoneId && c.childType === 'zone');
      if (!layer || !moved) return;
      const to = moved.shape;
      useStore.getState().updateChild(layer.id, zoneId, { shape: from });
      undoManager.execute(new UpdateChildCommand('Move zone', layer.id, zoneId, { shape: from }, { shape: to }));
      return;
    }

    if (!this.dragging) return;
    this.dragging = false;
    this.clearGhost();
    const start = this.dragStart;
    const end = point;
    this.dragStart = null;
    this.dragCurrent = null;
    const layerId = this.startLayerId;
    this.startLayerId = null;
    if (!start || !layerId) return;

    const layer = resolveEditableLayer(layerId);
    if (!layer) return;

    if (this.mode() === 'circle') {
      const radius = Math.max(MIN_CIRCLE_RADIUS, Math.hypot(end.x - start.x, end.y - start.y));
      this.commit(layer, layerId, { kind: 'circle', position: { x: start.x, y: start.y }, radius });
    } else {
      const x = Math.min(start.x, end.x);
      const y = Math.min(start.y, end.y);
      const width = Math.abs(end.x - start.x);
      const height = Math.abs(end.y - start.y);
      if (width < MIN_RECT_SIZE || height < MIN_RECT_SIZE) return;
      this.commit(layer, layerId, { kind: 'rect', x, y, width, height });
    }
  }

  private commit(layer: DungeonLayer, layerId: string, shape: ZoneShape): void {
    const zone: ZoneChild = {
      id: crypto.randomUUID(),
      name: `Zone ${countZones(layer) + 1}`,
      childType: 'zone',
      visible: true,
      shape,
    };
    undoManager.execute(new AddChildCommand('Place zone', layerId, zone));
    useStore.getState().setSelectedIds([zone.id]);
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.cancel();
      return;
    }
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    const store = useStore.getState();
    const layer = activeDungeonLayer();
    if (!layer) return;
    const selected = store.selection.selectedIds.find((id) =>
      layer.children.some((c) => c.id === id && c.childType === 'zone'),
    );
    if (!selected) return;
    const reason = blockedLayerReason(layer);
    if (reason) {
      notify.warning(reason);
      return;
    }
    undoManager.execute(new RemoveChildCommand('Delete zone', layer.id, selected));
    store.setSelectedIds([]);
  }

  private updateHoverGhost(point: Point): void {
    if (this.hoveredZoneId || this.mode() !== 'point') {
      this.clearGhost();
      return;
    }
    const key = `point:${Math.round(point.x / 0.25)}:${Math.round(point.y / 0.25)}`;
    if (key === this.ghostKey) return;
    this.clearGhost();
    this.ghostKey = key;
    drawZoneShape(this.ghost, { kind: 'point', position: point }, MUTED_COLOR);
  }

  private updateDragGhost(): void {
    if (!this.dragStart || !this.dragCurrent) return;
    this.clearGhost();
    this.ghostKey = 'drag';
    const shape: ZoneShape =
      this.mode() === 'circle'
        ? {
            kind: 'circle',
            position: { x: this.dragStart.x, y: this.dragStart.y },
            radius: Math.max(
              MIN_CIRCLE_RADIUS,
              Math.hypot(this.dragCurrent.x - this.dragStart.x, this.dragCurrent.y - this.dragStart.y),
            ),
          }
        : {
            kind: 'rect',
            x: Math.min(this.dragStart.x, this.dragCurrent.x),
            y: Math.min(this.dragStart.y, this.dragCurrent.y),
            width: Math.abs(this.dragCurrent.x - this.dragStart.x),
            height: Math.abs(this.dragCurrent.y - this.dragStart.y),
          };
    drawZoneShape(this.ghost, shape, MUTED_COLOR);
  }

  private clearGhost(): void {
    if (this.ghostKey === null) return;
    this.ghost.clear();
    this.ghostKey = null;
  }

  getPreview(): PreviewShape | null {
    // The ghost draws the zone itself — a second generic preview under it
    // would only be a worse one (see DoorTool).
    return null;
  }

  getHoverCursor(): string | null {
    return this.dragFrom ? 'grabbing' : this.hoveredZoneId ? 'move' : null;
  }

  cancel(): void {
    const layer = this.dragFrom ? activeDungeonLayer() : undefined;
    if (layer && this.dragFrom && this.pressedZoneId) {
      useStore.getState().updateChild(layer.id, this.pressedZoneId, { shape: this.dragFrom });
    }
    this.dragFrom = null;
    this.pressedZoneId = null;
    this.pressPoint = null;
    this.dragging = false;
    this.dragStart = null;
    this.dragCurrent = null;
    this.startLayerId = null;
    this.hoveredZoneId = null;
    this.clearGhost();
  }

  isActive(): boolean {
    return this.dragFrom !== null || this.dragging;
  }
}
