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
  ChildType,
  LayerChild,
  RingGeometry,
  ShapeChild,
  AssetChild,
  LightChild,
  LightAnimation,
  Mood,
  DoorChild,
  RoomChild,
  ConnectorChild,
  AnyChild,
  Room,
  RoomArea,
  RoomLook,
  Level,
  ThresholdSegment,
} from './shared/types';

// Session protocol (wire types shared with server + session client)
export * from './shared/protocol';

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

// Rooms
export { roomFaces, wallToRects, thresholdToRects } from './engine/roomDetection';
export { bindDoorToRooms } from './shared/roomBinding';
export { syncRooms, layerFaces } from './store/roomSync';
export type { RoomSyncResult, DoorRooms } from './store/roomSync';
export { refreshRooms, scheduleRoomSync } from './store/roomRefresh';
export { migrateRooms, needsRoomMigration } from './store/roomMigration';
export { buildRoomIndex, roomIndexOf } from './shared/roomIndex';
export type { RoomIndex } from './shared/roomIndex';
export { suggestRooms } from './shared/suggestRooms';
export {
  resolveRoomLook,
  resolveLookKey,
  lookSource,
  roomChain,
  areaChain,
  levelOf,
  roomLooks,
  mapDefaults,
  patchLook,
  LOOK_KEYS,
  ENVIRONMENT_MOOD,
} from './shared/lookScope';
export type { LookChain, LookKey, LookSource, ResolvedLook } from './shared/lookScope';
export { authoredRing, authoredRoomChildren, connectorChildren } from './shared/authoredRooms';
export {
  computeArea,
  computeCentroid,
  computeStableRoomId,
  interiorPoint,
  isPathway,
  nextRoomNumber,
  readingOrder,
  roomBadgePoint,
  roomBadgePoints,
  roomFace,
  signedArea,
} from './shared/roomUtils';

// Lighting
export { LightManager } from './engine/lighting/LightManager';
export { LightingRenderer } from './engine/lighting/LightingRenderer';
export { clockwiseSweep } from './engine/lighting/ClockwiseSweep';
export { SegmentQuadtree } from './engine/lighting/SegmentQuadtree';
export { extractWallSegments } from './engine/lighting/raycaster';

// Lighting pass: sky, region grade, light commands and presets, freeze mode
export { skyFrame, skyKey, skyMinutes, weatherLight, daylightAt, litFrame } from './shared/sky';
export type { SkyFrame, SkyInput, WeatherLight } from './shared/sky';
export {
  regionGrade,
  regionLight,
  regionDarkness,
  isDarkRegion,
  levelGrade,
  levelMood,
  roomMood,
  MOOD_SKY,
  SLIDER_WEIGHT,
  DARK_LUMA,
} from './shared/regionGrade';
export type { RegionMood } from './shared/regionGrade';
export { freezeOf, isFrozen, animationTime, clearFreeze } from './shared/freeze';
export type { Freeze } from './shared/freeze';
export {
  setLightFields,
  toggleDarkness,
  attachLight,
  detachLight,
  clampLightPatch,
  CONE_ANGLE,
  ANIMATION_SPEED,
} from './store/lightCommands';
export type { LightPatch } from './store/lightCommands';
export { LIGHT_PRESETS, LIGHT_RADIUS_FT, lightPreset, presetDefaults } from './store/lightPresets';
export type { LightPreset, LightPresetId } from './store/lightPresets';
export { GLOW_DEFAULT, glowOf } from './shared/propFields';
export { setTableWorld, worldFrame, tableWorld } from './engine/worldOverride';
