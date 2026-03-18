import { Graphics } from 'pixi.js';
import type { RenderEngine } from './RenderEngine';
import type { SceneGraph } from './sceneGraph';
import { getLayerEntries } from './sceneGraph';
import { useStore } from '@/store/store';
import type { DungeonLayer, Layer, LightChild } from '@/store/types';
import { LightManager } from './lighting';
import { renderToolPreview } from './toolPreview';

/**
 * Set up the per-frame render loop via PixiJS Ticker.
 * Order: (1) sync camera, (2) update background, (3) rebuild dirty layers,
 * (4) lighting, (5) overlay updates.
 *
 * Dirty-flag strategy: layers are NOT re-rendered every frame.
 * Camera changes need zero layer redraw.
 */
export function setupRenderLoop(
  engine: RenderEngine,
  sceneGraph: SceneGraph,
  lightManager: LightManager,
): void {
  // Background solid color fill — rendered once, updated when color changes
  const bgFill = new Graphics();
  bgFill.label = 'bgFill';
  sceneGraph.backgroundLayer.addChild(bgFill);

  let lastBgColor = '';

  // Expose a way to mark background dirty (called by store subscription)
  (sceneGraph.backgroundLayer as SceneGraph['backgroundLayer'] & { _markDirty: () => void })._markDirty = () => {
    // no-op: background redraws every frame to cover viewport after zoom/pan
  };

  const stage = engine.stage();

  // Background camera-change guard — skip redraw when camera+viewport+color unchanged
  let lastBgCamX = NaN;
  let lastBgCamY = NaN;
  let lastBgZoom = NaN;
  let lastBgW = NaN;
  let lastBgH = NaN;

  // Cached dungeon layer filter — avoids re-allocating array every frame
  let cachedLayersRef: Layer[] | null = null;
  let cachedDungeonLayers: DungeonLayer[] = [];

  // Access the PixiJS Ticker through the app
  // The ticker callback runs before each render
  const tickerCallback = () => {
    // (1) Camera sync — camera state lives on worldContainer directly,
    // mutated by useCanvasInput. Nothing to sync here.

    // (2) Update background — skip redraw when camera+color unchanged
    {
      const vp = engine.viewport();
      const zoom = stage.scale.x;
      const camX = stage.position.x;
      const camY = stage.position.y;
      const currentState = useStore.getState();
      const bgLayer = currentState.layers.find((l) => l.type === 'background');

      // When any light exists, use ambient light color for background
      // to prevent the multiply compositing from darkening to black
      const hasLights = currentState.layers.some(
        (l) => l.type === 'dungeon' && l.children.some((c: LightChild | { childType: string }) => c.childType === 'light'),
      );
      const bgColor = hasLights
        ? currentState.mapSettings.ambientLight
        : (bgLayer && bgLayer.type === 'background' ? bgLayer.backgroundColor : '#2d2d2d');

      if (
        camX !== lastBgCamX ||
        camY !== lastBgCamY ||
        zoom !== lastBgZoom ||
        vp.width !== lastBgW ||
        vp.height !== lastBgH ||
        bgColor !== lastBgColor
      ) {
        const worldLeft = -camX / zoom;
        const worldTop = -camY / zoom;
        const worldWidth = vp.width / zoom;
        const worldHeight = vp.height / zoom;

        // Over-size by 2x to handle panning without immediate redraws
        const pad = Math.max(worldWidth, worldHeight);
        bgFill.clear();
        bgFill.rect(
          worldLeft - pad,
          worldTop - pad,
          worldWidth + pad * 2,
          worldHeight + pad * 2,
        );
        const bgColorHex = parseInt(bgColor.replace('#', ''), 16);
        bgFill.fill(bgColorHex);

        lastBgCamX = camX;
        lastBgCamY = camY;
        lastBgZoom = zoom;
        lastBgW = vp.width;
        lastBgH = vp.height;
        lastBgColor = bgColor;
      }
    }

    // (3) Clear dirty flags on layer entries
    // RenderTexture pipeline deferred to Sprint 4+ — layers render directly
    const entries = getLayerEntries();
    for (const entry of entries.values()) {
      entry.dirtyFlag = false;
    }

    // (4) Grid update — redraws only when viewport range changes
    sceneGraph.gridRenderer.update(engine);

    // (5) Tool preview update
    sceneGraph.toolManager.updatePreview();

    // (5b) Tool settings preview — ghost shape from popover edits
    {
      const vp = engine.viewport();
      const previewZoom = stage.scale.x;
      const previewCx = (-stage.position.x + vp.width / 2) / previewZoom;
      const previewCy = (-stage.position.y + vp.height / 2) / previewZoom;
      renderToolPreview(previewCx, previewCy, previewZoom);
    }

    // (6) Lighting — rebuild wall segments if dirty, update FBO
    const storeState = useStore.getState();
    if (storeState.layers !== cachedLayersRef) {
      cachedLayersRef = storeState.layers;
      cachedDungeonLayers = storeState.layers.filter(
        (l): l is DungeonLayer => l.type === 'dungeon' && l.visible,
      );
    }
    lightManager.rebuildIfDirty(cachedDungeonLayers);

    // Get camera state for UV → world transform in shader
    const zoom = stage.scale.x;
    const camX = -stage.position.x / zoom;
    const camY = -stage.position.y / zoom;

    sceneGraph.lightingRenderer.updateAndRender(
      lightManager,
      camX,
      camY,
      zoom,
      storeState.mapSettings.ambientLight,
    );

    // (7) Overlay updates — sync transform gizmo screen position
    sceneGraph.toolManager.updateGizmo();
  };

  engine.addTickerCallback(tickerCallback);
}
