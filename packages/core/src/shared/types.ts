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
  width: number;
  roughness: number;
}

// ---- Door Types ----
export type DoorStyle = 'single' | 'double' | 'portcullis' | 'archway' | 'portal';
export type DoorState = 'closed' | 'open' | 'locked';

// ---- Mask (placeholder) ----
export interface MaskData {
  id: string;
  // placeholder — do not read/write until masking ships
}

// ---- Child Types ----
export type ChildType = 'shape' | 'asset' | 'light' | 'door' | 'water' | 'text';

export interface LayerChild {
  id: string;
  name: string;
  childType: ChildType;
  visible: boolean;
  mask?: MaskData;
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
  roughnessEnabled: boolean;
  roughnessAmplitude?: number;
  transform?: {
    translate: [number, number];
    rotate: number;
    scale: [number, number];
  };
  textureId?: string;
  textureScale: number;
  textureOffsetX: number;
  textureOffsetY: number;
  textureFillRotation: number;
  textureTint: string;
}

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
}

export interface LightChild extends LayerChild {
  childType: 'light';
  color: string;
  radius: number;
  featherRadius: number;
  intensity: number;
  falloff: 'linear' | 'quadratic';
  position: { x: number; y: number };
  /** Pack light-mask texture ID — replaces default circular shape with custom mask */
  maskTextureId?: string;
}

export interface DoorChild extends LayerChild {
  childType: 'door';
  wallId: string;
  position: [number, number];
  angle: number;
  width: number;
  style: DoorStyle;
  state: DoorState;
  isSecret: boolean;
  openSound?: string;
  closeSound?: string;
  lockedSound?: string;
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
  textureId: string;
  tint: string;
  opacity: number;
  /** Bank edge-strip texture tiled along the shoreline. Empty string = no banks. */
  bankTextureId: string;
  /** Bank strip width in world units (grid cells). */
  bankWidth: number;
  /** Tile-scroll speed in world units/second for the flow animation. 0 = still. */
  flowSpeed: number;
  /** Flow direction in radians. */
  flowAngle: number;
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
   * pure function of the data. Recomputed whenever text or size changes.
   */
  width: number;
  height: number;
}

export type AnyChild = ShapeChild | AssetChild | LightChild | DoorChild | WaterChild | TextChild;

// ---- Room Types ----
/**
 * An enclosed area detected from wall geometry. Rooms are computed in the
 * editor and serialized into the map file; absent means "not yet detected".
 */
export interface Room {
  id: string;
  name: string;
  boundary: [number, number][];
  centroid: [number, number];
  area: number;
  isPathway: boolean;
}
