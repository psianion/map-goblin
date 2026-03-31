// @dnd/core — shared engine for the D&D ecosystem
export const CORE_VERSION = '0.0.1';

// Types
export * from './types/geometry';

// Shared types (wall segments, children, doors, occlusion)
export type {
  WallType,
  WallDirection,
  WallSegment,
  DoorStyle,
  DoorState,
  MaskData,
  ChildType,
  LayerChild,
  ShapeChild,
  AssetChild,
  LightChild,
  DoorChild,
  AnyChild,
} from './shared/types';

// Geometry
export { interpolateCatmullRom, generatePathPolygon } from './geometry/catmullRom';
export { poissonDiskSample } from './geometry/poissonDisk';
export { mulberry32, hashPosition } from './geometry/seededRng';
export { simplifyPath } from './geometry/simplify';
export { tuplesToPoints, pointsToTuples } from './geometry/convert';
export { setClipperModule, clipper2Engine } from './geometry/Clipper2Engine';
export type { GeometryEngine } from './geometry/GeometryEngine';

// Store
export { useStore } from './store/store';
export { setNotify, getNotify } from './store/notify';
export type { NotifyFn } from './store/notify';
export type { MapBuilderStore } from './store/types';

// Engine
export type { RenderEngine, CameraState } from './engine/RenderEngine';
export { PixiRenderEngine } from './engine/PixiRenderEngine';
export { setEngineSingleton, getEngineSingleton, clearEngineSingleton } from './engine/engineSingleton';

// Lighting
export { LightManager } from './engine/lighting/LightManager';
export { LightingRenderer } from './engine/lighting/LightingRenderer';
export { clockwiseSweep } from './engine/lighting/ClockwiseSweep';
export { SegmentQuadtree } from './engine/lighting/SegmentQuadtree';
export { extractWallSegments } from './engine/lighting/raycaster';
