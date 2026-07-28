import type { Point, Polygon } from '../../types/geometry';
import type { DrawingTool, PreviewShape } from './DrawingTool';
import type { DoorChild, DungeonLayer } from '../../store/types';
import type { DoorState, WallSegment } from '../../shared/types';
import { snapToNearestWall, type WallSnapResult } from '../../shared/wallSnap';
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

function doorsOf(layer: DungeonLayer): DoorChild[] {
  return layer.children.filter((c): c is DoorChild => c.childType === 'door');
}

/** Nearest door within its own half-width of the point, or null. */
function doorAt(point: Point, layer: DungeonLayer): DoorChild | null {
  let best: DoorChild | null = null;
  let bestDist = Infinity;
  for (const door of doorsOf(layer)) {
    const dist = Math.hypot(door.position[0] - point.x, door.position[1] - point.y);
    if (dist <= Math.max(door.width / 2, MIN_HIT_RADIUS) && dist < bestDist) {
      bestDist = dist;
      best = door;
    }
  }
  return best;
}

/** Extract synthetic WallSegments from mergedFloor polygon edges. */
function wallSegmentsFromFloor(mergedFloor: Polygon[]): WallSegment[] {
  const segments: WallSegment[] = [];
  for (let pi = 0; pi < mergedFloor.length; pi++) {
    const poly = mergedFloor[pi];
    if (poly.length < 2) continue;
    for (let ei = 0; ei < poly.length; ei++) {
      const start = poly[ei];
      const end = poly[(ei + 1) % poly.length];
      segments.push({
        id: `floor-${pi}-${ei}`,
        points: [start, end],
        wallType: 'normal',
        direction: 'both',
        color: '#000000',
        width: 1,
        roughness: 0,
      });
    }
  }
  return segments;
}

export class DoorTool implements DrawingTool {
  readonly type = 'door' as const;
  readonly cursor = 'crosshair';
  snapResult: WallSnapResult | null = null;
  /** Door under the cursor — what Delete removes and what a click cycles. */
  hoveredDoorId: string | null = null;

  onPointerDown(point: Point): void {
    const store = useStore.getState();
    const activeLayerId = store.ui.activeLayerId;
    const activeLayer = store.layers.find(
      (l): l is DungeonLayer => l.id === activeLayerId && l.type === 'dungeon',
    );
    if (!activeLayer) return;

    // Clicking a placed door cycles it instead of stacking another one on top.
    const hit = doorAt(point, activeLayer);
    if (hit) {
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

    if (!this.snapResult) return;

    const toolSettings = store.tools.settings;

    // Check for door overlap on this wall
    const existingDoors = activeLayer.children.filter(
      (c) => c.childType === 'door' && (c as DoorChild).wallId === this.snapResult!.wallId,
    ) as DoorChild[];

    const doorWidth = toolSettings.doorWidth || 1;
    const floorWalls = activeLayer.mergedFloor
      ? wallSegmentsFromFloor(activeLayer.mergedFloor)
      : [];
    const allWalls = [...activeLayer.standaloneWalls, ...floorWalls];
    const wall = allWalls.find((w) => w.id === this.snapResult!.wallId);
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

    // Bind to the rooms either side of the wall now, so lighting/fog see the
    // topology immediately instead of waiting for the next room re-detection.
    Object.assign(door, bindDoorToRooms(door, allWalls, activeLayer.rooms ?? []));

    undoManager.execute(new AddChildCommand('Place door', activeLayerId, door));
  }

  onPointerMove(point: Point): void {
    const store = useStore.getState();
    const activeLayerId = store.ui.activeLayerId;
    const activeLayer = store.layers.find(
      (l): l is DungeonLayer => l.id === activeLayerId && l.type === 'dungeon',
    );
    if (!activeLayer) return;

    this.hoveredDoorId = doorAt(point, activeLayer)?.id ?? null;

    // H7: Use a fixed world-unit threshold that gives ~1.5 grid cells of snap range.
    // World coords use 1 unit = 1 grid cell, so 1.5 is always correct regardless of zoom.
    // (The old value of 2 was fine but 1.5 is more precise and avoids snapping across gaps.)
    const snapThreshold = 1.5;

    // M9: Overlap detection uses Euclidean center distance which is a simplification.
    // For most cases this is accurate enough since doors are placed along a single wall.
    // A full parametric interval check would be needed for exact edge-case accuracy.
    const floorWalls = activeLayer.mergedFloor
      ? wallSegmentsFromFloor(activeLayer.mergedFloor)
      : [];
    const allWalls = [...activeLayer.standaloneWalls, ...floorWalls];

    this.snapResult = snapToNearestWall(
      [point.x, point.y],
      allWalls,
      snapThreshold,
    );
  }

  onPointerUp(_point: Point): void {
    // Single-click tool — no drag behavior
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.cancel();
      return;
    }
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    // Delete removes the door under the cursor — the door tool has no
    // selection of its own, so hover is the target (matching ObjectTool).
    const store = useStore.getState();
    if (!this.hoveredDoorId) return;
    undoManager.execute(
      new RemoveChildCommand('Delete door', store.ui.activeLayerId, this.hoveredDoorId),
    );
    this.hoveredDoorId = null;
  }

  getPreview(): PreviewShape | null {
    // Ghost only while hovering empty wall — over a placed door the click
    // cycles it rather than placing, so a placement ghost would be a lie.
    if (this.hoveredDoorId) return null;
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
    this.hoveredDoorId = null;
  }

  isActive(): boolean {
    return false; // single-click tool
  }
}
