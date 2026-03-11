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

// ─── Layers ───────────────────────────────────────────────
export type LayerType = 'dungeon' | 'images' | 'background';

interface BaseLayer {
  id: string;
  name: string;
  type: LayerType;
  visible: boolean;
  locked: boolean;
  opacity: number;
}

export interface ShapeRecord {
  id: string;
  type: 'rectangle' | 'polygon' | 'regularPolygon' | 'path';
  points: [number, number][];
  roughnessEnabled: boolean;
  roughnessAmplitude?: number;
}

export interface WallSegment {
  id: string;
  points: [number, number][];
  blocksLight: boolean;
  color: string;
  width: number;
  roughness: number;
}

export interface SublayerVisibility {
  shadow: boolean;
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
}

export interface DungeonLayer extends BaseLayer {
  type: 'dungeon';
  shapes: ShapeRecord[];
  standaloneWalls: WallSegment[];
  mergedFloor: Polygon[] | null;
  style: DungeonStyle;
  sublayerVisibility: SublayerVisibility;
}

export interface PlacedObject {
  id: string;
  layerId: string;
  objectType: 'asset' | 'image';
  assetId: string;                  // manifest asset ID or custom upload ID
  position: { x: number; y: number };
  rotation: number;                 // radians
  scale: number;                    // uniform scale factor
  tint: string;                     // hex color overlay
  groupId: string | null;
  flipX: boolean;
  flipY: boolean;
}

export interface ImagesLayer extends BaseLayer {
  type: 'images';
  objects: PlacedObject[];
}

export interface BackgroundLayer extends BaseLayer {
  type: 'background';
  backgroundColor: string;
  backgroundTexture: string | null;
  textureScale: number;
  textureTint: string;
  presetLock: boolean;
}

export type Layer = DungeonLayer | ImagesLayer | BackgroundLayer;

// ─── Lights ───────────────────────────────────────────────
export interface Light {
  id: string;
  position: { x: number; y: number };
  color: string;        // hex
  radius: number;       // world units
  intensity: number;    // 0–1
  falloff: 'linear' | 'quadratic';
  name: string;         // display name in layer panel
  visible: boolean;     // visibility toggle
}

// ─── Tools ────────────────────────────────────────────────
export type ToolType =
  | 'select'
  | 'object'
  | 'rectangle'
  | 'polygon'
  | 'regularPolygon'
  | 'path'
  | 'wall'
  | 'light'
  | 'ruler';

export interface ToolSettings {
  brushRadius: number;
  regularPolygon: { sides: number };
  wallBlocksLight: boolean;
  wallWidth: number;
  continuousPlacement: boolean;
}

export interface ToolsSlice {
  activeTool: ToolType;
  eraseMode: boolean;
  roughMode: boolean;
  settings: ToolSettings;
}

// ─── Selection ───────────────────────────────────────────
export interface SelectionClipboard {
  region: [number, number][][];
  style: DungeonStyle;
}

export interface SelectionSlice {
  selectedRegion: [number, number][][] | null;
  clipboard: SelectionClipboard | null;
}

// ─── Style Presets ───────────────────────────────────────
export type StylePresetData = Omit<DungeonStyle, 'roughnessAmplitude' | 'lineWidth'>;

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
  activePanel: 'tools' | 'assets' | 'lights' | 'export';
  activeLayerId: string;
  selectedObjectIds: string[];
  expandedLayerIds: string[];
  canUndo: boolean;
  canRedo: boolean;
  modalState: ModalState | null;
  toastQueue: Toast[];
  clipperReady: boolean;
  customPresets: Record<string, StylePresetData>;
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
  cellWidth: number;    // sprite width / 256 — footprint in grid cells
  cellHeight: number;   // sprite height / 256
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
  recentlyUsed: string[];    // asset IDs, max 10
  favorites: string[];       // asset IDs
  customUploads: AssetRef[];
  setManifest: (manifest: AssetManifest) => void;
  markCategoryLoaded: (categoryId: string) => void;
}

// ─── Command Pattern Types ────────────────────────────────

export interface Command {
  execute(): void;
  undo(): void;
  readonly label: string;
}

export interface UndoSnapshot {
  mergedFloor: [number, number][][] | null;
  shapes: ShapeRecord[];
}

// ─── Serialization ────────────────────────────────────────
export interface SerializedMapData {
  version: '1.0' | '1.1';
  mapSettings: MapSettings;
  grid: Pick<GridConfig, 'visible' | 'snapDivision' | 'style'>;
  layers: Layer[];
  lights: Light[];
  placedObjects: PlacedObject[];       // all placed objects across image layers
  customImages: Record<string, string>; // id → base64 data URL
}

// ─── Top-Level Store ──────────────────────────────────────
export interface MapBuilderStore {
  mapSettings: MapSettings;
  grid: GridConfig;
  layers: Layer[];
  lights: Light[];
  tools: ToolsSlice;
  ui: UISlice;
  assets: AssetsSlice;
  selection: SelectionSlice;

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

  // shape/wall actions
  addShape: (layerId: string, shape: ShapeRecord) => void;
  removeShape: (layerId: string, shapeId: string) => void;
  updateMergedFloor: (layerId: string, merged: Polygon[] | null) => void;
  addWall: (layerId: string, wall: WallSegment) => void;
  removeWall: (layerId: string, wallId: string) => void;

  // light actions
  addLight: (light: Light) => void;
  removeLight: (id: string) => void;
  updateLight: (id: string, patch: Partial<Light>) => void;

  // tool actions
  setActiveTool: (tool: ToolType) => void;
  setEraseMode: (enabled: boolean) => void;
  setRoughMode: (enabled: boolean) => void;
  updateToolSettings: (patch: Partial<ToolSettings>) => void;

  // ui actions
  setActiveLayerId: (id: string) => void;
  setSelectedObjectIds: (ids: string[]) => void;
  setActivePanel: (panel: UISlice['activePanel']) => void;
  togglePanel: (panel: 'left' | 'right') => void;
  pushToast: (toast: Toast) => void;
  dismissToast: (id: string) => void;
  showModal: (modal: ModalState | null) => void;
  setClipperReady: (ready: boolean) => void;

  // asset actions
  toggleFavorite: (assetId: string) => void;
  trackRecentUse: (assetId: string) => void;
  addCustomUpload: (ref: AssetRef) => void;
  removeCustomUpload: (id: string) => void;
  setManifest: (manifest: AssetManifest) => void;
  markCategoryLoaded: (categoryId: string) => void;
  addPlacedObject: (layerId: string, obj: PlacedObject) => void;
  removePlacedObject: (layerId: string, objId: string) => void;
  updatePlacedObject: (layerId: string, objId: string, patch: Partial<PlacedObject>) => void;

  // preset actions
  applyPreset: (layerId: string, presetName: string) => void;
  saveCustomPreset: (name: string, style: Partial<DungeonStyle>) => void;
  deleteCustomPreset: (name: string) => void;

  // sublayer visibility actions
  setSublayerVisibility: (layerId: string, sublayer: keyof SublayerVisibility, visible: boolean) => void;

  // background actions
  setBackgroundTexture: (layerId: string, url: string | null) => void;
  setBackgroundLocked: (layerId: string, locked: boolean) => void;

  // selection actions
  setSelectedRegion: (region: [number, number][][] | null) => void;
  setClipboard: (clipboard: SelectionClipboard | null) => void;

  // bulk / serialization
  loadFromFile: (data: SerializedMapData) => void;
  getSerializableState: () => SerializedMapData;
  resetToDefault: () => void;
}
