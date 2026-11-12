import { Container } from 'pixi.js';
import type { Point } from '../../types/geometry';
import { isDoubleClick, type DrawingTool, type PreviewShape } from './DrawingTool';
import type { DoorChild, DungeonLayer, WallSegment } from '../../store/types';
import type { DoorStyle } from '../../shared/types';
import { nextAuthoredName } from '../../shared/authoredName';
import { snapToNearestWall, type WallSnapResult } from '../../shared/wallSnap';
import {
  doorWallId,
  polylineLength,
  projectDoorOnto,
  resolveDoors,
  resolveWalls,
  type ResolvedWall,
} from '../../shared/wallResolve';
import { renderResolvedDoor } from '../doorRenderer';
import { isKitStyle } from '../../assets/doorKits';
import { freePiece } from '../../shared/freestandingDoor';
import { minDoorWidth, spanBetweenWalls, type DoorSpan } from '../../shared/doorSpan';
import { edgeStyles, ringStyles, wallWidthOf } from '../../shared/wallLook';
import { layerDrawStyle, layerLevelLook } from '../levelLook';
import { bindDoorToRooms } from '../../shared/roomBinding';
import { DOOR_MIN_HIT_RADIUS as MIN_HIT_RADIUS } from '../hitTest';
import {
  AddChildCommand,
  AddWallCommand,
  CompositeCommand,
  UpdateChildCommand,
  createChildRemovalCommand,
} from '../../store/commands';
import { undoManager } from '../../store/undoManager';
import { useStore } from '../../store/store';
import { findDoorway, overDoorway } from '../../shared/doorwaySeal';
import { doorwayEditCommand, revertDoorwayLive, writeDoorwayLive } from '../../store/doorwayCommands';
import { notify } from '../../shared/notify';
import { blockedLayerReason, noEditableLayerMessage, resolveEditableLayer } from './layerGuard';


/**
 * H7: a fixed world-unit threshold giving ~1.5 grid cells of snap range. World
 * coords are 1 unit = 1 grid cell, so it holds at any zoom. Placement snapping
 * and drag re-anchoring share it — a door lands where it would be dragged to.
 */
const SNAP_THRESHOLD = 1.5;

/** A pointer this near a wall is on it: the door runs along it before anything else is tried. */
const ON_WALL_REACH = 0.25;

/**
 * How near any wall a placement click has to be to hang the door along it once no span
 * was found. Far less than `SNAP_THRESHOLD`: in a corridor every cell lies within 1.5
 * cells of a wall, so at that reach a door could only ever run along a corridor.
 */
const ALONG_REACH = 0.5;

/** How far from a cave's edge its rock reaches, cells: a click on the rock hangs the door along the edge. */
const CAVE_ROCK_REACH = 0.6;

/** The widest gap a door spans by itself, cells, whatever the Width setting: the Width's own top (4). */
const MIN_SPAN = 4;

/**
 * Where a placement click puts its door, in order: along a wall the pointer is on
 * (`ON_WALL_REACH`); else across the gap between two walls (`spanBetweenWalls`, as wide
 * as the gap, up to the larger of `MIN_SPAN` and the Width setting); else along any wall
 * within `ALONG_REACH`; else along a drawn wall within `SNAP_THRESHOLD`; else free on open
 * floor. "Along" only takes a wall long enough for the style's narrowest door: a shorter
 * one (one edge of a curved floor ring) falls through to the next step. With the Door
 * panel's Freestanding on, always free: the door stands wherever it is placed.
 */
type Placement = { kind: 'along'; snap: WallSnapResult } | { kind: 'span'; span: DoorSpan } | { kind: 'free' };

function placementAt(point: Point, walls: ResolvedWall[], layer: DungeonLayer): Placement {
  const settings = useStore.getState().tools.settings;
  if (settings.doorFreestanding) return { kind: 'free' };
  const at: [number, number] = [point.x, point.y];
  const style = settings.doorStyle ?? 'single';
  const holds = walls.filter((w) => polylineLength(w.points) >= minDoorWidth(style) - WIDTH_EPSILON);
  const along = (list: ResolvedWall[], reach: number): Placement | null => {
    const snap = snapToNearestWall(at, list, reach);
    return snap ? { kind: 'along', snap } : null;
  };
  // A cave's rock lies out from its edge, so a click on the rock is a click on that wall.
  const onWall = along(holds, ON_WALL_REACH) ?? along(holds.filter((w) => w.kind === 'cave'), CAVE_ROCK_REACH);
  if (onWall) return onWall;
  const maxSpan = Math.max(MIN_SPAN, settings.doorWidth || 1);
  const span = spanBetweenWalls(at, walls, style, maxSpan, (w) => wallWidthOf(w, layer.style.wallWidth));
  if (span) return { kind: 'span', span };
  return along(holds, ALONG_REACH) ?? along(holds.filter((w) => w.kind === 'standalone'), SNAP_THRESHOLD) ?? { kind: 'free' };
}

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
 * World-unit step the ghost's rebuild key quantizes to. Keyed on the *snapped*
 * door rather than the cursor: sliding along a wall inside a quarter cell, or
 * moving perpendicular to one at all, changes nothing that is drawn.
 */
const GHOST_QUANTIZE = 0.25;

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

/** A free-standing door's angle, degrees, as the dock and the card take it: 0 to 180 in 5° steps. */
export const DOOR_ANGLE_STEP = 5;

/** A typed angle held to 0–180 and its step. 180 is 0 the other way round, so it reads 0. */
export function doorAngleValue(deg: number): number {
  const v = Math.round(Math.min(180, Math.max(0, deg)) / DOOR_ANGLE_STEP) * DOOR_ANGLE_STEP;
  return v === 180 ? 0 : v;
}

/** "Turn 90°": a quarter turn on, wrapping inside a half turn (a door reads the same both ways). */
export function turnDoorAngle(deg: number): number {
  return (((Math.round(deg) + 90) % 180) + 180) % 180;
}

/** Title-cased style — the picker label, and the stem of a new door's name. */
export function doorStyleLabel(style: DoorStyle): string {
  return style.charAt(0).toUpperCase() + style.slice(1);
}

export { minDoorWidth };

/**
 * The width a door of this style may actually have in an opening this long.
 *
 * Clamps both ways. The style sets the floor — a double needs room for two
 * leaves. The host wall sets the ceiling: placement fits the door to a wall
 * shorter than the Width asked for, and switching the style of a door already
 * on the map must not be able to make it wider than its opening. Going
 * double→single on a long wall keeps the extra width: a wide single is legal,
 * just unusual.
 *
 * A wall too short even for the style's minimum keeps the minimum — there is no
 * legal width to be had there, and going narrower only trades one invalid door
 * for another. Pass `Infinity` for a detached door, which has no opening to fit.
 */
export function clampDoorWidth(width: number, style: DoorStyle, wallLength: number): number {
  return Math.max(minDoorWidth(style), Math.min(width, wallLength));
}

export { nextAuthoredName };

/**
 * What a new door of `style` takes from the tool beyond its style: the dock's kit for a
 * style a kit builds, and the plain opening for an archway placed as "Opening".
 */
function newDoorLook(style: DoorStyle): Pick<DoorChild, 'kit' | 'bare'> {
  const { doorKit, doorBare } = useStore.getState().tools.settings;
  return {
    ...(doorKit && isKitStyle(style) ? { kit: doorKit } : {}),
    ...(doorBare && style === 'archway' ? { bare: true } : {}),
  };
}

/** What a click would place, and whether it would be allowed to. */
interface DoorPlan {
  /** Transient — the commit fills in the id, the name and the room binding. */
  door: DoorChild;
  wall: ResolvedWall;
  valid: boolean;
  /** A free-standing door's own piece of wall, placed with it (its id filled in on commit). */
  piece?: WallSegment;
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
    // Hit-testing keeps the full wall set — an existing door resolves wherever
    // it resolves. Only *snapping* filters (see doorSnapWalls).
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

/** Walls a door can hang on: every resolved wall, standalone and floor ring alike. */
function doorSnapWalls(layer: DungeonLayer): ResolvedWall[] {
  return resolveWalls(layer);
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
  // No editsActiveLayer: DR10 requires single-click door *selection* to keep
  // working on a locked layer (the properties panel keys off it), which the
  // manager's blanket pointerDown guard can't distinguish from placement or a
  // drag. This tool enforces the split itself — see onPointerDown.
  snapResult: WallSnapResult | null = null;
  /** Door under the cursor — the Delete target when nothing is selected. */
  hoveredDoorId: string | null = null;

  private lastClick: { point: Point; time: number } | null = null;
  /** Door under a held pointer, and where the press started. */
  private pressedDoorId: string | null = null;
  private pressPoint: Point | null = null;
  /** Set once the press passes `DRAG_SLOP`; holds what to put back on Escape/undo. */
  private dragFrom: DoorAnchor | null = null;
  /** The layer as the slide found it, and the last point slid to inside the door's doorway. */
  private dragLayerFrom: DungeonLayer | null = null;
  private sealAt: [number, number] | null = null;
  /** Holds the placement ghost. Owned here, parented to the shared preview layer. */
  private ghost: Container;
  /** What the ghost currently shows, quantized; null when it is empty. */
  private ghostKey: string | null = null;

  /** The leaf a placement press will commit on release. */
  private pendingLeaf: DoorPlan | null = null;
  /** Layer the placement press started on — see RectangleTool for why. */
  private placeLayerId: string | null = null;

  constructor(previewContainer: Container) {
    this.ghost = new Container();
    this.ghost.label = 'doorGhost';
    this.ghost.alpha = GHOST_ALPHA;
    previewContainer.addChild(this.ghost);
  }

  onPointerDown(point: Point, _event?: PointerEvent, raw?: Point): void {
    const store = useStore.getState();
    const activeLayerId = store.ui.activeLayerId;
    const activeLayer = activeDungeonLayer();
    if (!activeLayer) {
      notify.warning(noEditableLayerMessage());
      return;
    }
    // blockedLayerReason folds solo into "hidden" (isLayerEffectivelyVisible),
    // where the raw activeLayer.visible check this replaced did not — soloing
    // another layer left this one clickable even though the panel and canvas
    // both show it hidden. Locked is handled specially: it still permits the
    // single-click select branch below (DR10), so only hidden blocks here.
    const reason = blockedLayerReason(activeLayer);
    if (reason === 'Layer is hidden') {
      // Nothing to inspect if the layer isn't drawn — a door tool with a
      // hidden layer active has nothing on screen to click.
      notify.warning(reason);
      return;
    }
    const locked = reason === 'Layer is locked';

    // A placed door is found under the pointer itself: one on a freehand cave wall
    // sits off the grid, where the snapped point can miss it.
    const hit = doorAt(raw ?? point, activeLayer);
    if (hit) {
      // Second click of a double flips the state; the first already selected the
      // door, and selection is idempotent, so nothing fires twice.
      if (isDoubleClick(this.lastClick, point, Date.now())) {
        if (locked) {
          notify.warning('Layer is locked');
          return;
        }
        this.lastClick = null;
        this.pressedDoorId = null;
        this.pressPoint = null;
        // A permanent opening has no state to flip (L8): occlusion always treats
        // one as open, and its panel hides the row a flip would write to.
        if (hit.style === 'archway') return;
        // Locking is the card's State field alone. A locked door draws as a shut
        // one, so say why it did not open.
        if (hit.state === 'locked') {
          notify.info('Locked — unlock it in the door card');
          return;
        }
        undoManager.execute(
          new UpdateChildCommand(
            'Toggle door',
            activeLayerId,
            hit.id,
            { state: hit.state },
            { state: hit.state === 'open' ? 'closed' : 'open' },
          ),
        );
        return;
      }
      // Single click selects — the properties panel keys off the selection, so a
      // door can now be inspected without being mutated (DR10). This has to work
      // on a locked layer too: DR10's whole point is that inspecting a door is
      // not editing it, so a lock — which exists to stop edits — must not stop it.
      // Press/drag tracking still arms here even when locked: the press is a
      // select either way, and onPointerMove is what tells select and
      // drag-start apart (the DRAG_SLOP crossing) — that is where a locked
      // layer has to refuse and say so, not here.
      store.setSelectedIds([hit.id]);
      this.lastClick = { point, time: Date.now() };
      this.pressedDoorId = hit.id;
      this.pressPoint = point;
      return;
    }

    if (locked) {
      notify.warning('Layer is locked');
      return;
    }

    store.setSelectedIds([]);

    // The ghost the pointer has been showing *is* the placement — same snap at
    // the same point, so what was previewed is exactly what lands, invalidity
    // included.
    const allWalls = doorSnapWalls(activeLayer);
    // Snapped from the press itself rather than trusting a hover to have
    // happened.
    // `cancel()` clears the snap and `ToolManager.switchTool` cancels the tool it
    // is leaving, so the snap is null every time the door tool is activated —
    // and activating it opens the tool popover over the canvas, so the press
    // that dismisses the popover is routinely the first pointer event this tool
    // sees. With nothing to plan from, that press placed nothing and said
    // nothing: two identical clicks were needed for one door. Touch never
    // hovers at all, so it could not place a door by any number of taps.
    // The leaf the ghost has been promising lands on release: along a wall, across a
    // gap, or free on a piece of its own.
    this.pendingLeaf = this.planAt(activeLayer, point, allWalls);
    if (!this.pendingLeaf) {
      this.clearGhost();
      return;
    }
    this.placeLayerId = activeLayerId;
  }

  /** The release of a placement press that stayed a click: the leaf the ghost showed. */
  private commitLeafPlacement(plan: DoorPlan, layerId: string): void {
    const layer = resolveEditableLayer(layerId);
    if (!layer || !plan.valid) return;

    const door: DoorChild = {
      ...plan.door,
      id: crypto.randomUUID(),
      // L6: auto-named by style — "Portcullis 1", "Archway 2".
      name: nextAuthoredName(layer.children, plan.door.bare ? 'Opening' : doorStyleLabel(plan.door.style)),
    };
    const piece = plan.piece ? { ...plan.piece, id: crypto.randomUUID() } : null;
    if (piece) door.wallId = piece.id;
    const walls = doorSnapWalls(layer);
    if (piece) walls.push({ ...piece, kind: 'standalone' });

    // Bind to the rooms either side of the wall now, so lighting/fog see the
    // topology immediately instead of waiting for the next room re-detection.
    Object.assign(door, bindDoorToRooms(door, walls, layer.rooms ?? []));

    // A free-standing door and its piece are one step: one undo takes both.
    undoManager.execute(
      piece
        ? new CompositeCommand('Place door', [
            new AddWallCommand('Place door', layer.id, piece),
            new AddChildCommand('Place door', layer.id, door),
          ])
        : new AddChildCommand('Place door', layer.id, door),
    );
    // The real door draws now, so the ghost of it would only double the ink.
    this.clearGhost();
    // Width is a panel field, not a canvas handle (DD6), so a fresh door has to
    // arrive selected or there is no way to size it without hunting the layer list.
    useStore.getState().setSelectedIds([door.id]);
  }

  /**
   * What a click at `point` would place, by `placementAt`'s order. One source for
   * the ghost and the commit — the preview is the placement, rendered early.
   */
  private planAt(layer: DungeonLayer, point: Point, walls: ResolvedWall[]): DoorPlan | null {
    const placement = placementAt(point, walls, layer);
    this.snapResult = placement.kind === 'along' ? placement.snap : null;
    if (placement.kind === 'along') return this.plan(layer, walls);
    if (placement.kind === 'span') {
      const { span } = placement;
      // The door matches the walls it joins: the near wall's set and tint pins.
      return this.freePlan(layer, { x: span.centre[0], y: span.centre[1] }, span.angle, span.width, {
        textureSetId: span.wallA.textureSetId,
        textureTint: span.wallA.textureTint,
      });
    }
    return this.freePlan(layer, point);
  }

  /**
   * The door a click at the current snap would place, with the width it would
   * get and whether it would be allowed.
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
      // Floor-ring and material ids are derived per resolve, so storing one would
      // rot on the next union. Position + projection is the whole anchor for those.
      wallId: doorWallId(wall),
      position: snap.position,
      angle: snap.angle,
      // The width the DM asked for, fitted to the wall: a shorter wall takes a
      // narrower door. Only a wall shorter than the style's minimum is left too
      // short, and `isPlaceable`'s width-vs-wall check previews that red.
      width: clampDoorWidth(settings.doorWidth || 1, style, wallLength),
      style,
      state: 'closed',
      isSecret: settings.doorSecret ?? false,
      ...newDoorLook(style),
    };

    // Anchor it the way a render will, so a door as wide as its wall — hence
    // clamped to t = 0.5 — arrives centred on the opening with no centring maths
    // of its own.
    const placed = projectDoorOnto(draft, wall, snap.position);
    draft.position = placed.position;
    draft.angle = placed.angle;

    return { door: draft, wall, valid: this.isPlaceable(draft, wall, wallLength, layer, walls) };
  }

  /**
   * A free-standing door at `point`: a piece of wall exactly the door's width, centred on
   * the point at the tool's angle (`doorAngle`, degrees), drawn as the Wall tool draws (the
   * layer's colour and width), with the door on it. The point is already grid-snapped when
   * snap is on, as every tool's is. A door spanning a gap passes its own angle (radians),
   * width and the set and tint pins of the wall it starts from.
   */
  private freePlan(
    layer: DungeonLayer,
    point: Point,
    spanAngle?: number,
    spanWidth?: number,
    pins: Pick<WallSegment, 'textureSetId' | 'textureTint'> = {},
  ): DoorPlan {
    const settings = useStore.getState().tools.settings;
    const style = settings.doorStyle ?? 'single';
    const width = spanWidth ?? Math.max(settings.doorWidth || 1, minDoorWidth(style));
    const angle = spanAngle ?? ((settings.doorAngle ?? 0) * Math.PI) / 180;
    const piece = freePiece([point.x, point.y], angle, width, {
      wallType: settings.wallType,
      direction: settings.wallDirection,
      color: layer.style.wallColor,
    });
    if (pins.textureSetId) piece.textureSetId = pins.textureSetId;
    if (pins.textureTint) piece.textureTint = pins.textureTint;
    const door: DoorChild = {
      id: '',
      name: '',
      childType: 'door',
      visible: true,
      wallId: '',
      position: [point.x, point.y],
      angle,
      width,
      style,
      state: 'closed',
      isSecret: settings.doorSecret ?? false,
      freestanding: true,
      ...newDoorLook(style),
    };
    return { door, wall: { ...piece, kind: 'standalone' }, valid: true, piece };
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
   * `renderResolvedDoor`, the same path the committed door takes, with the same
   * styles (the level's look, and the ring and edge pins of a floor wall). Red
   * says the click will do nothing and why it is refusing (the door overlaps one
   * already there, or its wall is shorter than the style's narrowest door).
   *
   * ponytail: no subscription to the tool settings — a style or width change
   * shows on the next pointer move. Add one if the panel ever needs to redraw
   * the ghost with the cursor parked.
   */
  private updateGhost(layer: DungeonLayer, point: Point): void {
    // Over a placed door the click selects rather than places, and during a
    // slide the door itself is tracking the cursor: either way a placement
    // ghost would be a lie. Open floor shows the free-standing door.
    const plan = this.hoveredDoorId || this.dragFrom || layer.locked ? null : this.planAt(layer, point, doorSnapWalls(layer));
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
      door.kit,
      door.isSecret,
      plan.valid,
      plan.wall.id,
      plan.wall.textureSetId,
    ].join(':');
    if (key === this.ghostKey) return;

    this.clearGhost();
    this.ghostKey = key;
    this.ghost.tint = plan.valid ? 0xffffff : INVALID_TINT;
    const level = layerLevelLook(layer);
    renderResolvedDoor(
      this.ghost,
      // A plain opening draws nothing once placed; its ghost is the arch, so the click has a preview.
      { door: door.bare ? { ...door, bare: false } : door, wall: plan.wall, t: 0.5, position: door.position, angle: door.angle, detached: false },
      layerDrawStyle(layer),
      ringStyles(layer, level),
      edgeStyles(layer, level),
    );
  }

  private clearGhost(): void {
    if (this.ghostKey === null) return;
    for (const child of this.ghost.removeChildren()) child.destroy();
    this.ghostKey = null;
  }

  onPointerMove(point: Point, _event?: PointerEvent, raw?: Point): void {
    const activeLayer = activeDungeonLayer();
    if (!activeLayer) return;

    if (this.pressedDoorId && this.pressPoint) {
      const moved = Math.hypot(point.x - this.pressPoint.x, point.y - this.pressPoint.y);
      if (this.dragFrom || moved > DRAG_SLOP) {
        if (activeLayer.locked) {
          // The press crossed from "select" into "drag" — the moment a locked
          // layer actually has to refuse. Stop tracking so this doesn't warn
          // again on every subsequent move frame of the same gesture.
          notify.warning('Layer is locked');
          this.pressedDoorId = null;
          this.pressPoint = null;
          return;
        }
        this.clearGhost();
        this.slideTo(point, activeLayer);
        return;
      }
    }

    // A placement press holds the leaf it will commit; the ghost stays where it was pressed.
    if (this.pendingLeaf) return;

    this.hoveredDoorId = doorAt(raw ?? point, activeLayer)?.id ?? null;

    this.updateGhost(activeLayer, point);
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

    // A door in a doorway (its own short piece between collinear walls) slides along
    // it with the walls following, so the opening stays the door's width wherever it
    // stops. Off that run it is re-anchored as any door is, and the walls go back.
    this.dragLayerFrom ??= layer;
    const from = this.dragLayerFrom;
    const doorway = findDoorway(from, door.id);
    if (doorway && overDoorway(doorway, [point.x, point.y], SNAP_THRESHOLD)) {
      this.dragFrom ??= anchorOf(door);
      this.sealAt = [point.x, point.y];
      writeDoorwayLive(from, door.id, {}, { at: this.sealAt });
      return;
    }
    if (this.sealAt) {
      revertDoorwayLive(from, door.id);
      this.sealAt = null;
    }

    const walls = doorSnapWalls(layer);
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
      wallId: doorWallId(wall),
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

  onPointerUp(_point?: Point): void {
    if (this.pendingLeaf) {
      const leaf = this.pendingLeaf;
      const layerId = this.placeLayerId;
      this.pendingLeaf = null;
      this.placeLayerId = null;
      if (layerId) this.commitLeafPlacement(leaf, layerId);
      return;
    }

    const from = this.dragFrom;
    const doorId = this.pressedDoorId;
    const layerFrom = this.dragLayerFrom;
    const sealAt = this.sealAt;
    this.pressedDoorId = null;
    this.pressPoint = null;
    this.dragFrom = null;
    this.dragLayerFrom = null;
    this.sealAt = null;
    if (!from || !doorId) return;

    // A slide inside the doorway: the door and the walls it moved, as one undo entry.
    if (layerFrom && sealAt) {
      revertDoorwayLive(layerFrom, doorId);
      const cmd = doorwayEditCommand('Move door', layerFrom, doorId, {}, {}, { at: sealAt });
      if (cmd) undoManager.execute(cmd);
      return;
    }

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
    // Hover is set by an unguarded onPointerMove and the keydown listener is
    // document-level, so neither path already checked the layer — do it here,
    // right before the mutation.
    const reason = blockedLayerReason(layer);
    if (reason) {
      notify.warning(reason);
      return;
    }
    // A door on its own piece takes the piece with it (createChildRemovalCommand).
    undoManager.execute(createChildRemovalCommand(layer.id, target, 'Delete door'));
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
    if (this.dragFrom) return 'grabbing';
    return this.hoveredDoorId ? 'move' : null;
  }

  cancel(): void {
    // Escape mid-slide puts the door back where it was picked up; the tool exit
    // that Escape also means then has nothing half-applied behind it.
    const layer = this.dragFrom ? activeDungeonLayer() : undefined;
    if (this.dragLayerFrom && this.sealAt && this.pressedDoorId) {
      revertDoorwayLive(this.dragLayerFrom, this.pressedDoorId);
    } else if (layer && this.dragFrom && this.pressedDoorId) {
      useStore.getState().updateChild(layer.id, this.pressedDoorId, this.dragFrom);
    }
    this.dragLayerFrom = null;
    this.sealAt = null;
    this.dragFrom = null;
    this.pressedDoorId = null;
    this.pressPoint = null;
    this.lastClick = null;
    this.snapResult = null;
    this.hoveredDoorId = null;
    this.pendingLeaf = null;
    this.placeLayerId = null;
    // `ToolManager.switchTool` cancels the outgoing tool, so this is also the
    // tool-exit clear — the ghost must not outlive the door tool being active.
    this.clearGhost();
  }

  isActive(): boolean {
    return this.dragFrom !== null || this.pendingLeaf !== null;
  }
}
