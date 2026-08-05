export * from '../shared/types';
export * from '../shared/prep';
import type { AnyChild, WallSegment, WallEdits, WallType, WallDirection, DoorStyle, MaskData, Room } from '../shared/types';
import type { ScenePrep, TriggerDef } from '../shared/prep';
import type { Polygon } from '../types/geometry';

// ─── Map Settings ─────────────────────────────────────────

/** Per-map terrain paint state (splatmap metadata — bitmaps live in store.terrainSplats as binary). */
export interface TerrainData {
  /** Texture ids assigned to splat slots (up to 6). null = unassigned slot. */
  palette: (string | null)[];
  /** World-space AABB of painted terrain, for export bounds. null = nothing painted. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
  /** Global terrain show/hide. Absent = true. */
  visible?: boolean;
  /** Global terrain opacity, 0-1. Absent = 1. */
  opacity?: number;
}

/** Sentinel activeLayerId for the pinned Terrain row — never a real layer id. */
export const TERRAIN_PANEL_ID = '__terrain__';

export interface MapSettings {
  name: string;
  gridType: 'square' | 'hex' | 'isometric';
  cellScale: { value: number; unit: string };
  ambientLight: string;
  /** Optional — absent on maps that never painted terrain (and on pre-terrain saves). */
  terrain?: TerrainData;
}

// ─── Grid ─────────────────────────────────────────────────
export interface GridConfig {
  visible: boolean;
  snapEnabled: boolean;
  snapDivision: 1 | 2 | 3 | 4 | 6 | 8;
}

// ─── Layer Children — re-exported from @/shared/types ─────

// ─── Layers ───────────────────────────────────────────────
export type LayerType = 'dungeon' | 'background';

interface BaseLayer {
  id: string;
  name: string;
  type: LayerType;
  visible: boolean;
  locked: boolean;
  opacity: number;
  mask?: MaskData;
}

// WallSegment — re-exported from @/shared/types (wallType + direction replace blocksLight)

export interface SublayerVisibility {
  floor: boolean;
  grid: boolean;
  walls: boolean;
}

export interface DungeonStyle {
  floorColor: string;
  wallColor: string;
  wallWidth: number;
  shadowEnabled: boolean;
  shadowColor: string;
  shadowOffset: { x: number; y: number };
  shadowIntensity: number;
  roughnessAmplitude: number;
  lineWidth: number;
  defaultTextureId?: string;
  edgeTransitionWidth: number;
  showEdgeTransitions: boolean;
  wallTextureSetId?: string;
  wallTextureTint: string;
}

export interface DungeonLayer extends BaseLayer {
  type: 'dungeon';
  children: AnyChild[];
  standaloneWalls: WallSegment[];
  mergedFloor: Polygon[] | null;
  style: DungeonStyle;
  sublayerVisibility: SublayerVisibility;
  /** Detected rooms — serialized into the map file. Absent = not yet detected. */
  rooms?: Room[];
  /** User-assigned room names, keyed by stable room ID; survive re-detection. */
  roomNameOverrides?: Record<string, string>;
  /**
   * Hand adjustments to the stones of floor-derived walls, keyed by ring index
   * within `mergedFloor`.
   *
   * Standalone walls carry their own edits on the WallSegment. A floor ring has
   * no such object — it is recomputed from the shapes every time — so its edits
   * live here. Keyed by `t` along the ring inside each WallEdits, so they
   * survive the ring being relaid after a vertex moves, the same way a
   * standalone wall's do.
   */
  floorWallEdits?: Record<string, WallEdits>;
}

export interface BackgroundLayer extends BaseLayer {
  type: 'background';
  backgroundColor: string;
  backgroundTexture: string | null;
  textureScale: number;
  textureTint: string;
  presetLock: boolean;
}

export type Layer = DungeonLayer | BackgroundLayer;

// ─── Tools ────────────────────────────────────────────────
export interface LightDefaults {
  color: string;
  radius: number;
  featherRadius: number;
  intensity: number;
  falloff: 'linear' | 'quadratic';
  flicker: boolean;
  flickerIntensity: number;
  flickerSpeed: number;
}

export type ToolType =
  | 'select'
  | 'object'
  | 'pan'
  | 'rectangle'
  | 'polygon'
  | 'regularPolygon'
  | 'path'
  | 'wall'
  | 'door'
  | 'light'
  | 'ruler'
  | 'assetPlacement'
  | 'scatterBrush'
  | 'terrain'
  | 'water'
  | 'text'
  | 'zone';

export interface TerrainBrushSettings {
  /** Active palette slot index (0-5). */
  slot: number;
  /** Brush radius in world units (grid cells). */
  radius: number;
  /** Paint opacity/flow per stamp, 0-1. */
  strength: number;
}

export interface WaterToolSettings {
  mode: 'river' | 'lake';
  /** River stroke width in world units. */
  width: number;
  textureId: string;
  bankTextureId: string;
  flowSpeed: number;
}

export interface ZoneToolSettings {
  mode: 'point' | 'circle' | 'rect';
}

export interface ScatterBrushSettings {
  assetIds: string[];
  brushRadius: number;
  count: number;
  minSpacing: number;
  stampMode: boolean;
  rotationRange: [number, number];
  scaleRange: [number, number];
}

export interface ToolSettings {
  brushRadius: number;
  regularPolygon: { sides: number };
  wallType: WallType;
  wallDirection: WallDirection;
  wallWidth: number;
  continuousPlacement: boolean;
  lightDefaults: LightDefaults;
  scatterBrush: ScatterBrushSettings;
  doorStyle: DoorStyle;
  doorSecret: boolean;
  doorWidth: number;
  terrainBrush: TerrainBrushSettings;
  water: WaterToolSettings;
  zone: ZoneToolSettings;
}

export interface ToolsSlice {
  activeTool: ToolType;
  eraseMode: boolean;
  roughMode: boolean;
  /** Wall/path chains commit as Catmull-Rom curves through the clicked anchors. */
  curveMode: boolean;
  settings: ToolSettings;
  recentAssets: string[];
  /**
   * Wall whose composed sprite nodes are exposed for hand-editing (GitHub #19).
   * Null means nodes are hidden, which is the default — they are a finishing
   * tool, not something to trip over while drawing.
   */
  nodeEditWallId: string | null;
  /**
   * Primary selected node within that wall, keyed by spine position. Keyboard
   * adjustments act on this one.
   */
  selectedNodeT: number | null;
  /**
   * Every node in the selection, including the primary. Shift-click adds and
   * removes; dragging any of them moves the whole set by the same delta.
   * Empty exactly when `selectedNodeT` is null.
   */
  selectedNodeTs: number[];
  /**
   * Shape whose floor outline is exposed for vertex editing. Handles are drawn
   * on the MERGED outline this shape belongs to, not on the shape's own ring,
   * so a hallway made of several rectangles is edited as the one outline the
   * DM actually sees.
   */
  shapeNodeEditId: string | null;
  /** Vertex index within that outline currently selected. */
  selectedVertex: number | null;
}

// ─── Selection ───────────────────────────────────────────
export interface ChildClipboard {
  children: AnyChild[];
}

export interface RegionClipboard {
  region: [number, number][][];
  style: DungeonStyle;
}

export interface SelectionSlice {
  selectedIds: string[];
  hoveredId: string | null;
  selectionTransform: {
    translate: [number, number];
    rotate: number;
    scale: [number, number];
  } | null;
  clipboard: ChildClipboard | null;
  regionClipboard: RegionClipboard | null;
  selectedRegion: [number, number][][] | null;
}

// ─── UI ───────────────────────────────────────────────────

export interface ModalState {
  type: 'confirm' | 'export' | 'save' | 'shortcutReference';
  props: Record<string, unknown>;
}

export interface UISlice {
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  activePanel: 'tools' | 'assets' | 'export';
  activeLayerId: string;
  expandedLayerIds: string[];
  canUndo: boolean;
  canRedo: boolean;
  modalState: ModalState | null;
  clipperReady: boolean;
  focusMode: 'auto' | 'manual' | 'fullscreen';
  /** Room whose boundary is drawn highlighted on the canvas (RoomPanel hover/select). */
  highlightedRoomId: string | null;
  /**
   * Alt-click-eye "solo" state — not persisted, not undoable (same tier as
   * activeLayerId). A render-only override: it never writes a layer's own
   * `visible` flag. Consumers gate on `isLayerEffectivelyVisible` (see
   * store/selectors.ts) instead of reading `layer.visible` directly.
   */
  solo: { layerId: string } | null;
}

// ─── Assets ───────────────────────────────────────────────
export interface AssetRef {
  id: string;
  name: string;
  thumbnailUrl: string;
  addedAt: number;
}

export interface AssetEntry {
  id: string;
  name: string;
  url: string;
  thumbnailUrl: string;
  cellWidth: number;
  cellHeight: number;
}

export interface AssetCategory {
  id: string;
  label: string;
  assets: AssetEntry[];
}

export interface AssetManifest {
  categories: AssetCategory[];
}

export interface AssetsSlice {
  manifest: AssetManifest | null;
  loadedCategories: string[];
  recentlyUsed: string[];
  favorites: string[];
  customUploads: AssetRef[];
  customImages: Record<string, string>;
}

// ─── Terrain splat bitmaps ───────────────────────────────
/**
 * PNG-encoded splat bitmaps, held as binary Blobs outside the serialized
 * document. Base64 for the .mapbuilder format is produced in the save worker
 * at save time — data URLs of the splats never exist on the main thread.
 */
export interface TerrainSplatsSlice {
  /** Index = splatmap. null = blank/never painted. */
  pngs: [Blob | null, Blob | null];
  /** Bumped on every write — change detection for autosave and the renderer. */
  rev: number;
}

// ─── Packs (Asset Pack Management) ───────────────────────
export interface PackSummary {
  packId: string;
  name: string;
  version: string;
  sizeBytes: number;
  bundled: boolean;
  installedAt: number;
}

export interface PackUpdateInfo {
  packId: string;
  currentVersion: string;
  availableVersion: string;
}

export interface PacksSlice {
  installedPacks: PackSummary[];
  availableUpdates: PackUpdateInfo[];
  isChecking: boolean;
  installProgress: { packId: string; percent: number } | null;
}

// ─── Maps (Multi-Map Persistence) ────────────────────────
export interface MapMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  gridSize: { width: number; height: number };
  layerCount: number;
}

export interface MapsSlice {
  mapIndex: MapMeta[];
  activeMapId: string | null;
  isMapSwitching: boolean;

  loadMapIndex: () => Promise<void>;
  saveCurrentMap: () => Promise<void>;
  loadMap: (id: string) => Promise<void>;
  createNewMap: (name?: string) => Promise<string>;
  deleteMap: (id: string) => Promise<void>;
  renameMap: (id: string, name: string) => Promise<void>;
  duplicateMap: (id: string) => Promise<string>;
}

// ─── Command Pattern Types ────────────────────────────────
export interface Command {
  execute(): void;
  undo(): void;
  readonly label: string;
  /**
   * The command changes dungeon geometry, so rooms and door→room bindings are
   * no longer valid. `undoManager` re-derives both right after execute/undo,
   * which keeps the binding inside the same undo entry as the geometry.
   */
  readonly affectsRooms?: boolean;
}

// ─── Serialization ────────────────────────────────────────
export interface SerializedMapData {
  version: '2.0' | '3.0' | '3.1';
  mapSettings: MapSettings;
  grid: Pick<GridConfig, 'visible' | 'snapDivision'>;
  layers: Layer[];
  customImages: Record<string, string>;
  /**
   * DM-authored scene prep (triggers). Absent until the DM authors some — a
   * prep-less document leaves the server's stored prep untouched on republish,
   * while `{ triggers: [] }` explicitly clears it. Stripped from every
   * player-bound document by the session server.
   */
  prep?: ScenePrep;
  /**
   * The map's confining rectangle (shared/mapBounds.computeMapFrame), stamped on by the
   * session server when it redacts a document for a player: the fog has to cover the
   * *full* map's frame, and a player's layers no longer measure it. Absent on authored
   * files and on the DM's copy — both can measure their own.
   */
  frame?: { minX: number; minY: number; maxX: number; maxY: number } | null;
  /**
   * Stamped by the session server when the client asks for `?images=external`:
   * the keys of the images it left out of `customImages`, each fetchable as
   * binary from `GET /api/maps/:sceneId/images/:key`. Never present in files.
   */
  imageKeys?: string[];
}

// ─── Top-Level Store ──────────────────────────────────────
export interface MapBuilderStore {
  mapSettings: MapSettings;
  grid: GridConfig;
  layers: Layer[];
  tools: ToolsSlice;
  ui: UISlice;
  assets: AssetsSlice;
  selection: SelectionSlice;
  packs: PacksSlice;
  terrainSplats: TerrainSplatsSlice;

  // maps state
  mapIndex: MapMeta[];
  activeMapId: string | null;
  isMapSwitching: boolean;

  /** Scene prep for the open map. null until the DM authors some (see SerializedMapData.prep). */
  prep: ScenePrep | null;

  // mapSettings actions
  setMapName: (name: string) => void;
  setGridType: (type: MapSettings['gridType']) => void;
  setAmbientLight: (color: string) => void;
  setTerrainData: (patch: Partial<TerrainData>) => void;
  setTerrainSplats: (pngs: [Blob | null, Blob | null]) => void;

  // grid actions
  setGridVisible: (visible: boolean) => void;
  setSnapEnabled: (enabled: boolean) => void;
  setSnapDivision: (division: GridConfig['snapDivision']) => void;

  // layer actions
  addLayer: (layer: Layer) => void;
  removeLayer: (id: string) => void;
  reorderLayers: (fromIndex: number, toIndex: number) => void;
  updateLayer: (id: string, patch: Partial<Layer>) => void;

  // child CRUD actions
  addChild: (layerId: string, child: AnyChild) => void;
  removeChild: (layerId: string, childId: string) => void;
  reorderChild: (layerId: string, fromIndex: number, toIndex: number) => void;
  updateChild: (layerId: string, childId: string, patch: Partial<AnyChild>) => void;
  recomputeMergedFloor: (layerId: string) => void;

  // wall actions (sublayer detail)
  addWall: (layerId: string, wall: WallSegment) => void;
  removeWall: (layerId: string, wallId: string) => void;
  updateWall: (layerId: string, wallId: string, updates: Partial<WallSegment>) => void;
  setFloorWallEdits: (layerId: string, ringKey: string, edits: WallEdits | undefined) => void;
  closeAllDoors: (layerId: string) => void;

  // room actions
  setRooms: (layerId: string, rooms: Room[]) => void;
  renameRoom: (layerId: string, roomId: string, name: string) => void;

  // tool actions
  setActiveTool: (tool: ToolType) => void;
  setEraseMode: (enabled: boolean) => void;
  setRoughMode: (enabled: boolean) => void;
  setCurveMode: (enabled: boolean) => void;
  updateToolSettings: (patch: Partial<ToolSettings>) => void;
  addRecentAsset: (assetId: string) => void;
  updateLightDefaults: (patch: Partial<LightDefaults>) => void;
  updateScatterBrushSettings: (patch: Partial<ScatterBrushSettings>) => void;
  updateTerrainBrushSettings: (patch: Partial<TerrainBrushSettings>) => void;
  updateWaterSettings: (patch: Partial<WaterToolSettings>) => void;
  setNodeEditWall: (wallId: string | null) => void;
  selectNode: (t: number | null) => void;
  toggleNodeSelection: (t: number) => void;
  setShapeNodeEdit: (shapeId: string | null) => void;
  selectVertex: (index: number | null) => void;

  // ui actions
  setActiveLayerId: (id: string) => void;
  setActivePanel: (panel: UISlice['activePanel']) => void;
  togglePanel: (panel: 'left' | 'right') => void;
  toggleExpandedLayerId: (layerId: string) => void;
  showModal: (modal: ModalState | null) => void;
  setClipperReady: (ready: boolean) => void;
  setFocusMode: (mode: UISlice['focusMode']) => void;
  setHighlightedRoomId: (roomId: string | null) => void;
  toggleSoloLayer: (id: string) => void;
  /** Drops solo bookkeeping without touching any layer's visibility. */
  clearSolo: () => void;

  // asset actions
  toggleFavorite: (assetId: string) => void;
  trackRecentUse: (assetId: string) => void;
  addCustomUpload: (ref: AssetRef) => void;
  removeCustomUpload: (id: string) => void;
  setManifest: (manifest: AssetManifest) => void;
  markCategoryLoaded: (categoryId: string) => void;
  addCustomImage: (id: string, base64: string) => void;

  // sublayer visibility actions
  setSublayerVisibility: (layerId: string, sublayer: keyof SublayerVisibility, visible: boolean) => void;

  // background actions
  setBackgroundTexture: (layerId: string, url: string | null) => void;
  setBackgroundLocked: (layerId: string, locked: boolean) => void;

  // selection actions
  setSelectedIds: (ids: string[]) => void;
  setHoveredId: (id: string | null) => void;
  setSelectedRegion: (region: [number, number][][] | null) => void;
  setClipboard: (clipboard: ChildClipboard | null) => void;
  setRegionClipboard: (clipboard: RegionClipboard | null) => void;
  setSelectionTransform: (transform: SelectionSlice['selectionTransform']) => void;
  bakeSelectionTransform: () => void;

  // packs actions
  setInstalledPacks: (packs: PackSummary[]) => void;
  setAvailableUpdates: (updates: PackUpdateInfo[]) => void;
  setIsChecking: (checking: boolean) => void;
  setInstallProgress: (progress: PacksSlice['installProgress']) => void;
  checkForPackUpdates: () => Promise<void>;
  installPack: (packId: string) => Promise<void>;
  uninstallPack: (packId: string) => Promise<void>;

  // maps actions
  loadMapIndex: () => Promise<void>;
  saveCurrentMap: () => Promise<void>;
  loadMap: (id: string) => Promise<void>;
  createNewMap: (name?: string) => Promise<string>;
  deleteMap: (id: string) => Promise<void>;
  renameMap: (id: string, name: string) => Promise<void>;
  duplicateMap: (id: string) => Promise<string>;

  // prep actions
  upsertTrigger: (trigger: TriggerDef) => void;
  removeTrigger: (triggerId: string) => void;

  // bulk / serialization
  loadFromFile: (data: SerializedMapData, splatPngs?: [Blob | null, Blob | null]) => void;
  getSerializableState: () => SerializedMapData;
  resetToDefault: () => void;
}
