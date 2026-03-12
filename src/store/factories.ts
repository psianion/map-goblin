import type {
  BackgroundLayer,
  DungeonLayer,
  DungeonStyle,
  ImagesLayer,
  Light,
  MapBuilderStore,
} from './types.ts';

const DEFAULT_DUNGEON_STYLE: DungeonStyle = {
  floorColor: '#F1ECDF',
  wallColor: '#000000',
  wallWidth: 0.08,
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
};

const DEFAULT_SUBLAYER_VISIBILITY = {
  shadow: true,
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
    shapes: [],
    standaloneWalls: [],
    mergedFloor: null,
    style: { ...DEFAULT_DUNGEON_STYLE },
    sublayerVisibility: { ...DEFAULT_SUBLAYER_VISIBILITY },
  };
}

export function createImagesLayer(name: string): ImagesLayer {
  return {
    id: crypto.randomUUID(),
    name,
    type: 'images',
    visible: true,
    locked: false,
    opacity: 1,
    objects: [],
  };
}

export function createLight(
  position: { x: number; y: number },
  overrides?: Partial<Light>,
): Light {
  return {
    id: crypto.randomUUID(),
    position,
    color: '#ffdd88',
    radius: 6,        // 30 ft at default 5 ft/cell
    featherRadius: 0, // 0% bright zone — falloff starts immediately
    intensity: 0.2,
    falloff: 'quadratic',
    name: 'Light',
    visible: true,
    ...overrides,
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
    textureScale: 1,
    textureTint: '#ffffff',
    presetLock: false,
  };
}

type MapBuilderState = Omit<
  MapBuilderStore,
  | 'setMapName' | 'setGridType' | 'setAmbientLight'
  | 'setGridVisible' | 'setSnapEnabled' | 'setSnapDivision' | 'setGridStyle'
  | 'addLayer' | 'removeLayer' | 'reorderLayers' | 'updateLayer'
  | 'addShape' | 'removeShape' | 'updateMergedFloor' | 'addWall' | 'removeWall'
  | 'addLight' | 'removeLight' | 'updateLight'
  | 'setActiveTool' | 'setEraseMode' | 'setRoughMode' | 'updateToolSettings' | 'addRecentAsset' | 'updateLightDefaults'
  | 'setActiveLayerId' | 'setSelectedObjectIds' | 'setActivePanel' | 'togglePanel'
  | 'pushToast' | 'dismissToast' | 'showModal' | 'setClipperReady'
  | 'applyPreset' | 'saveCustomPreset' | 'deleteCustomPreset'
  | 'setSublayerVisibility' | 'setBackgroundTexture' | 'setBackgroundLocked'
  | 'setSelectedRegion' | 'setClipboard'
  | 'toggleFavorite' | 'trackRecentUse' | 'addCustomUpload' | 'removeCustomUpload'
  | 'setManifest' | 'markCategoryLoaded' | 'addCustomImage'
  | 'addPlacedObject' | 'removePlacedObject' | 'updatePlacedObject'
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
    lights: [],
    tools: {
      activeTool: 'rectangle',
      eraseMode: false,
      roughMode: false,
      settings: {
        brushRadius: 0.5,
        regularPolygon: { sides: 4 },
        wallBlocksLight: true,
        wallWidth: 0.08,
        continuousPlacement: false,
        lightDefaults: {
          color: '#ffdd88',
          radius: 6,
          featherRadius: 0,
          intensity: 0.2,
          falloff: 'quadratic' as const,
        },
      },
      recentAssets: [],
    },
    ui: {
      leftPanelOpen: true,
      rightPanelOpen: true,
      activePanel: 'tools',
      activeLayerId: dungeonLayer.id,
      selectedObjectIds: [],
      expandedLayerIds: [],
      canUndo: false,
      canRedo: false,
      modalState: null,
      toastQueue: [],
      clipperReady: false,
      customPresets: {},
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
      selectedRegion: null,
      clipboard: null,
    },
  };
}
