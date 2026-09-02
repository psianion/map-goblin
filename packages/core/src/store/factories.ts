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
  | 'setMapName' | 'setFixedSize' | 'setGridType' | 'setAmbientLight' | 'setEnvironmentSettings' | 'setTerrainData' | 'setTerrainSplats'
  | 'setGridVisible' | 'setSnapEnabled' | 'setSnapDivision'
  | 'addLayer' | 'removeLayer' | 'reorderLayers' | 'updateLayer'
  | 'addChild' | 'removeChild' | 'reorderChild' | 'updateChild' | 'recomputeMergedFloor' | 'bumpFloorTextureEpoch'
  | 'addWall' | 'removeWall' | 'updateWall' | 'setFloorWallEdits' | 'closeAllDoors'
  | 'setRooms' | 'renameRoom'
  | 'setActiveTool' | 'setEraseMode' | 'setRoughMode' | 'setCurveMode' | 'updateToolSettings' | 'addRecentAsset' | 'updateLightDefaults' | 'updateScatterBrushSettings' | 'updateTerrainBrushSettings' | 'updateWaterSettings'
  | 'setNodeEditWall' | 'selectNode' | 'toggleNodeSelection' | 'setShapeNodeEdit' | 'selectVertex' | 'setBandDragStatus'
  | 'setActiveLayerId' | 'setActivePanel' | 'togglePanel' | 'toggleExpandedLayerId'
  | 'showModal' | 'setClipperReady' | 'setFocusMode' | 'setHighlightedRoomId'
  | 'toggleChildGroup' | 'setRevealChildId' | 'setPanelHoverChildId'
  | 'toggleSoloLayer' | 'clearSolo' | 'setPreviewClock' | 'setPreviewSky'
  | 'saveCustomPreset' | 'deleteCustomPreset'
  | 'setSublayerVisibility' | 'setBackgroundTexture' | 'setBackgroundLocked'
  | 'setSelectedIds' | 'setHoveredId' | 'setSelectedRegion'
  | 'setClipboard' | 'setRegionClipboard' | 'setSelectionTransform' | 'bakeSelectionTransform'
  | 'toggleFavorite' | 'trackRecentUse' | 'addCustomUpload' | 'removeCustomUpload'
  | 'setManifest' | 'markCategoryLoaded' | 'addCustomImage' | 'removeCustomImage'
  | 'upsertTrigger' | 'removeTrigger' | 'upsertNote' | 'removeNote'
  | 'loadFromFile' | 'applyAssetNameShim' | 'normalizeChildGroups' | 'getSerializableState' | 'resetToDefault'
  | 'loadMapIndex' | 'saveCurrentMap' | 'loadMap' | 'createNewMap' | 'deleteMap' | 'renameMap' | 'duplicateMap'
  | 'setInstalledPacks' | 'setAvailableUpdates' | 'setIsChecking' | 'setInstallProgress'
  | 'checkForPackUpdates' | 'installPack' | 'updatePack' | 'dismissUpdateResult' | 'uninstallPack'
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
      fixedSize: null,
    },
    grid: {
      visible: true,
      snapEnabled: true,
      snapDivision: 2,
    },
    layers: [bgLayer, dungeonLayer],
    floorTextureEpochs: {},
    tools: {
      activeTool: 'rectangle',
      eraseMode: false,
      roughMode: false,
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
          // White at zero opacity = the brush paints untinted until asked.
          tintColor: '#ffffff',
          tintOpacity: 0,
        },
        water: {
          mode: 'river' as const,
          width: 2,
          textureId: 'water-still-a-01',
          bankTextureId: 'bank-grassy-01-a1',
          flowSpeed: 0.15,
        },
        zone: {
          mode: 'point' as const,
        },
        connector: {
          kind: 'arch' as const,
        },
      },
      recentAssets: [],
      nodeEditWallId: null,
      selectedNodeT: null,
      selectedNodeTs: [],
      shapeNodeEditId: null,
      selectedVertex: null,
      bandDragStatus: null,
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
      childGroupOverrides: [],
      revealChildId: null,
      panelHoverChildId: null,
      solo: null,
      previewClock: null,
      previewSky: null,
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
