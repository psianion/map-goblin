import { Graphics } from 'pixi.js';
import type { RenderEngine } from './RenderEngine';
import type { SceneGraph } from './sceneGraph';
import { getLayerEntries } from './sceneGraph';
import { useStore } from '@/store/store';
import type { DungeonLayer } from '@/store/types';
import { LightManager } from './lighting';

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
  let bgDirty = true;

  // Expose a way to mark background dirty (called by store subscription)
  (sceneGraph.backgroundLayer as SceneGraph['backgroundLayer'] & { _markDirty: () => void })._markDirty = () => {
    bgDirty = true;
  };

  const stage = engine.stage();

  // Access the PixiJS Ticker through the app
  // The ticker callback runs before each render
  const tickerCallback = () => {
    // (1) Camera sync — camera state lives on worldContainer directly,
    // mutated by useCanvasInput. Nothing to sync here.

    // (2) Update background
    if (bgDirty) {
      const vp = engine.viewport();
      // Draw a large background rectangle in world space
      // Positioned so it covers the visible area regardless of camera
      const zoom = stage.scale.x;
      const camX = stage.position.x;
      const camY = stage.position.y;
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
      const bgLayer = useStore.getState().layers.find((l) => l.type === 'background');
      const bgColorHex = bgLayer && bgLayer.type === 'background'
        ? parseInt(bgLayer.backgroundColor.replace('#', ''), 16)
        : 0x2d2d2d;
      bgFill.fill(bgColorHex);
      bgDirty = false;
      lastBgColor = bgLayer && bgLayer.type === 'background' ? bgLayer.backgroundColor : '#2d2d2d';
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

    // (6) Lighting — rebuild wall segments if dirty, update FBO
    const storeState = useStore.getState();
    const dungeonLayers = storeState.layers.filter(
      (l): l is DungeonLayer => l.type === 'dungeon' && l.visible,
    );
    lightManager.rebuildIfDirty(dungeonLayers);

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

    // (7) Overlay updates — no-op for Sprint 1
  };

  engine.addTickerCallback(tickerCallback);

  void lastBgColor;
}
