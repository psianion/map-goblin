import { Container, Graphics } from 'pixi.js';
import type { Point } from '../../types/geometry';
import type { DrawingTool, PreviewShape } from './DrawingTool';
import type { ConnectorChild, DungeonLayer } from '../../store/types';
import { AddChildCommand, RemoveChildCommand, UpdateChildCommand } from '../../store/commands';
import { undoManager } from '../../store/undoManager';
import { useStore } from '../../store/store';
import { notify } from '../../shared/notify';
import { getChildBounds } from '../hitTest';
import { blockedLayerReason, noEditableLayerMessage, resolveEditableLayer } from './layerGuard';
import { isLayerEffectivelyVisible } from '../../store/selectors';

/** Blob thickness across the seam, world units — a connector is a joint, not a room. */
const BLOB_WIDTH = 1;

/** A click with no drag still reads as a connector, at this length. */
const MIN_LENGTH = 0.8;

/** Ellipse resolution. Enough to read as a blob, few enough to stay cheap in the overlay. */
const SEGMENTS = 16;

/** How far the pointer must travel before a press on an existing connector counts as a move. */
const DRAG_SLOP = 0.15;

/** Ghost is the "not committed yet" muted tone — see ZoneTool. */
const MUTED_COLOR = 0x94a3b8;
const GHOST_ALPHA = 0.6;

function countConnectors(layer: DungeonLayer): number {
  return layer.children.filter((c) => c.childType === 'connector').length;
}

function activeDungeonLayer(): DungeonLayer | undefined {
  const store = useStore.getState();
  return store.layers.find(
    (l): l is DungeonLayer => l.id === store.ui.activeLayerId && l.type === 'dungeon',
  );
}

/**
 * The blob a drag from `start` to `end` describes: an ellipse whose long axis is
 * the drag. The drag direction is the axis the connector crosses the seam on,
 * which is also the principal axis a door glyph anchors to downstream (C3).
 */
export function connectorBlob(start: Point, end: Point): [number, number][] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dragged = Math.hypot(dx, dy);
  const angle = dragged === 0 ? 0 : Math.atan2(dy, dx);
  const a = Math.max(MIN_LENGTH, dragged) / 2;
  const b = BLOB_WIDTH / 2;
  const cx = (start.x + end.x) / 2;
  const cy = (start.y + end.y) / 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const ring: [number, number][] = [];
  for (let i = 0; i < SEGMENTS; i++) {
    const t = (i / SEGMENTS) * Math.PI * 2;
    const ex = Math.cos(t) * a;
    const ey = Math.sin(t) * b;
    ring.push([cx + ex * cos - ey * sin, cy + ex * sin + ey * cos]);
  }
  return ring;
}

function translateContours(contours: [number, number][][], dx: number, dy: number): [number, number][][] {
  return contours.map((ring) => ring.map(([x, y]): [number, number] => [x + dx, y + dy]));
}

/** Topmost connector whose bounds contain `point` — bounds only, same call ZoneTool makes. */
function connectorAt(point: Point, layer: DungeonLayer): ConnectorChild | null {
  const items = layer.children.filter(
    (c): c is ConnectorChild => c.childType === 'connector' && c.visible,
  );
  for (let i = items.length - 1; i >= 0; i--) {
    const b = getChildBounds(items[i]);
    if (point.x >= b.x && point.x <= b.x + b.width && point.y >= b.y && point.y <= b.y + b.height) {
      return items[i];
    }
  }
  return null;
}

/**
 * Places, selects, drags and deletes connectors — the arch or door joint
 * straddling two authored room boundaries.
 *
 * Built on ZoneTool's shape rather than the generic tool stack on purpose:
 * a connector is small prep geometry with a bounds-sized hit target, and
 * `hitTestChildren` has no 'connector' case (same deliberate omission zones
 * have), so this tool owns every interaction with one.
 */
export class ConnectorTool implements DrawingTool {
  readonly type = 'connector' as const;
  readonly cursor = 'crosshair';

  /** Connector under the cursor, for the hover cursor only. */
  hoveredConnectorId: string | null = null;

  private dragStart: Point | null = null;
  private dragCurrent: Point | null = null;
  private dragging = false;
  /** Layer the placement drag started on — see RectangleTool for why. */
  private startLayerId: string | null = null;

  private pressedConnectorId: string | null = null;
  private pressPoint: Point | null = null;
  /** Set once the press crosses DRAG_SLOP; the contours to restore on Escape/undo. */
  private dragFrom: [number, number][][] | null = null;

  private ghost: Graphics;
  private ghostDrawn = false;

  constructor(previewContainer: Container) {
    this.ghost = new Graphics();
    this.ghost.label = 'connectorGhost';
    this.ghost.alpha = GHOST_ALPHA;
    previewContainer.addChild(this.ghost);
  }

  private kind(): 'arch' | 'door' {
    return useStore.getState().tools.settings.connector.kind;
  }

  onPointerDown(point: Point): void {
    const store = useStore.getState();
    const activeLayer = activeDungeonLayer();
    if (!activeLayer) {
      notify.warning(noEditableLayerMessage());
      return;
    }
    // Hidden checked before locked, same order and same reason as ZoneTool.
    if (!isLayerEffectivelyVisible(useStore.getState(), activeLayer)) {
      notify.warning('Layer is hidden');
      return;
    }

    const hit = connectorAt(point, activeLayer);
    if (hit) {
      // Selecting works on a locked layer so the properties panel can inspect it.
      store.setSelectedIds([hit.id]);
      this.pressedConnectorId = hit.id;
      this.pressPoint = point;
      return;
    }

    if (activeLayer.locked) {
      notify.warning('Layer is locked');
      return;
    }

    store.setSelectedIds([]);
    this.dragStart = point;
    this.dragCurrent = point;
    this.dragging = true;
    this.startLayerId = store.ui.activeLayerId;
  }

  onPointerMove(point: Point): void {
    const activeLayer = activeDungeonLayer();
    if (!activeLayer) return;

    if (this.pressedConnectorId && this.pressPoint) {
      const moved = Math.hypot(point.x - this.pressPoint.x, point.y - this.pressPoint.y);
      if (this.dragFrom || moved > DRAG_SLOP) {
        if (activeLayer.locked) {
          notify.warning('Layer is locked');
          this.cancel();
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

    this.hoveredConnectorId = connectorAt(point, activeLayer)?.id ?? null;
  }

  /** Live-drags the pressed connector; onPointerUp replays it as one undo entry. */
  private dragTo(point: Point, layer: DungeonLayer): void {
    const connector = layer.children.find(
      (c): c is ConnectorChild => c.id === this.pressedConnectorId && c.childType === 'connector',
    );
    if (!connector || !this.pressPoint) return;

    this.dragFrom ??= connector.contours;
    const contours = translateContours(
      this.dragFrom,
      point.x - this.pressPoint.x,
      point.y - this.pressPoint.y,
    );
    useStore.getState().updateChild(layer.id, connector.id, { contours });
  }

  onPointerUp(point: Point): void {
    if (this.pressedConnectorId) {
      const from = this.dragFrom;
      const id = this.pressedConnectorId;
      this.pressedConnectorId = null;
      this.pressPoint = null;
      this.dragFrom = null;
      if (!from) return; // plain click — selection already applied

      const layer = activeDungeonLayer();
      const moved = layer?.children.find(
        (c): c is ConnectorChild => c.id === id && c.childType === 'connector',
      );
      if (!layer || !moved) return;
      const to = moved.contours;
      useStore.getState().updateChild(layer.id, id, { contours: from });
      undoManager.execute(
        new UpdateChildCommand('Move connector', layer.id, id, { contours: from }, { contours: to }),
      );
      return;
    }

    if (!this.dragging) return;
    this.dragging = false;
    this.clearGhost();
    const start = this.dragStart;
    this.dragStart = null;
    this.dragCurrent = null;
    const layerId = this.startLayerId;
    this.startLayerId = null;
    if (!start || !layerId) return;

    const layer = resolveEditableLayer(layerId);
    if (!layer) return;

    const kind = this.kind();
    const connector: ConnectorChild = {
      id: crypto.randomUUID(),
      name: `Connector ${countConnectors(layer) + 1}`,
      childType: 'connector',
      visible: true,
      kind,
      // An arch is always open — the archway machinery forces it anyway (C1),
      // so authoring it closed would only be a lie in the layers panel.
      state: kind === 'arch' ? 'open' : 'closed',
      isSecret: false,
      contours: [connectorBlob(start, point)],
    };
    undoManager.execute(new AddChildCommand('Place connector', layerId, connector));
    useStore.getState().setSelectedIds([connector.id]);
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
      layer.children.some((c) => c.id === id && c.childType === 'connector'),
    );
    if (!selected) return;
    const reason = blockedLayerReason(layer);
    if (reason) {
      notify.warning(reason);
      return;
    }
    undoManager.execute(new RemoveChildCommand('Delete connector', layer.id, selected));
    store.setSelectedIds([]);
  }

  private updateDragGhost(): void {
    if (!this.dragStart || !this.dragCurrent) return;
    this.ghost.clear();
    this.ghostDrawn = true;
    const ring = connectorBlob(this.dragStart, this.dragCurrent);
    this.ghost.poly(ring.flat());
    this.ghost.fill({ color: MUTED_COLOR, alpha: 0.25 });
    this.ghost.poly(ring.flat());
    this.ghost.stroke({ color: MUTED_COLOR, width: 0.05, alpha: 0.85 });
  }

  private clearGhost(): void {
    if (!this.ghostDrawn) return;
    this.ghost.clear();
    this.ghostDrawn = false;
  }

  getPreview(): PreviewShape | null {
    // The ghost draws the blob itself — a generic preview under it is only worse.
    return null;
  }

  getHoverCursor(): string | null {
    return this.dragFrom ? 'grabbing' : this.hoveredConnectorId ? 'move' : null;
  }

  cancel(): void {
    const layer = this.dragFrom ? activeDungeonLayer() : undefined;
    if (layer && this.dragFrom && this.pressedConnectorId) {
      useStore.getState().updateChild(layer.id, this.pressedConnectorId, { contours: this.dragFrom });
    }
    this.dragFrom = null;
    this.pressedConnectorId = null;
    this.pressPoint = null;
    this.dragging = false;
    this.dragStart = null;
    this.dragCurrent = null;
    this.startLayerId = null;
    this.hoveredConnectorId = null;
    this.clearGhost();
  }

  isActive(): boolean {
    return this.dragFrom !== null || this.dragging;
  }
}
