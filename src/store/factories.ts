import type {
  BackgroundLayer,
  DungeonLayer,
  DungeonStyle,
  MapBuilderStore,
} from './types.ts';

const DEFAULT_DUNGEON_STYLE: DungeonStyle = {
  floorColor: '#F1ECDF',
  wallColor: '#000000',
  wallWidth: 0.5,
  shadowEnabled: true,
  shadowColor: '#8C867D',
  shadowOffset: { x: 0.4, y: 0.3 },
  shadowIntensity: 0.4,
  hatchingStyle: 'none',
  hatchingBandWidth: 1.0,
  hatchingLineSpacing: 0.3,
  hatchingLineThickness: 0.02,
  hatchingAngle: 45,
  hatchingInverted: false,
  roughnessAmplitude: 0,
  lineWidth: 0.04,
  edgeTransitionWidth: 0.5,
  showEdgeTransitions: true,
  wallTextureTint: '#ffffff',
};

const DEFAULT_SUBLAYER_VISIBILITY = {
  floor: true,
  grid: true,
  hatching: true,
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
  | 'setMapName' | 'setGridType' | 'setAmbientLight'
  | 'setGridVisible' | 'setSnapEnabled' | 'setSnapDivision' | 'setGridStyle'
  | 'addLayer' | 'removeLayer' | 'reorderLayers' | 'updateLayer'
  | 'addChild' | 'removeChild' | 'reorderChild' | 'updateChild' | 'recomputeMergedFloor'
  | 'addWall' | 'removeWall'
  | 'setActiveTool' | 'setEraseMode' | 'setRoughMode' | 'updateToolSettings' | 'addRecentAsset' | 'updateLightDefaults'
  | 'setActiveLayerId' | 'setActivePanel' | 'togglePanel' | 'toggleExpandedLayerId'
  | 'pushToast' | 'dismissToast' | 'showModal' | 'setClipperReady' | 'setFocusMode'
  | 'applyPreset' | 'saveCustomPreset' | 'deleteCustomPreset'
  | 'setSublayerVisibility' | 'setBackgroundTexture' | 'setBackgroundLocked'
  | 'setSelectedIds' | 'setHoveredId' | 'setSelectedRegion'
  | 'setClipboard' | 'setRegionClipboard' | 'setSelectionTransform' | 'bakeSelectionTransform'
  | 'toggleFavorite' | 'trackRecentUse' | 'addCustomUpload' | 'removeCustomUpload'
  | 'setManifest' | 'markCategoryLoaded' | 'addCustomImage'
  | 'loadFromFile' | 'getSerializableState' | 'resetToDefault'
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
      style: 'dotted',
    },
    layers: [bgLayer, dungeonLayer],
    tools: {
      activeTool: 'rectangle',
      eraseMode: false,
      roughMode: false,
      settings: {
        brushRadius: 0.5,
        regularPolygon: { sides: 4 },
        wallBlocksLight: true,
        wallWidth: 0.5,
        continuousPlacement: false,
        lightDefaults: {
          color: '#ffdd88',
          radius: 6,
          featherRadius: 0,
          intensity: 0.2,
          falloff: 'quadratic' as const,
        },
        scatterBrush: {
          assetIds: [],
          brushRadius: 2,
          density: 0.8,
          spacing: 1,
          rotationRange: [0, Math.PI * 2],
          scaleRange: [0.8, 1.2],
        },
      },
      recentAssets: [],
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
      toastQueue: [],
      clipperReady: false,
      customPresets: {},
      focusMode: 'auto' as const,
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
  };
}
