import { Container, Graphics, RenderTexture, Sprite } from 'pixi.js';
import type { RenderEngine } from './RenderEngine';
import { GridRenderer } from './grid/GridRenderer';
import { ToolManager } from './tools/ToolManager';
import { LightingRenderer } from './lighting';
import { initToolPreview } from './toolPreview';

export interface SceneGraph {
  worldContainer: Container;
  overlayContainer: Container;
  backgroundLayer: Container;
  layerContainer: Container;
  previewContainer: Container;
  gridRenderer: GridRenderer;
  toolManager: ToolManager;
  lightingRenderer: LightingRenderer;
}

export interface DungeonSublayers {
  floor: Container;
  grid: Container;
  hatching: Container;
  walls: Container;
}

export interface LayerEntry {
  id: string;
  type: 'dungeon' | 'background';
  container: Container;
  sublayers: DungeonSublayers | null;
  /** RenderTexture for blend-mode isolation (dungeon layers only) */
  renderTexture: RenderTexture | null;
  /** Sprite that displays the RenderTexture result */
  textureSprite: Sprite | null;
  dirtyFlag: boolean;
}

const layerEntries = new Map<string, LayerEntry>();

export function getLayerEntries(): Map<string, LayerEntry> {
  return layerEntries;
}

export function getLayerEntry(id: string): LayerEntry | undefined {
  return layerEntries.get(id);
}

/**
 * Build the initial scene graph hierarchy.
 * Called once during engine initialization.
 *
 * Hierarchy:
 *   app.stage
 *     ├── worldContainer (camera-transformed)
 *     │     ├── backgroundLayer
 *     │     ├── layerContainer
 *     │     │     └── (per-layer containers added dynamically)
 *     └── overlayContainer (screen-space, not camera-transformed)
 *           └── lightingComposite (LightingRenderer FBO sprite)
 */
export function buildSceneGraph(engine: RenderEngine): SceneGraph {
  const worldContainer = engine.stage();
  worldContainer.label = 'worldContainer';

  const overlayContainer = engine.overlay();
  overlayContainer.label = 'overlayContainer';

  const backgroundLayer = new Container();
  backgroundLayer.label = 'backgroundLayer';
  worldContainer.addChild(backgroundLayer);

  // Grid renderer — persistent background grid behind all layers
  const gridRenderer = new GridRenderer();
  worldContainer.addChild(gridRenderer.container);

  const layerContainer = new Container();
  layerContainer.label = 'layerContainer';
  worldContainer.addChild(layerContainer);

  // Preview container — stamp/scatter tool preview sprites rendered here
  const previewContainer = new Container();
  previewContainer.label = 'previewContainer';
  worldContainer.addChild(previewContainer);

  // Tool manager — handles drawing tools and preview rendering
  const toolManager = new ToolManager(worldContainer);

  // Tool settings preview — ghost shape shown while editing tool popover
  const settingsPreview = new Graphics();
  worldContainer.addChild(settingsPreview);
  initToolPreview(settingsPreview);

  // Lighting renderer — FBO-based compositing pass
  const vp = engine.viewport();
  const lightingRenderer = new LightingRenderer(engine, vp.width, vp.height);
  // LightingRenderer constructor adds compositingSprite to engine.overlay() internally

  return {
    worldContainer,
    overlayContainer,
    backgroundLayer,
    layerContainer,
    previewContainer,
    gridRenderer,
    toolManager,
    lightingRenderer,
  };
}

/**
 * Add a layer to the scene graph.
 * Dungeon layers get RenderTexture wrapping for blend-mode isolation.
 */
export function addLayerToScene(
  _engine: RenderEngine,
  sceneGraph: SceneGraph,
  layerId: string,
  layerType: 'dungeon' | 'background',
  index?: number,
): LayerEntry {
  const container = new Container();
  container.label = `layer-${layerId}`;

  let sublayers: DungeonSublayers | null = null;
  if (layerType === 'dungeon') {
    const floor = new Container(); floor.label = 'sublayer-floor';
    const grid = new Container(); grid.label = 'sublayer-grid';
    const hatching = new Container(); hatching.label = 'sublayer-hatching';
    const walls = new Container(); walls.label = 'sublayer-walls';
    container.addChild(floor, grid, hatching, walls);
    sublayers = { floor, grid, hatching, walls };
  }

  const renderTexture: RenderTexture | null = null;
  const textureSprite: Sprite | null = null;

  // Add container directly to layerContainer.
  // RenderTexture wrapping for blend-mode isolation is deferred to Sprint 4+.
  if (index !== undefined) {
    sceneGraph.layerContainer.addChildAt(container, index);
  } else {
    sceneGraph.layerContainer.addChild(container);
  }

  const entry: LayerEntry = {
    id: layerId,
    type: layerType,
    container,
    sublayers,
    renderTexture,
    textureSprite,
    dirtyFlag: true,
  };

  layerEntries.set(layerId, entry);
  return entry;
}

/**
 * Remove a layer from the scene graph.
 */
export function removeLayerFromScene(
  sceneGraph: SceneGraph,
  layerId: string,
): void {
  const entry = layerEntries.get(layerId);
  if (!entry) return;

  if (entry.textureSprite) {
    sceneGraph.layerContainer.removeChild(entry.textureSprite);
    entry.textureSprite.destroy();
  } else {
    sceneGraph.layerContainer.removeChild(entry.container);
  }

  entry.renderTexture?.destroy(true);
  entry.container.destroy({ children: true });
  layerEntries.delete(layerId);
}

/**
 * Reorder layer containers to match the given ID order.
 */
export function reorderLayers(
  sceneGraph: SceneGraph,
  layerIds: string[],
): void {
  for (let i = 0; i < layerIds.length; i++) {
    const entry = layerEntries.get(layerIds[i]);
    if (!entry) continue;
    const displayObj = entry.textureSprite ?? entry.container;
    if (displayObj.parent === sceneGraph.layerContainer) {
      sceneGraph.layerContainer.setChildIndex(displayObj, i);
    }
  }
}

/**
 * Clear all layer entries (for full state reset).
 */
export function clearAllLayers(sceneGraph: SceneGraph): void {
  for (const [id] of layerEntries) {
    removeLayerFromScene(sceneGraph, id);
  }
}
