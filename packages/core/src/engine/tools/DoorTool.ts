import type { Point } from '../../types/geometry';
import { isDoubleClick, type DrawingTool, type PreviewShape } from './DrawingTool';
import type { DoorChild, DungeonLayer } from '../../store/types';
import type { DoorState } from '../../shared/types';
import { snapToNearestWall, type WallSnapResult } from '../../shared/wallSnap';
import {
  FLOOR_ANCHORED,
  projectDoorOnto,
  resolveDoors,
  resolveWalls,
} from '../../shared/wallResolve';
import { bindDoorToRooms } from '../../shared/roomBinding';
import { AddChildCommand, RemoveChildCommand, UpdateChildCommand } from '../../store/commands';
import { undoManager } from '../../store/undoManager';
import { useStore } from '../../store/store';

/** Click-to-cycle order. Archways can't lock, so they skip straight back. */
const NEXT_STATE: Record<DoorState, DoorState> = {
  closed: 'open',
  open: 'locked',
  locked: 'closed',
};

/**
 * L8 — an archway is a permanent opening: `occlusion` always treats it as open and
 * `doorRenderer` draws no state dot for one, so `locked` is a state nothing downstream
 * can express. Cycling one therefore toggles closed ↔ open rather than parking it in a
 * state the rest of the engine ignores.
 */
function nextState(door: DoorChild): DoorState {
  const next = NEXT_STATE[door.state] ?? 'closed';
  return door.style === 'archway' && next === 'locked' ? 'closed' : next;
}

/** Minimum click radius, so hairline doors are still clickable. */
const MIN_HIT_RADIUS = 0.4;

/**
 * H7: a fixed world-unit threshold giving ~1.5 grid cells of snap range. World
 * coords are 1 unit = 1 grid cell, so it holds at any zoom. Placement snapping
 * and drag re-anchoring share it — a door lands where it would be dragged to.
 */
const SNAP_THRESHOLD = 1.5;

/**
 * How far the pointer must travel before a press counts as a drag rather than a
 * click. Well inside `DOUBLE_CLICK_SLOP` so a slightly wobbly double-click still
 * cycles instead of committing a one-pixel move.
 * ponytail: no shared drag-slop constant exists yet; hoist if a second tool needs one.
 */
const DRAG_SLOP = 0.15;

/**
 * Nearest door within its own half-width of the point, or null.
 *
 * Hit-tests the *resolved* position, not the authored one: a floor door or a
 * door on a node-edited wall draws where it resolves, so that is where it has to
 * be clickable. Detached doors resolve to their authored position, which is
 * where their broken-bar marker draws — they stay pickable too.
 */
function doorAt(point: Point, layer: DungeonLayer): DoorChild | null {
  let best: DoorChild | null = null;
  let bestDist = Infinity;
  for (const r of resolveDoors(layer, resolveWalls(layer))) {
    const dist = Math.hypot(r.position[0] - point.x, r.position[1] - point.y);
    if (dist <= Math.max(r.door.width / 2, MIN_HIT_RADIUS) && dist < bestDist) {
      bestDist = dist;
      best = r.door;
    }
  }
  return best;
}

/** The fields a drag rewrites — snapshotted for undo and for Escape. */
type DoorAnchor = Pick<DoorChild, 'wallId' | 'position' | 'angle' | 'roomA' | 'roomB'>;

function anchorOf(door: DoorChild): DoorAnchor {
  return {
    wallId: door.wallId,
    position: [...door.position],
    angle: door.angle,
    roomA: door.roomA,
    roomB: door.roomB,
  };
}

function activeDungeonLayer(): DungeonLayer | undefined {
  const store = useStore.getState();
  return store.layers.find(
    (l): l is DungeonLayer => l.id === store.ui.activeLayerId && l.type === 'dungeon',
  );
}

export class DoorTool implements DrawingTool {
  readonly type = 'door' as const;
  readonly cursor = 'crosshair';
  snapResult: WallSnapResult | null = null;
  /** Door under the cursor — the Delete target when nothing is selected. */
  hoveredDoorId: string | null = null;

  private lastClick: { point: Point; time: number } | null = null;
  /** Door under a held pointer, and where the press started. */
  private pressedDoorId: string | null = null;
  private pressPoint: Point | null = null;
  /** Set once the press passes `DRAG_SLOP`; holds what to put back on Escape/undo. */
  private dragFrom: DoorAnchor | null = null;

  onPointerDown(point: Point): void {
    const store = useStore.getState();
    const activeLayerId = store.ui.activeLayerId;
    const activeLayer = activeDungeonLayer();
    if (!activeLayer) return;

    const hit = doorAt(point, activeLayer);
    if (hit) {
      // Second click of a double cycles the state; the first already selected the
      // door, and selection is idempotent, so nothing fires twice.
      if (isDoubleClick(this.lastClick, point, Date.now())) {
        this.lastClick = null;
        this.pressedDoorId = null;
        this.pressPoint = null;
        undoManager.execute(
          new UpdateChildCommand(
            'Cycle door',
            activeLayerId,
            hit.id,
            { state: hit.state },
            { state: nextState(hit) },
          ),
        );
        return;
      }
      // Single click selects — the properties panel keys off the selection, so a
      // door can now be inspected without being mutated (DR10).
      store.setSelectedIds([hit.id]);
      this.lastClick = { point, time: Date.now() };
      this.pressedDoorId = hit.id;
      this.pressPoint = point;
      return;
    }

    store.setSelectedIds([]);
    if (!this.snapResult) return;

    const toolSettings = store.tools.settings;

    const doorWidth = toolSettings.doorWidth || 1;
    const allWalls = resolveWalls(activeLayer);
    const wall = allWalls.find((w) => w.id === this.snapResult!.wallId);
    if (!wall) return;

    // Validate: check overlap against the doors that currently resolve onto this
    // wall — a floor door stores no wall id, so its anchor is only known once
    // resolved.
    const existingDoors = resolveDoors(activeLayer, allWalls).filter(
      (r) => r.wall?.id === wall.id,
    );
    for (const existing of existingDoors) {
      const dist = Math.sqrt(
        (existing.position[0] - this.snapResult.position[0]) ** 2 +
        (existing.position[1] - this.snapResult.position[1]) ** 2,
      );
      if (dist < (existing.door.width + doorWidth) / 2) {
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
      // Floor-ring ids are derived per resolve, so storing one would rot on the
      // next union. Position + projection is the whole anchor for those.
      wallId: wall.kind === 'floor' ? FLOOR_ANCHORED : wall.id,
      position: this.snapResult.position,
      angle: this.snapResult.angle,
      width: doorWidth,
      style: toolSettings.doorStyle ?? 'single',
      state: 'closed',
      isSecret: toolSettings.doorSecret ?? false,
    };

    // Bind to the rooms either side of the wall now, so lighting/fog see the
    // topology immediately instead of waiting for the next room re-detection.
    Object.assign(door, bindDoorToRooms(door, allWalls, activeLayer.rooms ?? []));

    undoManager.execute(new AddChildCommand('Place door', activeLayerId, door));
    // Width is a panel field, not a canvas handle (DD6), so a fresh door has to
    // arrive selected or there is no way to size it without hunting the layer list.
    store.setSelectedIds([door.id]);
  }

  onPointerMove(point: Point): void {
    const activeLayer = activeDungeonLayer();
    if (!activeLayer) return;

    if (this.pressedDoorId && this.pressPoint) {
      const moved = Math.hypot(point.x - this.pressPoint.x, point.y - this.pressPoint.y);
      if (this.dragFrom || moved > DRAG_SLOP) {
        this.slideTo(point, activeLayer);
        return;
      }
    }

    this.hoveredDoorId = doorAt(point, activeLayer)?.id ?? null;

    // M9: Overlap detection uses Euclidean center distance which is a simplification.
    // For most cases this is accurate enough since doors are placed along a single wall.
    // A full parametric interval check would be needed for exact edge-case accuracy.
    this.snapResult = snapToNearestWall(
      [point.x, point.y],
      resolveWalls(activeLayer),
      SNAP_THRESHOLD,
    );
  }

  /**
   * Live-slides the pressed door to the pointer. Writes straight to the store so
   * the door tracks the cursor; `onPointerUp` rewinds and replays through the
   * command, which is how one gesture becomes one undo entry (as SelectTool does).
   */
  private slideTo(point: Point, layer: DungeonLayer): void {
    const door = layer.children.find(
      (c): c is DoorChild => c.id === this.pressedDoorId && c.childType === 'door',
    );
    if (!door) return;

    const walls = resolveWalls(layer);
    // The nearest wall within snap range wins, so dragging past a corner
    // re-anchors to the wall the pointer has crossed to. Out of range nothing
    // moves — a door cannot be dragged off the walls.
    const snap = snapToNearestWall([point.x, point.y], walls, SNAP_THRESHOLD);
    const wall = snap && walls.find((w) => w.id === snap.wallId);
    if (!wall) return;

    this.dragFrom ??= anchorOf(door);
    // Projection + end clamp come from the resolver, so the committed position is
    // exactly the one the next render resolves to.
    const placed = projectDoorOnto(door, wall, [point.x, point.y]);
    const next: DoorAnchor = {
      wallId: wall.kind === 'floor' ? FLOOR_ANCHORED : wall.id,
      position: placed.position,
      angle: placed.angle,
      ...bindDoorToRooms(
        { ...door, position: placed.position, angle: placed.angle, wallId: wall.id },
        walls,
        layer.rooms ?? [],
      ),
    };
    useStore.getState().updateChild(layer.id, door.id, next);
  }

  onPointerUp(_point: Point): void {
    const from = this.dragFrom;
    const doorId = this.pressedDoorId;
    this.pressedDoorId = null;
    this.pressPoint = null;
    this.dragFrom = null;
    if (!from || !doorId) return;

    const layer = activeDungeonLayer();
    const moved = layer?.children.find(
      (c): c is DoorChild => c.id === doorId && c.childType === 'door',
    );
    if (!layer || !moved) return;

    const to = anchorOf(moved);
    // Rewind the live preview, then replay it as a command so undo has a clean
    // before/after and the whole slide costs exactly one press of undo.
    useStore.getState().updateChild(layer.id, doorId, from);
    undoManager.execute(new UpdateChildCommand('Move door', layer.id, doorId, from, to));
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
    // Delete removes the selection; hover stays the target when nothing is
    // selected, which is how the tool worked before it could select.
    const selected = store.selection.selectedIds.find((id) =>
      layer.children.some((c) => c.id === id && c.childType === 'door'),
    );
    const target = selected ?? this.hoveredDoorId;
    if (!target) return;
    undoManager.execute(new RemoveChildCommand('Delete door', layer.id, target));
    if (selected) store.setSelectedIds([]);
    this.hoveredDoorId = null;
  }

  getPreview(): PreviewShape | null {
    // Ghost only while hovering empty wall — over a placed door the click
    // selects it rather than placing, so a placement ghost would be a lie, and
    // during a slide the door itself is already tracking the cursor.
    if (this.hoveredDoorId || this.dragFrom) return null;
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

  /** A placed door is draggable, so say so before the user finds out by accident. */
  getHoverCursor(): string | null {
    return this.dragFrom ? 'grabbing' : this.hoveredDoorId ? 'move' : null;
  }

  cancel(): void {
    // Escape mid-slide puts the door back where it was picked up; the tool exit
    // that Escape also means then has nothing half-applied behind it.
    const layer = this.dragFrom ? activeDungeonLayer() : undefined;
    if (layer && this.dragFrom && this.pressedDoorId) {
      useStore.getState().updateChild(layer.id, this.pressedDoorId, this.dragFrom);
    }
    this.dragFrom = null;
    this.pressedDoorId = null;
    this.pressPoint = null;
    this.lastClick = null;
    this.snapResult = null;
    this.hoveredDoorId = null;
  }

  isActive(): boolean {
    return this.dragFrom !== null;
  }
}
