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

export interface WallSegment {
  id: string;
  points: [number, number][];
  wallType: WallType;
  direction: WallDirection;
  color: string;
  width: number;
  roughness: number;
}

// ---- Door Types ----
export type DoorStyle = 'single' | 'double' | 'portcullis' | 'archway';
export type DoorState = 'closed' | 'open' | 'locked';

// ---- Mask (placeholder) ----
export interface MaskData {
  id: string;
  // placeholder — do not read/write until masking ships
}

// ---- Child Types ----
export type ChildType = 'shape' | 'asset' | 'light' | 'door';

export interface LayerChild {
  id: string;
  name: string;
  childType: ChildType;
  visible: boolean;
  mask?: MaskData;
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
}

export type AnyChild = ShapeChild | AssetChild | LightChild | DoorChild;
