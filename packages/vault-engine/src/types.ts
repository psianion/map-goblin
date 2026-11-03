/** 9 asset types supported by the system */
export type AssetType =
  | 'floor'
  | 'wall'
  | 'pattern'
  | 'edge'
  | 'object'
  | 'scatter'
  | 'path'
  | 'portal'
  | 'light-mask';

/** Asset types that get packed into spritesheets */
export const ATLAS_TYPES: ReadonlySet<AssetType> = new Set([
  'floor', 'wall', 'pattern', 'edge', 'scatter',
]);

/** Asset types delivered as individual files */
export const INDIVIDUAL_TYPES: ReadonlySet<AssetType> = new Set([
  'object', 'portal', 'path', 'light-mask',
]);

/** Wall piece types */
export type WallPieceType =
  | 'straight'
  | 'corner-90'
  | 'corner-120'
  | 'corner-135'
  | 'ending'
  | 'junction-t'
  | 'junction-x'
  | 'connector';

/** Floor piece types */
export type FloorPieceType = 'base' | 'border' | 'accent';

/** Path piece types */
export type PathPieceType = 'straight' | 'curve' | 'intersection' | 'ending';

export type PieceType = WallPieceType | FloorPieceType | PathPieceType | 'floor' | 'wall' | 'edge' | 'path' | 'object' | 'scatter' | 'portal' | 'light-mask' | 'pattern' | 'edge-transition';

/** Grid size notation (e.g., "1x1", "2x1", "3x1") */
export type GridSize = `${number}x${number}`;

/** Tool that can consume this asset in map-builder */
export type ToolType = 'floor-fill' | 'wall' | 'path' | 'stamp' | 'scatter';

/** Pack type */
export type PackType = 'foundation' | 'expansion';

/** Allowed source image formats */
export type ImageFormat = 'png' | 'jpeg' | 'webp' | 'svg';

/** Per-asset metadata as stored in the catalog */
export interface AssetMetadata {
  id: string;
  sourceFile: string;
  type: AssetType;
  theme: string;
  material: string;
  gridSize: GridSize;
  pieceType: PieceType;
  variant: string;
  tint: string;
  tool: ToolType[];
  tileable: boolean;
  transparency: boolean;
  contentBounds: { x: number; y: number; w: number; h: number };
  perceptualHash: string;
  width: number;
  height: number;
}

/** Import result for a single file */
export interface ImportResult {
  file: string;
  status: 'ok' | 'rejected' | 'duplicate' | 'similar';
  metadata?: AssetMetadata;
  reason?: string;
  similarTo?: string[];
}

/** Composition request */
export interface ComposeRequest {
  material: string;
  sourceSprites: string[];
  targetPieces: {
    pieceType: WallPieceType | PathPieceType | 'edge-transition';
    sizes: GridSize[];
    variantCount: number;
  }[];
}

/** Composition result for a single piece */
export interface ComposeResult {
  pieceType: string;
  size: GridSize;
  variant: string;
  outputPath: string;
  passed: boolean;
  failReason?: string;
}

/** Build options */
export interface BuildOptions {
  packDir: string;
  outputDir: string;
  taxonomyPath: string;
  maxAtlasSize?: number;
  webpQuality?: { textures: number; objects: number };
}

/** Validation error */
export interface ValidationError {
  file: string;
  code: string;
  message: string;
}
