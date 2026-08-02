import type {
  BackgroundLayer,
  DungeonLayer,
  DungeonStyle,
  MapBuilderStore,
} from './types';

const DEFAULT_DUNGEON_STYLE: DungeonStyle = {
  floorColor: '#F1ECDF',
  wallColor: '#000000',
  wallWidth: 0.5,
  shadowEnabled: true,
  shadowColor: '#8C867D',
  shadowOffset: { x: 0.4, y: 0.3 },
  shadowIntensity: 0.4,
  roughnessAmplitude: 0,
  lineWidth: 0.04,
  edgeTransitionWidth: 0.5,
  showEdgeTransitions: true,
  // Zero-setup default: without a texture set the node-wall renderer bails and
  // walls (and the door gaps cut into them) are simply invisible on new maps.
  // Existing saves keep whatever their style says — this only seeds new layers.
  wallTextureSetId: 'stone-slate',
  wallTextureTint: '#ffffff',
};

const DEFAULT_SUBLAYER_VISIBILITY = {
  floor: true,
  grid: true,
  walls: true,
};

export function createDungeonLayer(name: string): DungeonLayer {
  return {
    id: crypto.randomUUID(),
    name,
    type: 'dungeon',
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

export function createBackgroundLayer(): BackgroundLayer {
  return {
    id: crypto.randomUUID(),
    name: 'Background',
    type: 'background',
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
  | 'setMapName' | 'setGridType' | 'setAmbientLight' | 'setTerrainData'
  | 'setGridVisible' | 'setSnapEnabled' | 'setSnapDivision'
  | 'addLayer' | 'removeLayer' | 'reorderLayers' | 'updateLayer'
  | 'addChild' | 'removeChild' | 'reorderChild' | 'updateChild' | 'recomputeMergedFloor'
  | 'addWall' | 'removeWall' | 'updateWall' | 'setFloorWallEdits' | 'closeAllDoors'
  | 'setRooms' | 'renameRoom'
  | 'setActiveTool' | 'setEraseMode' | 'setRoughMode' | 'updateToolSettings' | 'addRecentAsset' | 'updateLightDefaults' | 'updateScatterBrushSettings' | 'updateTerrainBrushSettings' | 'updateWaterSettings'
  | 'setNodeEditWall' | 'selectNode' | 'setShapeNodeEdit' | 'selectVertex'
  | 'setActiveLayerId' | 'setActivePanel' | 'togglePanel' | 'toggleExpandedLayerId'
  | 'showModal' | 'setClipperReady' | 'setFocusMode' | 'setHighlightedRoomId'
  | 'saveCustomPreset' | 'deleteCustomPreset'
  | 'setSublayerVisibility' | 'setBackgroundTexture' | 'setBackgroundLocked'
  | 'setSelectedIds' | 'setHoveredId' | 'setSelectedRegion'
  | 'setClipboard' | 'setRegionClipboard' | 'setSelectionTransform' | 'bakeSelectionTransform'
  | 'toggleFavorite' | 'trackRecentUse' | 'addCustomUpload' | 'removeCustomUpload'
  | 'setManifest' | 'markCategoryLoaded' | 'addCustomImage'
  | 'loadFromFile' | 'getSerializableState' | 'resetToDefault'
  | 'loadMapIndex' | 'saveCurrentMap' | 'loadMap' | 'createNewMap' | 'deleteMap' | 'renameMap' | 'duplicateMap'
  | 'setInstalledPacks' | 'setAvailableUpdates' | 'setIsChecking' | 'setInstallProgress'
  | 'checkForPackUpdates' | 'installPack' | 'uninstallPack'
>;

export function createDefaultState(): MapBuilderState {
  const bgLayer = createBackgroundLayer();
  const dungeonLayer = createDungeonLayer('Layer 1');
  return {
    mapSettings: {
      name: 'Untitled Map',
      gridType: 'square',
      cellScale: { value: 5, unit: 'ft' },
      ambientLight: '#2d2d44',
    },
    grid: {
      visible: true,
      snapEnabled: true,
      snapDivision: 2,
    },
    layers: [bgLayer, dungeonLayer],
    tools: {
      activeTool: 'rectangle',
      eraseMode: false,
      roughMode: false,
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
          intensity: 0.2,
          falloff: 'quadratic' as const,
          flicker: false,
          flickerIntensity: 0.3,
          flickerSpeed: 1.5,
        },
        scatterBrush: {
          assetIds: [],
          brushRadius: 3,
          count: 5,
          minSpacing: 0.8,
          stampMode: true,
          rotationRange: [0, Math.PI * 2],
          scaleRange: [0.8, 1.2],
        },
        doorStyle: 'single' as const,
        doorSecret: false,
        doorWidth: 1,
        terrainBrush: {
          slot: 0,
          radius: 2,
          strength: 0.6,
        },
        water: {
          mode: 'river' as const,
          width: 2,
          textureId: 'water-still-a-01',
          bankTextureId: 'bank-grassy-01-a1',
          flowSpeed: 0.15,
        },
      },
      recentAssets: [],
      nodeEditWallId: null,
      selectedNodeT: null,
      shapeNodeEditId: null,
      selectedVertex: null,
    },
    ui: {
      leftPanelOpen: true,
      rightPanelOpen: true,
      activePanel: 'tools',
      activeLayerId: dungeonLayer.id,
      expandedLayerIds: [],
      canUndo: false,
      canRedo: false,
      modalState: null,
      clipperReady: false,
      focusMode: 'auto' as const,
      highlightedRoomId: null,
    },
    assets: {
      manifest: null,
      loadedCategories: [],
      favorites: [],
      recentlyUsed: [],
      customUploads: [],
      customImages: {},
    },
    selection: {
      selectedIds: [],
      hoveredId: null,
      selectedRegion: null,
      clipboard: null,
      regionClipboard: null,
      selectionTransform: null,
    },
    packs: {
      installedPacks: [],
      availableUpdates: [],
      isChecking: false,
      installProgress: null,
    },
    mapIndex: [],
    activeMapId: null,
    isMapSwitching: false,
  };
}
