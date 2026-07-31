import { Container } from 'pixi.js';
import type { Point } from '../../types/geometry';
import { isDoubleClick, type DrawingTool, type PreviewShape } from './DrawingTool';
import type { DoorChild, DungeonLayer } from '../../store/types';
import type { DoorState, DoorStyle } from '../../shared/types';
import { snapToNearestWall, type WallSnapResult } from '../../shared/wallSnap';
import {
  FLOOR_ANCHORED,
  polylineLength,
  projectDoorOnto,
  resolveDoors,
  resolveWalls,
  type ResolvedWall,
} from '../../shared/wallResolve';
import { renderResolvedDoor } from '../doorRenderer';
import { bindDoorToRooms } from '../../shared/roomBinding';
import { DOOR_MIN_HIT_RADIUS as MIN_HIT_RADIUS } from '../hitTest';
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
 * L8 — an archway is a permanent opening: `occlusion` always treats it as open and it
 * renders as the open art whatever its state, so `locked` is a state nothing downstream
 * can express. Cycling one therefore toggles closed ↔ open rather than parking it in a
 * state the rest of the engine ignores.
 */
function nextState(door: DoorChild): DoorState {
  const next = NEXT_STATE[door.state] ?? 'closed';
  return door.style === 'archway' && next === 'locked' ? 'closed' : next;
}

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
 * Slack on the width-vs-wall-length compare. A door exactly as wide as its wall
 * is the widest a door can honestly be — without this a door sized to the wall
 * it is being placed on would reject itself on float noise.
 */
const WIDTH_EPSILON = 1e-6;

/** Ghost alpha and the tint that says "this click will do nothing". */
const GHOST_ALPHA = 0.5;
const INVALID_TINT = 0xcc3344;

/**
 * World-unit step the ghost's rebuild key quantizes to. Same trick as
 * `StampScatterTool`'s `POSITION_QUANTIZE`, but keyed on the *snapped* door
 * rather than the cursor: sliding along a wall inside a quarter cell, or moving
 * perpendicular to one at all, changes nothing that is drawn.
 */
const GHOST_QUANTIZE = 0.25;

/**
 * Styles that are drawn as a two-cell opening. A double door has two leaves, a
 * portcullis a row of bars, an archway a stone jamb either side — squeeze any of
 * them into one cell and the art is a smear with no readable detail. Single-leaf
 * styles (and portals, which carry their own art) fit a cell.
 */
const WIDE_STYLES = new Set<DoorStyle>(['double', 'portcullis', 'archway']);

/**
 * The door styles a DM can place and pick, in the order both pickers show them.
 *
 * One list because there are two pickers — the tool popover and the door
 * properties panel. Written out separately, the panel kept only the first two,
 * so a placed portcullis or archway could not be recognised in the panel or
 * changed into anything else afterwards.
 *
 * `portal` is deliberately absent: it draws from a pack texture rather than a
 * glyph, so it is not one of the shapes there is any point offering in a list.
 */
export const PLACEABLE_DOOR_STYLES: readonly DoorStyle[] = [
  'single',
  'double',
  'portcullis',
  'archway',
];

/** Title-cased style — the picker label, and the stem of a new door's name. */
export function doorStyleLabel(style: DoorStyle): string {
  return style.charAt(0).toUpperCase() + style.slice(1);
}

/**
 * Narrowest a door of this style may be, in world units — grid cells, the same
 * units `door.width` and `SNAP_THRESHOLD` are in.
 */
export function minDoorWidth(style: DoorStyle): number {
  return WIDE_STYLES.has(style) ? 2 : 1;
}

/**
 * The width a door of this style may actually have in an opening this long.
 *
 * Clamps both ways. The style sets the floor — a double needs room for two
 * leaves. The host wall sets the ceiling, because a door wider than its opening
 * is exactly the state the placement tool refuses with a red ghost, and
 * switching the style of a door already on the map must not be able to conjure
 * it. Going double→single on a long wall keeps the extra width: a wide single
 * is legal, just unusual.
 *
 * A wall too short even for the style's minimum keeps the minimum — there is no
 * legal width to be had there, and going narrower only trades one invalid door
 * for another. Pass `Infinity` for a detached door, which has no opening to fit.
 */
export function clampDoorWidth(width: number, style: DoorStyle, wallLength: number): number {
  return Math.max(minDoorWidth(style), Math.min(width, wallLength));
}

/** What a click would place, and whether it would be allowed to. */
interface DoorPlan {
  /** Transient — the commit fills in the id, the name and the room binding. */
  door: DoorChild;
  wall: ResolvedWall;
  valid: boolean;
}

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
  /** Holds the placement ghost. Owned here, parented to the shared preview layer. */
  private ghost: Container;
  /** What the ghost currently shows, quantized; null when it is empty. */
  private ghostKey: string | null = null;

  constructor(previewContainer: Container) {
    this.ghost = new Container();
    this.ghost.label = 'doorGhost';
    this.ghost.alpha = GHOST_ALPHA;
    previewContainer.addChild(this.ghost);
  }

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

    // The ghost the pointer has been showing *is* the placement — same snap at
    // the same point, so what was previewed is exactly what lands, invalidity
    // included.
    const allWalls = resolveWalls(activeLayer);
    // Snapped from the press itself rather than trusting a hover to have
    // happened.
    // `cancel()` clears the snap and `ToolManager.switchTool` cancels the tool it
    // is leaving, so the snap is null every time the door tool is activated —
    // and activating it opens the tool popover over the canvas, so the press
    // that dismisses the popover is routinely the first pointer event this tool
    // sees. With nothing to plan from, that press placed nothing and said
    // nothing: two identical clicks were needed for one door. Touch never
    // hovers at all, so it could not place a door by any number of taps.
    this.snapResult = snapToNearestWall([point.x, point.y], allWalls, SNAP_THRESHOLD);
    const plan = this.plan(activeLayer, allWalls);
    if (!plan || !plan.valid) return;

    // L6: Auto-name by style — e.g., "Portcullis 1", "Archway 2"
    const styleName = doorStyleLabel(plan.door.style);
    const stylePattern = new RegExp(`^${styleName} (\\d+)$`);
    const doorNumbers = activeLayer.children
      .filter((c) => c.childType === 'door')
      .map((c) => {
        const match = c.name.match(stylePattern);
        return match ? parseInt(match[1], 10) : 0;
      });
    const nextNum = doorNumbers.length > 0 ? Math.max(...doorNumbers) + 1 : 1;

    const door: DoorChild = {
      ...plan.door,
      id: crypto.randomUUID(),
      name: `${styleName} ${nextNum}`,
    };

    // Bind to the rooms either side of the wall now, so lighting/fog see the
    // topology immediately instead of waiting for the next room re-detection.
    Object.assign(door, bindDoorToRooms(door, allWalls, activeLayer.rooms ?? []));

    undoManager.execute(new AddChildCommand('Place door', activeLayerId, door));
    // The real door draws now, so the ghost of it would only double the ink.
    this.clearGhost();
    // Width is a panel field, not a canvas handle (DD6), so a fresh door has to
    // arrive selected or there is no way to size it without hunting the layer list.
    store.setSelectedIds([door.id]);
  }

  /**
   * The door a click at the current snap would place, with the width it would
   * get and whether it would be allowed. One source for the ghost and the
   * commit — the preview is the placement, rendered early.
   */
  private plan(layer: DungeonLayer, walls: ResolvedWall[]): DoorPlan | null {
    const snap = this.snapResult;
    if (!snap) return null;
    const wall = walls.find((w) => w.id === snap.wallId);
    if (!wall) return null;

    const settings = useStore.getState().tools.settings;
    const wallLength = polylineLength(wall.points);
    const style = settings.doorStyle ?? 'single';
    const draft: DoorChild = {
      id: '',
      name: '',
      childType: 'door',
      visible: true,
      // Floor-ring ids are derived per resolve, so storing one would rot on the
      // next union. Position + projection is the whole anchor for those.
      wallId: wall.kind === 'floor' ? FLOOR_ANCHORED : wall.id,
      position: snap.position,
      angle: snap.angle,
      // Exactly the width the DM asked for, with the style's minimum as the only
      // override. A wall too short to hold it trips `isPlaceable`'s
      // width-vs-wall check on its own, so an opening that cannot take this door
      // previews red and commits nothing — no separate rule needed.
      width: Math.max(settings.doorWidth || 1, minDoorWidth(style)),
      style,
      state: 'closed',
      isSecret: settings.doorSecret ?? false,
    };

    // Anchor it the way a render will, so a door as wide as its wall — hence
    // clamped to t = 0.5 — arrives centred on the opening with no centring maths
    // of its own.
    const placed = projectDoorOnto(draft, wall, snap.position);
    draft.position = placed.position;
    draft.angle = placed.angle;

    return { door: draft, wall, valid: this.isPlaceable(draft, wall, wallLength, layer, walls) };
  }

  /** M8 (too wide for its wall) and overlap, the two rules a click is silent about. */
  private isPlaceable(
    door: DoorChild,
    wall: ResolvedWall,
    wallLength: number,
    layer: DungeonLayer,
    walls: ResolvedWall[],
  ): boolean {
    if (door.width > wallLength + WIDTH_EPSILON) return false;

    // Overlap is checked against the doors that currently *resolve* onto this
    // wall — a floor door stores no wall id, so its anchor is only known once
    // resolved.
    // M9: Euclidean centre distance is a simplification. It is accurate enough
    // for doors along a single wall; exact edge cases would want a parametric
    // interval check.
    for (const existing of resolveDoors(layer, walls)) {
      if (existing.wall?.id !== wall.id) continue;
      const dist = Math.hypot(
        existing.position[0] - door.position[0],
        existing.position[1] - door.position[1],
      );
      if (dist < (existing.door.width + door.width) / 2) return false;
    }
    return true;
  }

  /**
   * Draws what the click would place, in the art it would place it in — through
   * `renderResolvedDoor`, the same path the committed door takes. Red says the
   * click will do nothing and why it is refusing (the door overlaps one already
   * there, or is wider than its wall); nothing at all says no wall is in range.
   *
   * ponytail: no subscription to the tool settings — a style or width change
   * shows on the next pointer move. Add one if the panel ever needs to redraw
   * the ghost with the cursor parked.
   */
  private updateGhost(layer: DungeonLayer): void {
    // Over a placed door the click selects rather than places, and during a
    // slide the door itself is tracking the cursor: either way a placement
    // ghost would be a lie.
    const plan =
      this.hoveredDoorId || this.dragFrom ? null : this.plan(layer, resolveWalls(layer));
    if (!plan) {
      this.clearGhost();
      return;
    }

    const { door } = plan;
    const key = [
      Math.round(door.position[0] / GHOST_QUANTIZE),
      Math.round(door.position[1] / GHOST_QUANTIZE),
      door.angle.toFixed(3),
      door.width,
      door.style,
      door.isSecret,
      plan.valid,
    ].join(':');
    if (key === this.ghostKey) return;

    this.clearGhost();
    this.ghostKey = key;
    this.ghost.tint = plan.valid ? 0xffffff : INVALID_TINT;
    renderResolvedDoor(
      this.ghost,
      { door, wall: plan.wall, t: 0.5, position: door.position, angle: door.angle, detached: false },
      layer.style,
    );
  }

  private clearGhost(): void {
    if (this.ghostKey === null) return;
    for (const child of this.ghost.removeChildren()) child.destroy();
    this.ghostKey = null;
  }

  onPointerMove(point: Point): void {
    const activeLayer = activeDungeonLayer();
    if (!activeLayer) return;

    if (this.pressedDoorId && this.pressPoint) {
      const moved = Math.hypot(point.x - this.pressPoint.x, point.y - this.pressPoint.y);
      if (this.dragFrom || moved > DRAG_SLOP) {
        this.clearGhost();
        this.slideTo(point, activeLayer);
        return;
      }
    }

    this.hoveredDoorId = doorAt(point, activeLayer)?.id ?? null;

    this.snapResult = snapToNearestWall(
      [point.x, point.y],
      resolveWalls(activeLayer),
      SNAP_THRESHOLD,
    );

    this.updateGhost(activeLayer);
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
    // Retired: the shared blue line said "a door of some width goes roughly
    // here". The ghost draws the door itself, at the width that will commit, so
    // a second preview under it would only be a worse one.
    return null;
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
    // `ToolManager.switchTool` cancels the outgoing tool, so this is also the
    // tool-exit clear — the ghost must not outlive the door tool being active.
    this.clearGhost();
  }

  isActive(): boolean {
    return this.dragFrom !== null;
  }
}
