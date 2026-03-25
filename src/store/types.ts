export * from '@/shared/types';
import type { AnyChild, WallSegment, WallType, WallDirection, DoorStyle, MaskData } from '@/shared/types';
import type { Polygon } from '../types/geometry.ts';

// ─── Map Settings ─────────────────────────────────────────
export interface MapSettings {
  name: string;
  gridType: 'square' | 'hex' | 'isometric';
  cellScale: { value: number; unit: string };
  ambientLight: string;
}

// ─── Grid ─────────────────────────────────────────────────
export interface GridConfig {
  visible: boolean;
  snapEnabled: boolean;
  snapDivision: 1 | 2 | 3 | 4 | 6 | 8;
  style: 'clean' | 'dotted' | 'rough';
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
  hatching: boolean;
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
  hatchingStyle: 'none' | 'crosshatch' | 'lines' | 'horizontal';
  hatchingBandWidth: number;
  hatchingLineSpacing: number;
  hatchingLineThickness: number;
  hatchingAngle: number;
  hatchingInverted: boolean;
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
  | 'scatterBrush';

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
}

export interface ToolsSlice {
  activeTool: ToolType;
  eraseMode: boolean;
  roughMode: boolean;
  settings: ToolSettings;
  recentAssets: string[];
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
export interface Toast {
  id: string;
  message: string;
  type: 'info' | 'warning' | 'error';
  duration: number;
  createdAt: number;
}

export interface ModalState {
  type: 'confirm' | 'export' | 'save' | 'shortcutReference' | 'layerDelete';
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
  toastQueue: Toast[];
  clipperReady: boolean;
  focusMode: 'auto' | 'manual' | 'fullscreen';
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
}

// ─── Serialization ────────────────────────────────────────
export interface SerializedMapData {
  version: '2.0' | '3.0';
  mapSettings: MapSettings;
  grid: Pick<GridConfig, 'visible' | 'snapDivision' | 'style'>;
  layers: Layer[];
  customImages: Record<string, string>;
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

  // maps state
  mapIndex: MapMeta[];
  activeMapId: string | null;
  isMapSwitching: boolean;

  // mapSettings actions
  setMapName: (name: string) => void;
  setGridType: (type: MapSettings['gridType']) => void;
  setAmbientLight: (color: string) => void;

  // grid actions
  setGridVisible: (visible: boolean) => void;
  setSnapEnabled: (enabled: boolean) => void;
  setSnapDivision: (division: GridConfig['snapDivision']) => void;
  setGridStyle: (style: GridConfig['style']) => void;

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
  closeAllDoors: (layerId: string) => void;

  // tool actions
  setActiveTool: (tool: ToolType) => void;
  setEraseMode: (enabled: boolean) => void;
  setRoughMode: (enabled: boolean) => void;
  updateToolSettings: (patch: Partial<ToolSettings>) => void;
  addRecentAsset: (assetId: string) => void;
  updateLightDefaults: (patch: Partial<LightDefaults>) => void;
  updateScatterBrushSettings: (patch: Partial<ScatterBrushSettings>) => void;

  // ui actions
  setActiveLayerId: (id: string) => void;
  setActivePanel: (panel: UISlice['activePanel']) => void;
  togglePanel: (panel: 'left' | 'right') => void;
  toggleExpandedLayerId: (layerId: string) => void;
  pushToast: (toast: Toast) => void;
  dismissToast: (id: string) => void;
  showModal: (modal: ModalState | null) => void;
  setClipperReady: (ready: boolean) => void;
  setFocusMode: (mode: UISlice['focusMode']) => void;

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

  // maps actions
  loadMapIndex: () => Promise<void>;
  saveCurrentMap: () => Promise<void>;
  loadMap: (id: string) => Promise<void>;
  createNewMap: (name?: string) => Promise<string>;
  deleteMap: (id: string) => Promise<void>;
  renameMap: (id: string, name: string) => Promise<void>;
  duplicateMap: (id: string) => Promise<string>;

  // bulk / serialization
  loadFromFile: (data: SerializedMapData) => void;
  getSerializableState: () => SerializedMapData;
  resetToDefault: () => void;
}
