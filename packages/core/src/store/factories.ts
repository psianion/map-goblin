import type {
  BackgroundLayer,
  DungeonLayer,
  DungeonStyle,
  MapBuilderStore,
} from './types';
import { WATER_BANK_TEXTURE_ID, WATER_TEXTURE_ID } from '../engine/water/waterTextures';

const DEFAULT_DUNGEON_STYLE: DungeonStyle = {
  floorColor: '#F1ECDF',
  wallColor: '#000000',
  wallWidth: 0.5,
  lineWidth: 0.04,
  edgeTransitionWidth: 0.5,
  showEdgeTransitions: true,
  // Zero-setup default: without a texture set the node-wall renderer bails and
  // walls (and the door gaps cut into them) are simply invisible on new maps.
  // Existing saves keep whatever their style says — this only seeds new layers.
  wallTextureSetId: 'GG_Fieldstone',
  wallTextureTint: '#b09878',
  // gg-demo's first drop ships two floor tiles; the small plaster is the seed.
  defaultTextureId: 'gg-demo:floor_small_8x8_floor_A',
};

const DEFAULT_SUBLAYER_VISIBILITY = {
  floor: true,
  grid: true,
  walls: true,
};

/**
 * A fresh dungeon layer. `levelId` may be left out: `addLayer` puts a layer whose
 * level the map does not know on the level being shown.
 */
export function createDungeonLayer(name: string, levelId = ''): DungeonLayer {
  return {
    id: crypto.randomUUID(),
    name,
    type: 'dungeon',
    levelId,
    visible: true,
    locked: false,
    opacity: 1,
    children: [],
    standaloneWalls: [],
    mergedFloor: null,
    style: { ...DEFAULT_DUNGEON_STYLE },
    sublayerVisibility: { ...DEFAULT_SUBLAYER_VISIBILITY },
  };
}

export function createBackgroundLayer(levelId = ''): BackgroundLayer {
  return {
    id: crypto.randomUUID(),
    name: 'Background',
    type: 'background',
    levelId,
    visible: true,
    locked: false,
    opacity: 1,
    backgroundColor: '#2d2d2d',
    backgroundTexture: null,
    textureScale: 0.25,
    textureTint: '#ffffff',
    presetLock: false,
  };
}

type MapBuilderState = Omit<
  MapBuilderStore,
  | 'setMapName' | 'setFixedSize' | 'setCellScale' | 'setAmbientLight' | 'setFogLook' | 'setEnvironmentSettings' | 'setTerrainData' | 'setTerrainSplats'
  | 'setGridVisible' | 'setSnapEnabled' | 'setSnapDivision'
  | 'addLayer' | 'removeLayer' | 'reorderLayers' | 'updateLayer'
  | 'addChild' | 'removeChild' | 'reorderChild' | 'setChildOrder' | 'updateChild' | 'recomputeMergedFloor' | 'bumpFloorTextureEpoch'
  | 'addWall' | 'removeWall' | 'updateWall' | 'setFloorWallEdits' | 'closeAllDoors'
  | 'setRooms' | 'updateRoom' | 'setThresholds' | 'setAreas'
  | 'addLevel' | 'removeLevel' | 'updateLevel' | 'setLayerLevel' | 'reorderLevel'
  | 'setActiveTool' | 'setEraseMode' | 'setCurveMode' | 'updateToolSettings' | 'updateLightDefaults' | 'updateScatterBrushSettings' | 'updateTerrainBrushSettings' | 'updateWaterSettings'
  | 'setNodeEditWall' | 'selectNode' | 'toggleNodeSelection' | 'setShapeNodeEdit' | 'selectVertex'
  | 'setActiveLayerId' | 'togglePanel' | 'toggleExpandedLayerId'
  | 'showModal' | 'setClipperReady' | 'setFocusMode' | 'setHighlightedRoomId'
  | 'toggleChildGroup' | 'setRevealChildId' | 'setPanelHoverChildId'
  | 'toggleSoloLayer' | 'clearSolo' | 'setPreviewClock' | 'setPreviewSky' | 'setPreviewWeather' | 'setRoomOverlayVisible'
  | 'setActiveLevelId' | 'setRoomLabels' | 'setRoomSuggestions' | 'setRoomsSheetOpen' | 'setRoomsSheetRoomId'
  | 'setDividerMode' | 'setRoomWalls' | 'setPendingSplit' | 'setSeeUnderOverhead' | 'setMarqueeFilter' | 'setPropReplaceIds'
  | 'saveCustomPreset' | 'deleteCustomPreset'
  | 'setSublayerVisibility' | 'setBackgroundTexture' | 'setBackgroundLocked'
  | 'setSelectedIds' | 'setHoveredId' | 'setSelectedRegion'
  | 'setClipboard'
  | 'trackRecentUse' | 'toggleFavourite'
  | 'setManifest' | 'markCategoryLoaded' | 'addCustomImage' | 'removeCustomImage'
  | 'upsertTrigger' | 'removeTrigger' | 'upsertNote' | 'removeNote' | 'setRoomKey'
  | 'loadFromFile' | 'applyAssetNameShim' | 'normalizeChildGroups' | 'getSerializableState' | 'resetToDefault'
  | 'loadMapIndex' | 'saveCurrentMap' | 'loadMap' | 'createNewMap' | 'deleteMap' | 'renameMap' | 'duplicateMap'
  | 'setInstalledPacks' | 'refreshInstalledPacks' | 'installPackFromFile' | 'setAvailableUpdates' | 'setIsChecking'
  | 'checkForPackUpdates' | 'installPack' | 'updatePack' | 'dismissUpdateResult' | 'uninstallPack'
>;

export function createDefaultState(): MapBuilderState {
  // A new map starts on one level holding both layers. Named "Level 1" rather than
  // after the map: the map is named after this point, and a level that silently
  // kept "Untitled Map" would read as a bug.
  const level = { id: crypto.randomUUID(), name: 'Level 1' };
  const bgLayer = createBackgroundLayer(level.id);
  const dungeonLayer = createDungeonLayer('Layer 1', level.id);
  return {
    mapSettings: {
      name: 'Untitled Map',
      cellScale: { value: 5, unit: 'ft' },
      ambientLight: '#ffffff',
      fixedSize: null,
      // Born in the anchored-rooms format: nothing to migrate.
      roomsVersion: 2,
    },
    grid: {
      visible: true,
      snapEnabled: true,
      snapDivision: 2,
    },
    layers: [bgLayer, dungeonLayer],
    levels: [level],
    floorTextureEpochs: {},
    tools: {
      activeTool: 'rectangle',
      eraseMode: false,
      curveMode: false,
      settings: {
        brushRadius: 0.5,
        regularPolygon: { sides: 4 },
        wallType: 'normal' as const,
        wallDirection: 'both' as const,
        wallWidth: 0.5,
        continuousPlacement: false,
        lightDefaults: {
          color: '#ffdd88',
          radius: 6,
          featherRadius: 0,
          // 0.2 predates the diffuse-lighting rework: under the multiply
          // composite it reads as no light at all on real (dark) floor art —
          // the "authored lights don't render" gate finding was exactly a
          // fresh light at this default. 0.9 matches the hand-tuned lights
          // that shipped on the demo keep.
          intensity: 0.9,
          falloff: 'quadratic' as const,
        },
        scatterBrush: {
          assetIds: [],
          stampMode: true,
          stampRotation: 0,
          stampScale: 1,
          stampFlipX: false,
          stampVary: false,
          brushRadius: 3,
          // About six props a dab at the default radius, what `count: 5` used to give.
          density: 0.2,
          minSpacing: 0.5,
          rotationRange: [0, Math.PI * 2],
          scaleRange: [0.8, 1.2],
          tints: [],
          randomVariant: true,
          avoidOverlap: true,
          stayOnFloor: true,
          seed: 1,
          placeUnder: false,
        },
        doorStyle: 'single' as const,
        doorSecret: false,
        doorWidth: 1,
        doorAngle: 0,
        terrainBrush: {
          slot: 0,
          radius: 2,
          strength: 0.6,
          // White at zero opacity = the brush paints untinted until asked.
          tintColor: '#ffffff',
          tintOpacity: 0,
        },
        water: {
          mode: 'river' as const,
          width: 2,
          textureId: WATER_TEXTURE_ID,
          bankTextureId: WATER_BANK_TEXTURE_ID,
        },
        zone: {
          mode: 'point' as const,
        },
        label: {
          fontSize: 0.8,
          color: null,
        },
      },
      nodeEditWallId: null,
      selectedNodeT: null,
      selectedNodeTs: [],
      shapeNodeEditId: null,
      selectedVertex: null,
    },
    ui: {
      leftPanelOpen: true,
      rightPanelOpen: true,
      activeLayerId: dungeonLayer.id,
      expandedLayerIds: [],
      canUndo: false,
      canRedo: false,
      modalState: null,
      clipperReady: false,
      focusMode: 'auto' as const,
      highlightedRoomId: null,
      childGroupOverrides: [],
      revealChildId: null,
      panelHoverChildId: null,
      solo: null,
      previewClock: null,
      previewSky: null,
      previewWeather: null,
      roomOverlayVisible: true,
      activeLevelId: level.id,
      roomLabels: 'both' as const,
      roomSuggestions: null,
      roomsSheetOpen: false,
      roomsSheetRoomId: null,
      dividerMode: 'threshold' as const,
      roomWalls: 'with' as const,
      pendingSplit: null,
      seeUnderOverhead: false,
      marqueeFilter: 'all' as const,
      propReplaceIds: null,
    },
    assets: {
      manifest: null,
      loadedCategories: [],
      recentlyUsed: [],
      favourites: [],
      customImages: {},
    },
    selection: {
      selectedIds: [],
      hoveredId: null,
      selectedRegion: null,
      clipboard: null,
    },
    packs: {
      installedPacks: [],
      availableUpdates: [],
      isChecking: false,
      updateCheckError: null,
      activeUpdate: null,
    },
    terrainSplats: {
      pngs: [null, null, null],
      rev: 0,
    },
    mapIndex: [],
    activeMapId: null,
    isMapSwitching: false,
    prep: null,
  };
}
