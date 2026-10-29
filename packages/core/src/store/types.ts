export * from '../shared/types';
export * from '../shared/prep';
export * from '../shared/world';
export * from '../shared/fogLook';
import type {
  AnyChild,
  WallSegment,
  WallEdits,
  WallType,
  WallDirection,
  DoorStyle,
  Level,
  LightChild,
  Room,
  RoomArea,
  RoomLook,
  ThresholdSegment,
} from '../shared/types';
import type { RoomKey, RoomNote, ScenePrep, TriggerDef, Weather } from '../shared/prep';
import type { LightPresetId } from './lightPresets';
import type { MapEnvironment, NightSky } from '../shared/world';
import type { FogLook } from '../shared/fogLook';
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

/**
 * `MapEnvironment` is the world half — environment type, time palette, natural light,
 * orientation, time mode (`shared/world.ts`). Every field of it is optional, so a map saved
 * before the world clock existed reads as an indoor map on the default palette and nothing
 * about it moves when the campaign's clock does.
 */
export interface MapSettings extends MapEnvironment {
  name: string;
  cellScale: { value: number; unit: string };
  /** The map's mood tint — the base of the grade, "this world in neutral daylight". */
  ambientLight: string;
  /** Authored default for the living-fog cloud (D7). Absent ⇒ the shader's own
   * `DEFAULT_FOG_LOOK` (session/client/src/modules/fog/livingFog.ts) — matches every other
   * optional field here, a pre-fog save just reads as never having set one. */
  fogLook?: FogLook;
  /** Optional — absent on maps that never painted terrain (and on pre-terrain saves). */
  terrain?: TerrainData;
  /**
   * A minimum map frame the DM pinned, in cells, anchored at the origin. null/absent — the
   * normal state — measures the frame from content alone (`shared/mapBounds.computeMapFrame`).
   * Nothing clamps to it: drawing past a pinned edge grows the frame out on that side, so
   * the frame always encloses everything drawn.
   */
  fixedSize?: { width: number; height: number } | null;
  /**
   * 2 once `store/roomMigration.ts` has turned the map's rooms into anchored places
   * (and given it levels). Absent on every older file, which is what runs the migration.
   */
  roomsVersion?: 2;
  /** The room the table starts in by default; the publish dialog preselects it. */
  startingRoomId?: string;
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
  /**
   * The `Level` this layer belongs to. Every layer has one: a map opened without
   * levels gets a single level holding them all (roomMigration), and a layer added
   * with an id that names no level lands in the active one (`addLayer`).
   */
  levelId: string;
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
  lineWidth: number;
  defaultTextureId?: string;
  /**
   * The tint new textured floors start with: the Floor colour last picked in the dock.
   * Absent, a new floor takes the tint of the last textured floor drawn (else white).
   */
  defaultTextureTint?: string;
  edgeTransitionWidth: number;
  showEdgeTransitions: boolean;
  wallTextureSetId?: string;
  wallTextureTint: string;
  /**
   * How far past the authored boundary the floor is PAINTED, in world units.
   * Render only — the boundary itself does not move, so sight, rooms, doors and
   * hit tests are untouched.
   *
   * For a wall drawn as scattered art rather than composed stones (a cave band),
   * the rock straddles the floor edge and hides whatever is under it. Painting
   * the floor to exactly the boundary means any sub-cell shortfall in that art
   * shows as a hairline of void between floor and rock. Letting the paint run on
   * underneath the rock removes the whole class of gap: the worst a shortfall can
   * then reveal is more floor.
   *
   * Undefined or 0 keeps the crisp authored edge, which is what a wall-texture-set
   * layer wants — there the floor edge IS the visible edge.
   */
  floorBleed?: number;
}

/**
 * A named set of children inside one dungeon layer. `merged` means the set
 * behaves as one atomic object (one panel row, always selected whole); a plain
 * group is a folder whose members stay individually editable.
 */
export interface ChildGroupInfo {
  id: string;
  name: string;
  merged?: boolean;
}

export interface DungeonLayer extends BaseLayer {
  type: 'dungeon';
  children: AnyChild[];
  /** Group metadata; membership lives on each child's `groupId`. */
  groups?: ChildGroupInfo[];
  standaloneWalls: WallSegment[];
  mergedFloor: Polygon[] | null;
  style: DungeonStyle;
  sublayerVisibility: SublayerVisibility;
  /**
   * The layer's rooms: authored places (id, name, number, anchor, look). Their faces
   * are derived from the geometry by `syncRooms` and stripped on save.
   */
  rooms?: Room[];
  /** Divider lines that cut room faces apart and block nothing. */
  thresholds?: ThresholdSegment[];
  /** Named groups of this layer's rooms; membership lives on `Room.areaId`. */
  areas?: RoomArea[];
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
  /** The preset tile last picked in the Lights dock (store/lightPresets.ts). Absent = none. */
  presetId?: LightPresetId;
  // The optional light fields the next light is placed with (see LightChild).
  cone?: LightChild['cone'];
  animation?: LightChild['animation'];
  throughWalls?: boolean;
  nightOnly?: LightChild['nightOnly'];
  darkness?: boolean;
  darkvisionSees?: boolean;
}

export type ToolType =
  | 'select'
  | 'pan'
  | 'rectangle'
  | 'polygon'
  | 'regularPolygon'
  | 'path'
  | 'wall'
  | 'door'
  | 'light'
  | 'ruler'
  | 'scatterBrush'
  | 'terrain'
  | 'water'
  | 'text'
  | 'zone'
  /** Draws a rectangle floor and the room on it in one gesture. */
  | 'roomRect'
  /** Draws a polygon floor and the room on it in one gesture. */
  | 'roomPolygon'
  /** Draws a threshold (or a wall) across a floor to split a room. */
  | 'divide';

export interface TerrainBrushSettings {
  /** Active palette slot index (0-5). */
  slot: number;
  /** Brush radius in world units (grid cells). */
  radius: number;
  /** Paint opacity/flow per stamp, 0-1. */
  strength: number;
  /**
   * Brush tint colour. Like a light's colour, each stroke keeps the tint it
   * was painted with — changing this only affects strokes from here on.
   */
  tintColor: string;
  /** How strongly the tint colours the stroke, 0-1. 0 paints untinted. */
  tintOpacity: number;
}

export interface WaterToolSettings {
  mode: 'river' | 'lake';
  /** River stroke width in world units. */
  width: number;
  textureId: string;
  bankTextureId: string;
}

export interface ZoneToolSettings {
  mode: 'point' | 'circle' | 'rect';
}

/** What the next label placed by the label tool looks like. */
export interface LabelToolSettings {
  /** World units (grid cells). */
  fontSize: number;
  /** Null takes the active layer's wall colour, so a label matches the ink it sits beside. */
  color: string | null;
}

/** The Props tool: Stamp and Scatter share the library and these settings. */
export interface ScatterBrushSettings {
  /** Stamp: [the prop]. Scatter: the pool. */
  assetIds: string[];
  stampMode: boolean;
  /** Radians, [0, 2π). Wheel ±15°, right-click +90°, reset on a new pick. */
  stampRotation: number;
  /** 0.25..4. Alt+wheel ×/÷1.1; the dock Scale slider writes it. */
  stampScale: number;
  /** Mirror (F). */
  stampFlipX: boolean;
  /** Each stamp re-rolls the next ghost's variant within its family. */
  stampVary: boolean;
  /** 0.5..10. */
  brushRadius: number;
  /** Props per square cell inside the brush, 0.05..1.5. */
  density: number;
  minSpacing: number;
  /** Radians. */
  rotationRange: [number, number];
  scaleRange: [number, number];
  /** Up to 4; empty = untinted. */
  tints: string[];
  randomVariant: boolean;
  avoidOverlap: boolean;
  stayOnFloor: boolean;
  /** Re-roll writes a new one; the same seed replays a stroke exactly. */
  seed: number;
  /** New props go under the layer's existing props. */
  placeUnder: boolean;
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
  label: LabelToolSettings;
}

export interface ToolsSlice {
  activeTool: ToolType;
  eraseMode: boolean;
  /** Wall/path chains commit as Catmull-Rom curves through the clicked anchors. */
  curveMode: boolean;
  settings: ToolSettings;
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
  /**
   * What the cave-band solver just answered, for the status bar. Ephemeral and
   * never saved: it lives for one gesture, so nothing that reads a map ever
   * sees it.
   */
  bandDragStatus: BandDragStatus | null;
}

/**
 * Either the stretch the kit would lay, or why it will not.
 *
 * `kitPull` is how far the kit dragged the handle off the cursor — the number
 * that tells a DM whether the constraint is helping or fighting.
 */
export type BandDragStatus =
  | { pieces: string[]; kitPull: number }
  | { refusal: string };

// ─── Selection ───────────────────────────────────────────
export interface ChildClipboard {
  children: AnyChild[];
}

export interface SelectionSlice {
  selectedIds: string[];
  hoveredId: string | null;
  clipboard: ChildClipboard | null;
  selectedRegion: [number, number][][] | null;
}

// ─── UI ───────────────────────────────────────────────────

/** Suggest's proposals for one layer. */
export interface RoomSuggestions {
  layerId: string;
  rooms: Room[];
}

export interface ModalState {
  type: 'shortcutReference' | 'newMap' | 'importMaps';
  props: Record<string, unknown>;
}

export interface UISlice {
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
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
   * Layer-panel child-group expand overrides, keys "layerId:childType" —
   * deviations from the per-type default (see isChildGroupExpanded).
   * View state: not persisted, not undoable.
   */
  childGroupOverrides: string[];
  /** One-shot scroll-into-view marker for a layer-panel child row. */
  revealChildId: string | null;
  /** Child outlined on canvas because its layer-panel row is hovered. */
  panelHoverChildId: string | null;
  /**
   * Alt-click-eye "solo" state — not persisted, not undoable (same tier as
   * activeLayerId). A render-only override: it never writes a layer's own
   * `visible` flag. Consumers gate on `isLayerEffectivelyVisible` (see
   * store/selectors.ts) instead of reading `layer.visible` directly.
   */
  solo: { layerId: string } | null;
  /**
   * The Editor's day-scrub preview clock, minutes 0-1439 — local, never persisted and never
   * sent anywhere (the plan's "Editor preview clock must not leak into campaign state"). Null
   * is "not scrubbing": the map is drawn at its own time, which is `fixedTime` on a fixed map
   * and midday on one that follows the clock it cannot see from here.
   */
  previewClock: number | null;
  /**
   * The Editor's preview of the campaign's night sky — same tier as `previewClock`: local,
   * never persisted, never sent anywhere. Null is "not previewing": the Editor draws under
   * the default full moon, same as an untouched campaign does at the Table.
   */
  previewSky: NightSky | null;
  /** The Editor's preview of the table's weather — same tier as `previewSky`. Null = the map's default. */
  previewWeather: Weather | null;
  /**
   * Whether the authored room/connector ink is drawn while neither authoring tool is
   * held (canvas/src/canvas/roomConnectorOverlay.ts). Same tier as `grid.visible`: a
   * view preference, not persisted, not undoable, never serialized — the DM turning
   * the loops off to look at their art is not an edit to the map.
   *
   * It governs the idle case only. The room and door tools force the ink back on
   * for as long as they are held, because drawing a room you cannot see is not a thing
   * anyone asked for.
   */
  roomOverlayVisible: boolean;
  /**
   * The level the editor is showing. `activeLayerId` always belongs to it: switching
   * level selects its first layer, selecting a layer switches to its level.
   */
  activeLevelId: string;
  /** What the room overlay writes on each room. Persisted as a view preference. */
  roomLabels: 'off' | 'numbers' | 'both';
  /**
   * Suggest's proposals, shown as ghosts until accepted or dismissed, with the layer
   * they were made on: accepting adds them there, whatever layer is active by then.
   * Never saved.
   */
  roomSuggestions: RoomSuggestions | null;
  /** Whether the rooms list sheet is open. Persisted as a view preference. */
  roomsSheetOpen: boolean;
  /** The room whose key the sheet is showing; null shows the list. */
  roomsSheetRoomId: string | null;
  /** What the Divide tool writes: a threshold, or a real wall. Persisted as a view preference. */
  dividerMode: 'threshold' | 'wall';
  /** Whether a drawn room gets stones round its floor. Persisted as a view preference. */
  roomWalls: 'with' | 'none';
  /**
   * A Divide stroke that cut one room's face in two, waiting for the split dialog to
   * say which half keeps the id. Set by the Divide tool, cleared by the dialog
   * (commit or cancel). View state: never saved, never undoable.
   */
  pendingSplit: PendingSplit | null;
  /**
   * Fade every overhead prop and let clicks reach what is under it. Persisted as a
   * view preference; never saved with the map.
   */
  seeUnderOverhead: boolean;
  /** The props browser is replacing these props; null when it is not. View state. */
  propReplaceIds: string[] | null;
}

/** A Divide cut across one room's face: the threshold and the two faces it makes, larger first. */
export interface PendingSplit {
  layerId: string;
  roomId: string;
  threshold: ThresholdSegment;
  halves: [[number, number][], [number, number][]];
}

// ─── Assets ───────────────────────────────────────────────
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
  /** Starred props, the DM's not the map's (persisted per browser like the recents). */
  favourites: string[];
  customImages: Record<string, string>;
}

// ─── Terrain splat bitmaps ───────────────────────────────
/**
 * PNG-encoded splat bitmaps, held as binary Blobs outside the serialized
 * document. Base64 for the .mapbuilder format is produced in the save worker
 * at save time — data URLs of the splats never exist on the main thread.
 */
export interface TerrainSplatsSlice {
  /** Index = splatmap (weights 0-1, tint layer 2). null = blank/never painted. */
  pngs: [Blob | null, Blob | null, Blob | null];
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

/**
 * An update the DM has started, and how it ended.
 *
 * One field rather than three (running / result / error) because those three states are
 * mutually exclusive and separate fields let them contradict — a stale success line
 * sitting under a failed retry. One pack updates at a time in this UI, so one slot holds.
 */
export interface PackUpdateState {
  packId: string;
  status: 'running' | 'done' | 'error';
  /** status 'done': what actually came down the wire, the point of the whole exercise. */
  changedFiles?: number;
  downloadedBytes?: number;
  version?: string;
  /** status 'error': what happened, in words a DM mid-session can act on. */
  message?: string;
}

export interface PacksSlice {
  installedPacks: PackSummary[];
  availableUpdates: PackUpdateInfo[];
  isChecking: boolean;
  activeUpdate: PackUpdateState | null;
}

// ─── Maps (Multi-Map Persistence) ────────────────────────
export interface MapMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  gridSize: { width: number; height: number };
  layerCount: number;
  /** A small JPEG of the map as of its last save, for its card. Absent until one is taken. */
  thumbnail?: Blob;
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
   * The map's levels. Absent on files from before levels existed; the room migration
   * gives those one level holding every layer.
   */
  levels?: Level[];
  /**
   * The map's confining rectangle (shared/mapBounds.computeMapFrame), stamped on by the
   * session server when it redacts a document for a player: the fog has to cover the
   * *full* map's frame, and a player's layers no longer measure it. Absent on authored
   * files and on the DM's copy — both can measure their own.
   */
  frame?: { minX: number; minY: number; maxX: number; maxY: number } | null;
  /**
   * The auto-explore lock zones this seat is allowed to know about, as one bit per cell
   * (mechanics' `RegionMask`, structurally — spelled out here for the reason `frame` is:
   * core does not depend on mechanics). Stamped by the session server beside `frame` on a
   * player's vision-mode cut when the map locks any ground the seat holds art for; the
   * player's mask subtracts it from the range-earned term of contained sight, which is the
   * only way that seat can know about a zone it is never sent. Absent on authored files and
   * on the DM's copy — the DM reads the real zones.
   */
  lockMask?: { minX: number; minY: number; cols: number; rows: number; bits: string };
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
  /** Named groups of layers, each with its own look. Never empty. */
  levels: Level[];
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

  /**
   * Per-layer counter bumped when a pack texture a floor bake needed lands
   * after the bake ran (file import resolves textures after loadFromFile;
   * CDN install-by-need is slower still). Rides into the render key so the
   * bake re-runs. Session-local — never serialized into map files.
   */
  floorTextureEpochs: Record<string, number>;

  // mapSettings actions
  setMapName: (name: string) => void;
  setFixedSize: (size: MapSettings['fixedSize']) => void;
  setCellScale: (scale: MapSettings['cellScale']) => void;
  setAmbientLight: (color: string) => void;
  setFogLook: (look: FogLook | undefined) => void;
  setEnvironmentSettings: (patch: Partial<MapEnvironment>) => void;
  setTerrainData: (patch: Partial<TerrainData>) => void;
  setTerrainSplats: (pngs: [Blob | null, Blob | null, Blob | null]) => void;

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
  /** Appends the child, or inserts it at `index` (placing under, an undone delete). */
  addChild: (layerId: string, child: AnyChild, index?: number) => void;
  bumpFloorTextureEpoch: (layerId: string) => void;
  removeChild: (layerId: string, childId: string) => void;
  reorderChild: (layerId: string, fromIndex: number, toIndex: number) => void;
  /**
   * Reorders `children` to `ids`: unknown ids are ignored, and a child missing from
   * `ids` keeps its index. Z-order edits go through `ChildOrderCommand`.
   */
  setChildOrder: (layerId: string, ids: string[]) => void;
  updateChild: (layerId: string, childId: string, patch: Partial<AnyChild>) => void;
  recomputeMergedFloor: (layerId: string) => void;

  // wall actions (sublayer detail)
  /** Appends the wall, or inserts it at `index` (an undone delete going back where it was). */
  addWall: (layerId: string, wall: WallSegment, index?: number) => void;
  removeWall: (layerId: string, wallId: string) => void;
  updateWall: (layerId: string, wallId: string, updates: Partial<WallSegment>) => void;
  setFloorWallEdits: (layerId: string, ringKey: string, edits: WallEdits | undefined) => void;
  closeAllDoors: (layerId: string) => void;

  // room actions — raw writes; edits go through the room commands (store/commands.ts)
  setRooms: (layerId: string, rooms: Room[]) => void;
  /** Merges `patch` into one room; a key set to `undefined` is removed. */
  updateRoom: (layerId: string, roomId: string, patch: Partial<Room>) => void;
  setThresholds: (layerId: string, thresholds: ThresholdSegment[]) => void;
  setAreas: (layerId: string, areas: RoomArea[]) => void;

  // level actions — raw writes; edits go through the level commands
  /** Appends the level, or inserts it at `index`. */
  addLevel: (level: Level, index?: number) => void;
  removeLevel: (levelId: string) => void;
  updateLevel: (levelId: string, patch: { name?: string; look?: RoomLook }) => void;
  setLayerLevel: (layerId: string, levelId: string) => void;

  // tool actions
  setActiveTool: (tool: ToolType) => void;
  setEraseMode: (enabled: boolean) => void;
  setCurveMode: (enabled: boolean) => void;
  updateToolSettings: (patch: Partial<ToolSettings>) => void;
  updateLightDefaults: (patch: Partial<LightDefaults>) => void;
  updateScatterBrushSettings: (patch: Partial<ScatterBrushSettings>) => void;
  updateTerrainBrushSettings: (patch: Partial<TerrainBrushSettings>) => void;
  updateWaterSettings: (patch: Partial<WaterToolSettings>) => void;
  setNodeEditWall: (wallId: string | null) => void;
  selectNode: (t: number | null) => void;
  toggleNodeSelection: (t: number) => void;
  setShapeNodeEdit: (shapeId: string | null) => void;
  selectVertex: (index: number | null) => void;
  setBandDragStatus: (status: BandDragStatus | null) => void;

  // ui actions
  setActiveLayerId: (id: string) => void;
  togglePanel: (panel: 'left' | 'right') => void;
  toggleExpandedLayerId: (layerId: string) => void;
  showModal: (modal: ModalState | null) => void;
  setClipperReady: (ready: boolean) => void;
  setFocusMode: (mode: UISlice['focusMode']) => void;
  setHighlightedRoomId: (roomId: string | null) => void;
  toggleChildGroup: (key: string) => void;
  setRevealChildId: (id: string | null) => void;
  setPanelHoverChildId: (id: string | null) => void;
  toggleSoloLayer: (id: string) => void;
  /** Drops solo bookkeeping without touching any layer's visibility. */
  clearSolo: () => void;
  setPreviewClock: (minutes: number | null) => void;
  setPreviewSky: (sky: NightSky | null) => void;
  setPreviewWeather: (weather: Weather | null) => void;
  setRoomOverlayVisible: (visible: boolean) => void;
  /** Shows a level; selects its first layer when the active one is elsewhere. */
  setActiveLevelId: (levelId: string) => void;
  setRoomLabels: (labels: UISlice['roomLabels']) => void;
  setRoomSuggestions: (suggestions: RoomSuggestions | null) => void;
  setRoomsSheetOpen: (open: boolean) => void;
  setRoomsSheetRoomId: (roomId: string | null) => void;
  setDividerMode: (mode: UISlice['dividerMode']) => void;
  setRoomWalls: (walls: UISlice['roomWalls']) => void;
  setPendingSplit: (split: PendingSplit | null) => void;
  setSeeUnderOverhead: (on: boolean) => void;
  setPropReplaceIds: (ids: string[] | null) => void;

  // asset actions
  trackRecentUse: (assetId: string) => void;
  /** Stars a prop, or unstars it. */
  toggleFavourite: (assetId: string) => void;
  setManifest: (manifest: AssetManifest) => void;
  markCategoryLoaded: (categoryId: string) => void;
  addCustomImage: (id: string, base64: string) => void;
  removeCustomImage: (id: string) => void;

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

  // packs actions
  setInstalledPacks: (packs: PackSummary[]) => void;
  setAvailableUpdates: (updates: PackUpdateInfo[]) => void;
  setIsChecking: (checking: boolean) => void;
  checkForPackUpdates: () => Promise<void>;
  installPack: (packId: string) => Promise<void>;
  updatePack: (packId: string) => Promise<void>;
  dismissUpdateResult: () => void;
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
  upsertNote: (note: RoomNote) => void;
  removeNote: (noteId: string) => void;
  setRoomKey: (roomId: string, key: RoomKey | null) => void;

  // bulk / serialization
  loadFromFile: (data: SerializedMapData, splatPngs?: [Blob | null, Blob | null, Blob | null]) => void;
  /** Rename pre-naming-era "Asset" children from the catalog (read-boundary shim). */
  applyAssetNameShim: () => void;
  normalizeChildGroups: () => void;
  getSerializableState: () => SerializedMapData;
  resetToDefault: () => void;
}
