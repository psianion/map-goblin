// src/shared/types.ts
// Pure data types — no Zustand or PixiJS dependencies.
// Consumed by both editor (src/store, src/engine) and future Game Runner.

// ---- Geometry ----
export interface Point {
  x: number;
  y: number;
}
export type Polygon = [number, number][];

// ---- Wall Types ----
export type WallType = 'normal' | 'terrain' | 'invisible' | 'ethereal' | 'window';

/**
 * Texture scale a freshly drawn shape starts at: 1, the art's own size (200px
 * per cell, so gg-demo's 1600px floor_small spans its authored 8x8 cells). It
 * was 4 while the retired dungeon-classic floors were in use; on the current
 * packs 4 blew every floor up past its authored size and parked the Scale
 * slider at its maximum.
 */
export const DEFAULT_TEXTURE_SCALE = 1;
export type WallDirection = 'both' | 'left' | 'right';

/**
 * Manual adjustments to a wall's composed sprite nodes (GitHub #19).
 *
 * Auto-layout is deterministic, so nodes are derived rather than stored and an
 * untouched wall adds nothing to the save file. Only deviations persist.
 *
 * Every edit anchors on `t`, the node's parametric position along the spine,
 * never on an array index. Moving a wall vertex relays the whole run, and an
 * index-keyed edit would silently reattach to a different stone; a `t`-keyed
 * edit reattaches to the nearest node or lapses.
 */
export interface WallNodeEdit {
  /** Spine position, 0..1, of the node this edit attaches to. */
  t: number;
  /** Swap for a different piece. */
  pieceId?: string;
  /** Extra rotation on top of the spine tangent, radians. */
  rotate?: number;
  /**
   * Uniform size multiplier for this stone — both axes, so a hand-resized
   * stone reads as a bigger stone rather than a smeared one. Distinct from
   * `WallNode.scale`, which is the auto-fit length multiplier a run uses to
   * absorb its remainder and must stay on the spine axis alone.
   */
  scale?: number;
  /** World-space nudge off the spine, from dragging the node's handle. */
  dx?: number;
  dy?: number;
  /** Delete this node. */
  removed?: boolean;
}

/** Widen or tighten the seam between two adjacent nodes. */
export interface WallSpanEdit {
  /** Spine position of the node leading the seam. */
  t: number;
  /** Signed spine units. Negative pulls the two stones together. */
  gap: number;
}

/** A node the DM added by hand, on top of auto-layout. */
export interface WallNodeInsert {
  t: number;
  pieceId: string;
  rotate?: number;
  scale?: number;
}

/**
 * Hand adjustments to a run's composed stones, keyed by `t` along the spine.
 *
 * Lives here rather than beside the layout engine because a floor-derived wall
 * stores these on its layer, and the store must not reach into the engine.
 */
export interface WallEdits {
  nodeEdits?: WallNodeEdit[];
  spanEdits?: WallSpanEdit[];
  nodeInserts?: WallNodeInsert[];
}

export interface WallSegment extends WallEdits {
  id: string;
  points: [number, number][];
  wallType: WallType;
  direction: WallDirection;
  color: string;
  /**
   * Stroke width in cells. Absent, the normal state, means the layer's
   * `style.wallWidth`, so the Width control moves every wall on the layer at
   * once. Resolve with `wallWidthOf`. Set only when a preset pins drawn work.
   */
  width?: number;
  roughness: number;
  /**
   * Per-wall pins of the layer style the stone renderer reads. Absent — the
   * normal state — means "follow the layer".
   *
   * Written when a style preset is applied, so the preset picks the look of the
   * NEXT wall without repainting the ones already drawn. Same rule shape children
   * get through `styleOverrides`; walls need their own fields because a wall is
   * not a `LayerChild`.
   */
  textureSetId?: string;
  textureTint?: string;
  /**
   * Locked on its own: selectable (with a lock badge), never moved, turned, deleted, cut
   * or moved to another layer. Absent = false. The layer's lock is a separate switch.
   */
  locked?: boolean;
  /**
   * Shown. Absent = true. A hidden wall is drawn nowhere in the editor, the export or the
   * bot, and is never picked; the server still counts it, as it does a hidden layer's walls.
   */
  visible?: boolean;
}

// ---- Door Types ----
export type DoorStyle = 'single' | 'double' | 'portcullis' | 'archway' | 'portal';
export type DoorState = 'closed' | 'open' | 'locked';

// ---- Child Types ----
export type ChildType =
  | 'shape'
  | 'asset'
  | 'light'
  | 'door'
  | 'water'
  | 'text'
  | 'zone';

export interface LayerChild {
  id: string;
  name: string;
  childType: ChildType;
  visible: boolean;
  /**
   * Locked on its own, for every kind: selectable by click and marquee (with a lock badge),
   * never moved, turned, flipped, deleted, cut or moved to another layer. Absent = false.
   */
  locked?: boolean;
  /**
   * Membership in a `DungeonLayer.groups` entry. Grouping is metadata plus
   * selection fan-out — there is no group child — so every consumer that walks
   * `children` keeps working and only the panel and selection read this.
   */
  groupId?: string;
  /**
   * Per-shape style overrides. Omitted fields inherit from layer.style.
   * Typed as Record<string, unknown> to avoid circular dep with store/types.ts.
   * Cast to Partial<DungeonStyle> in engine/store consumer code.
   */
  styleOverrides?: Record<string, unknown>;
}

export interface ShapeChild extends LayerChild {
  childType: 'shape';
  shapeType: 'rectangle' | 'polygon' | 'regularPolygon' | 'path';
  contours: [number, number][][]; // index 0 = outer boundary, 1+ = holes
  /**
   * Optional curve tangents, indexed like `contours` (ring, then vertex).
   * Absent means every edge is straight — existing maps never carry this.
   * Consumers of geometry read the FLATTENED ring (shared/bezier.ts), never
   * this field; only authoring UI touches it.
   */
  tangents?: import('./bezier').RingTangents[];
  /** Retired: nothing ever drew rough edges. Kept optional so older saves still type-check. */
  roughnessEnabled?: boolean;
  roughnessAmplitude?: number;
  transform?: {
    translate: [number, number];
    rotate: number;
    scale: [number, number];
  };
  textureId?: string;
  /** Tile-size multiplier over the 200px-per-cell base (`PX_PER_GRID_CELL`). */
  textureScale: number;
  textureOffsetX: number;
  textureOffsetY: number;
  textureFillRotation: number;
  textureTint: string;
}

/** Per-ring curve tangents — see shared/bezier.ts. */
export type { RingTangents, VertexTangents } from './bezier';

export interface AssetChild extends LayerChild {
  childType: 'asset';
  objectType: 'asset' | 'image';
  assetId: string;
  position: { x: number; y: number };
  rotation: number;
  scale: number;
  width: number;
  height: number;
  tint: string;
  flipX: boolean;
  flipY: boolean;
  // Every key below is optional and absent means its default (shared/propFields.ts
  // PROP_DEFAULTS), so maps saved before props had them load unchanged on 3.1.
  /** 0..1. Absent = 1. */
  opacity?: number;
  /** Drawn above tokens (editor and table), faded for a token standing under it. Absent = false. */
  overhead?: boolean;
  /** Unclickable on the map; the layer panel and the Unlock menu still reach it. Absent = false. */
  locked?: boolean;
  /** Drops a sun/moon shadow. Absent = true. */
  castsShadow?: boolean;
  /** Blocks light and sight along the four edges of its footprint. Absent = false. */
  blocksLight?: boolean;
  /** Stored for table movement, not read yet. Absent = false. */
  blocksMovement?: boolean;
  /** Its own sprite reads lit in the dark, never the cells around it. Absent = false. */
  glows?: boolean;
  /** How the glow burns while `glows` is on. Absent = strength 0.9, steady (`GLOW_DEFAULT`). */
  glow?: { strength: number; animation?: LightAnimation };
}

/** Flicker or pulse, on a light or a glowing prop. `speed` 0.25..4, 1 = the default pace. */
export interface LightAnimation {
  kind: 'flicker' | 'pulse';
  speed: number;
}

export interface LightChild extends LayerChild {
  childType: 'light';
  color: string;
  /** The dim edge, in cells: where the light ends. */
  radius: number;
  /** The bright edge, in cells: the full-strength core. Always `<= radius`. */
  featherRadius: number;
  intensity: number;
  falloff: 'linear' | 'quadratic';
  position: { x: number; y: number };
  /** Asset child id this light is glued to — moves with it, deleted with it. Authoring convenience only; absent on lights placed free-standing or on old saves. */
  attachedTo?: string;
  // Every key below is optional and absent means its default, so maps saved before them
  // load unchanged on 3.1.
  /** Degrees. Absent, or `angle >= 360`, is a full circle. `direction` 0 = east, clockwise. */
  cone?: { angle: number; direction: number };
  /** Absent = steady. */
  animation?: LightAnimation;
  /** Lights through walls instead of being cut by them. Absent = false. */
  throughWalls?: boolean;
  /** Burns only while `min <= darkness <= max` (the sky's 0..1 darkness). Absent = always. */
  nightOnly?: { min: number; max: number };
  /** A darkness source: subtracts light, blocks sight at its edge. `color` is ignored. Absent = false. */
  darkness?: boolean;
  /** Darkness sources only: darkvision sees through it. Absent = false. */
  darkvisionSees?: boolean;
  /** Whether the light starts on at the table. Absent = true. `visible` stays the editor's switch. */
  tableOn?: boolean;
}

export interface DoorChild extends LayerChild {
  childType: 'door';
  /**
   * Standalone wall this door was placed on, or `''` when it is anchored to the
   * floor outline — floor rings are recomputed on every change, so they have no
   * id worth storing. Only a hint either way: `shared/wallResolve.ts` projects
   * the door onto a wall each resolve.
   */
  wallId: string;
  /** Authored intent. Where the door actually sits is resolved, not read from here. */
  position: [number, number];
  /** Authored intent — always re-derived from the resolved wall for rendering. */
  angle: number;
  width: number;
  style: DoorStyle;
  state: DoorState;
  isSecret: boolean;
  /**
   * How far the door stands open when its state is open, degrees: 0 to 180,
   * 180 being folded flat against the wall. Absent = 90.
   */
  openAngle?: number;
  /** Which edge of the opening a single door hangs on, along the wall. Absent = start. */
  hinge?: 'start' | 'end';
  /** Which side of the wall the door swings to: 1 or -1 (see `leafPoses`). Absent = 1. */
  swing?: 1 | -1;
  /** False hangs a kit door with no visible hinge hardware. Absent = shown. */
  hinges?: boolean;
  /**
   * The door kit a single or double door is built from, whatever its wall is:
   * 'stone' (Fieldstone), 'wood' (Palisade) or 'cave' (Cave Ink). Absent = the
   * kit of the wall's own set, or no kit when that set has none.
   */
  kit?: 'stone' | 'wood' | 'cave';
  /** Pack portal texture ID — used when style is 'portal' */
  portalTextureId?: string;
  /** Room on one side of the wall. `null` = exterior, absent = not yet bound. */
  roomA?: string | null;
  /** Room on the other side of the wall. `null` = exterior, absent = not yet bound. */
  roomB?: string | null;
}

export interface WaterChild extends LayerChild {
  childType: 'water';
  /** 'river' = built from a stroked spline, 'lake' = drawn polygon. Editing UX only — rendering is identical. */
  waterType: 'river' | 'lake';
  contours: [number, number][][]; // index 0 = outer boundary, 1+ = holes
  /** Optional curve tangents, indexed like `contours` — see ShapeChild.tangents. */
  tangents?: import('./bezier').RingTangents[];
  textureId: string;
  tint: string;
  opacity: number;
  /** Bank edge-strip texture tiled along the shoreline. Empty string = no banks. */
  bankTextureId: string;
  /** Bank strip width in world units (grid cells). */
  bankWidth: number;
  /**
   * Legacy: water used to scroll along a flow direction. Water is static now;
   * these stay optional so older maps still load. New bodies do not write them.
   */
  flowSpeed?: number;
  /** Legacy flow direction in radians. Read by nothing. */
  flowAngle?: number;
}

/**
 * A label drawn on the map — a room name, an area title, a note.
 *
 * Shaped like AssetChild on purpose: position, rotation, scale and a
 * width/height box. Hit testing, bounds and the selection gizmo then work on it
 * unchanged instead of each growing another case.
 */
export interface TextChild extends LayerChild {
  childType: 'text';
  text: string;
  position: { x: number; y: number };
  rotation: number;
  scale: number;
  /** Type size in world units (grid cells), before `scale`. */
  fontSize: number;
  color: string;
  /**
   * Estimated extent in world units, kept on the child so hit testing stays a
   * pure function of the data. Recomputed whenever text, size or backdrop changes.
   */
  width: number;
  height: number;
  /** The preset it was placed with (`shared/labelStyles`). Absent = Custom. */
  style?: LabelStyleId;
  /** Absent = regular. */
  weight?: 'bold';
  /** A contrasting outline round the letters, or a rounded plate behind them. Absent = none. */
  backdrop?: 'halo' | 'pill';
  /** How the lines of a multi-line label line up with each other. Absent = centre. */
  align?: 'left' | 'right';
  /** Shown to player seats at the table. Absent = DM-only. */
  players?: true;
  /**
   * The room or door the label follows: its text comes from the target's name or number and
   * its position is the target's anchor plus `offset`. `position` stays the stored truth;
   * core keeps the two in step (`store/boundLabels`).
   */
  bound?: LabelBinding;
  /** World units from the bound target's anchor to `position`. Only with `bound`. */
  offset?: [number, number];
}

/** The label presets; Custom is the absence of one. */
export type LabelStyleId = 'room-name' | 'door-tag' | 'gm-note' | 'number-pin' | 'callout';

/** What a bound label follows, by id. */
export type LabelBinding = { kind: 'room'; id: string } | { kind: 'door'; id: string };

/** Where a zone sits, in world units (grid cells). */
export type ZoneShape =
  | { kind: 'point'; position: Point }
  | { kind: 'circle'; position: Point; radius: number }
  | { kind: 'rect'; x: number; y: number; width: number; height: number };

/**
 * A DM-authored trigger anchor (scene prep). Zones exist so triggers never
 * reference derived room ids: the id here is a real uuid that survives
 * republish, and the server resolves a point zone to its containing room at
 * prep-load time.
 *
 * Zones are prep, not scenery: drawn only as an editor overlay, never rendered
 * on the game table, stripped from every player-bound document, invisible to
 * fog/lighting, and ignored by room detection.
 */
export interface ZoneChild extends LayerChild {
  childType: 'zone';
  shape: ZoneShape;
  /**
   * S3 token vision — an explore lock. Sight sweeping into this zone still *shows* the
   * party what is there, but it never auto-explores it: the curtained vault stays the DM's
   * to reveal by hand. Circle and rect zones only; a point zone has no area to lock.
   *
   * Absent reads as false, so old maps load unchanged and the schema stays 3.1. Server-side
   * by construction — zones are stripped from every player-bound document.
   */
  blocksAutoExplore?: boolean;
}

/**
 * Ring geometry, authored exactly the way `ShapeChild` authors it: contours,
 * optional curve tangents, an optional baked transform. Sharing the field names
 * is the point — `childTransform`'s rings kind, `hitTest`'s ring bounds and the
 * outline node editor all read these three and need no new branch shapes.
 */
export interface RingGeometry {
  /** index 0 = outer boundary, 1+ = holes. */
  contours: [number, number][][];
  /** Optional curve tangents, indexed like `contours` — see ShapeChild.tangents. */
  tangents?: import('./bezier').RingTangents[];
  transform?: {
    translate: [number, number];
    rotate: number;
    scale: [number, number];
  };
}

/**
 * Legacy: a room the DM drew as a ring child, before rooms became anchored
 * places. Nothing authors these any more and they are not part of `AnyChild`;
 * `store/roomMigration.ts` reads the ones an older file still carries and turns
 * each into a `Room` (anchor = a point inside its ring, same id) on open.
 */
export interface RoomChild extends Omit<LayerChild, 'childType'>, RingGeometry {
  childType: 'room';
}

/**
 * Legacy: the joint between two drawn rooms, a blob straddling both rings.
 * Connections between rooms were dropped with the drawn rooms; the migration
 * removes these on open, and only legacy readers that still meet an unmigrated
 * document (the session server's stored maps) look at them.
 */
export interface ConnectorChild extends Omit<LayerChild, 'childType'>, RingGeometry {
  childType: 'connector';
  kind: 'arch' | 'door';
  state: DoorState;
  isSecret: boolean;
  /** Door styling for `kind:'door'`. An arch is `'archway'` whatever this says. */
  style?: DoorStyle;
  /** Room on one side. `null` = no room there, absent = not yet bound. */
  roomA?: string | null;
  /** Room on the other side. `null` = no room there, absent = not yet bound. */
  roomB?: string | null;
}

export type AnyChild =
  | ShapeChild
  | AssetChild
  | LightChild
  | DoorChild
  | WaterChild
  | TextChild
  | ZoneChild;

// ---- Room Types ----

/**
 * How a room, an area, a level (or later anything else in the look chain) wants
 * to look. Every key is optional and absent means "inherit from the scope
 * below": room → area → layer style → level → map defaults
 * (`shared/lookScope.ts` is the one resolver).
 *
 * `mood` is how much sky light reaches the scope (Lit 100 %, Dim 40 %, Dark 0 %),
 * `moodTint` its ambient colour, and `moodVision` whether a scope that resolves
 * dark counts as darkness for player sight. `shared/regionGrade.ts` reads all three.
 */
export interface RoomLook {
  floorTextureId?: string;
  floorTint?: string;
  wallTextureSetId?: string;
  wallTextureTint?: string;
  wallWidth?: number;
  mood?: Mood;
  moodTint?: string;
  /** Absent = 'darkness': a region that resolves dark hides from sight unless lit. */
  moodVision?: 'darkness' | 'visible';
}

/** How much sky light reaches a region. */
export type Mood = 'lit' | 'dim' | 'dark';

/**
 * A place on the map. Rooms are authored, not detected: the DM owns the id, the
 * name, the number and a single `anchor` point, and the room's extent is the
 * face of (merged floor − walls − thresholds) that contains the anchor. That is
 * what lets the id survive any edit of the floor or the walls around it.
 *
 * The fields below the line are derived by `store/roomSync.ts` every time the
 * geometry settles and stripped on save, so a file only ever holds intent.
 */
export interface Room {
  /** Permanent: a uuid, or the `room-xxxx` hash a detected room had when its map was migrated. */
  id: string;
  name: string;
  /** Display number and list order. */
  number?: number;
  /** World units, inside the face. */
  anchor: [number, number];
  /** A hand-traced face, for rooms on image-only maps that have no floor to cut. */
  boundary?: [number, number][];
  areaId?: string;
  look?: RoomLook;
  /** Split lineage: the room this one was cut from. The server copies its fog at publish, then strips it. */
  derivedFrom?: string;
  /** Merge lineage: rooms folded into this one. The server ORs their fog at publish, then strips it. */
  mergedFrom?: string[];

  // ---- derived at runtime, stripped on save ----
  /** The face the anchor sits in (or `boundary`). Read through `roomFace`. */
  face?: [number, number][];
  centroid?: [number, number];
  area?: number;
  isPathway?: boolean;
  /** The anchor lies on no face; `face` keeps the last one it had. */
  orphaned?: boolean;
  /** Door ids bound to this room. */
  doors?: string[];
}

/** The runtime-only keys of a `Room`, the ones a save strips. */
export const ROOM_RUNTIME_KEYS = ['face', 'centroid', 'area', 'isPathway', 'orphaned', 'doors'] as const;

/** A named group of rooms inside one layer, with its own look. */
export interface RoomArea {
  id: string;
  name: string;
  look?: RoomLook;
}

/** A named group of one or more layers, with its own look. Every layer belongs to exactly one. */
export interface Level {
  id: string;
  name: string;
  look?: RoomLook;
}

/**
 * A divider line that cuts room faces apart and blocks nothing: no sight, no
 * movement, no stones. The cheap way to split one open floor into two rooms.
 */
export interface ThresholdSegment {
  id: string;
  points: [number, number][];
}
