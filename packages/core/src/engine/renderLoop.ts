import { Graphics } from 'pixi.js';
import type { RenderEngine } from './RenderEngine';
import type { SceneGraph } from './sceneGraph';
import { getLayerEntries } from './sceneGraph';
import { useStore } from '../store/store';
import { isLayerEffectivelyVisible } from '../store/selectors';
import type { DungeonLayer, Layer, LightChild, UISlice } from '../store/types';
import { LightManager } from './lighting';
import { renderToolPreview } from './toolPreview';
import { renderRoomHighlight } from './roomHighlight';
import { renderWallNodeHandles } from './wallNodeOverlay';
import { renderShapeNodeHandles } from './shapeNodeOverlay';
import { recordFrame } from './fpsMetrics';
import { composeGrade, mixOklch, timeBucket } from '../shared/world';
import { updateShadows } from './shadowPass';
import { worldFrame, worldGrade } from './worldOverride';

/**
 * Set up the per-frame render loop via PixiJS Ticker.
 * Order: (1) sync camera, (2) update background, (3) rebuild dirty layers,
 * (4) lighting, (5) overlay updates.
 *
 * Dirty-flag strategy: layers are NOT re-rendered every frame.
 * Camera changes need zero layer redraw.
 */
/**
 * The grade: the map's mood at the hour this engine is standing at — the campaign clock where
 * a surface installed one (the Table), the map's own where none did (the Editor). One writer
 * of `setGrade`, which is this loop; see `worldOverride`.
 */
const gradeNow = (state: ReturnType<typeof useStore.getState>): string =>
  worldGrade(state.mapSettings, state.ui.previewClock);

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

  // Cached dungeon layer filter — avoids re-allocating array every frame.
  // Keyed on both the layers array and solo: solo toggling never touches
  // `layers` (see ui.ts's `toggleSoloLayer`), so without the second key a
  // solo/un-solo would never bust this cache and occlusion would keep
  // casting against a soloed-away layer's walls.
  let cachedLayersRef: Layer[] | null = null;
  let cachedSoloRef: UISlice['solo'] | null = null;
  let cachedDungeonLayers: DungeonLayer[] = [];

  // Access the PixiJS Ticker through the app
  // The ticker callback runs before each render
  const tickerCallback = () => {
    // (0) Record frame timestamp for FPS metrics
    recordFrame();

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

      // When any light exists, use the grade for the background
      // to prevent the multiply compositing from darkening to black
      const hasLights = currentState.layers.some(
        (l) => l.type === 'dungeon' && l.children.some((c: LightChild | { childType: string }) => c.childType === 'light'),
      );
      const authoredBg =
        bgLayer && bgLayer.type === 'background' ? bgLayer.backgroundColor : '#0f100e';
      // The void takes a *hint* of the hour, not the whole of it. Painting it the grade outright
      // was invisible while every mood was a baked night, but a mood is "this world in neutral
      // daylight" now — and at full strength an evening grade flooded the entire viewport, map
      // and void alike, with saturated orange (the lighting composite multiplies by the grade a
      // second time on top). A third of the way keeps the original point of this branch — the
      // background still lifts clear of the black the multiply would otherwise crush it to —
      // without the void ever becoming the brightest thing on screen.
      const bgColor = hasLights ? mixOklch(authoredBg, gradeNow(currentState), 0.33) : authoredBg;

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

    // (4b) Terrain crisp-window settle check — re-bakes the viewport window
    // only once the camera (or a paint stroke) has been still for a beat.
    sceneGraph.terrainRenderer.update(engine);

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

    // (5c) Room highlight — no-ops unless the highlighted room changed
    renderRoomHighlight();

    // (5d) Wall node handles — no-ops unless the edited wall, selection, zoom
    // or camera changed. Zoom matters: handles are drawn at a constant screen
    // size. Camera matters: edit mode dims the rest of the view with a quad
    // covering the camera's world rect.
    const nodeVp = engine.viewport();
    const nodeZoom = stage.scale.x;
    const nodeView = {
      x: -stage.position.x / nodeZoom,
      y: -stage.position.y / nodeZoom,
      width: nodeVp.width / nodeZoom,
      height: nodeVp.height / nodeZoom,
    };
    renderWallNodeHandles(nodeZoom, nodeView);
    renderShapeNodeHandles(nodeZoom, nodeView);

    // (6) Lighting — rebuild wall segments if dirty, update FBO
    const storeState = useStore.getState();
    if (storeState.layers !== cachedLayersRef || storeState.ui.solo !== cachedSoloRef) {
      cachedLayersRef = storeState.layers;
      cachedSoloRef = storeState.ui.solo;
      cachedDungeonLayers = storeState.layers.filter(
        (l): l is DungeonLayer => l.type === 'dungeon' && isLayerEffectivelyVisible(storeState, l),
      );
    }
    lightManager.rebuildIfDirty(cachedDungeonLayers);

    // The one clock this tick stands at — the campaign's, or the map's own (`worldOverride`).
    const frame = worldFrame(storeState.mapSettings, storeState.ui.previewClock);

    // (6b) Directional shadows (P3a) — the sun's own pass, over the same wall set the sweep
    // above was just rebuilt from. Memoized on (wall epoch, sun step, orientation): an
    // unedited map under a paused clock costs one string compare per layer here.
    updateShadows(cachedDungeonLayers, lightManager.getWallEpoch(), frame);

    // Get camera state for UV → world transform in shader
    const zoom = stage.scale.x;
    const camX = -stage.position.x / zoom;
    const camY = -stage.position.y / zoom;

    // The composed grade: the map's mood carrying the hour this engine stands at, damped by how
    // much sky the map has. Both surfaces come through here — the Table by installing its
    // campaign clock (`setTableWorld`), the Editor by installing nothing and falling through to
    // the scrub head. One writer, so a per-frame caller can no longer outrun an on-mutation one.
    sceneGraph.lightingRenderer.setGrade(
      composeGrade(storeState.mapSettings, frame.minutes),
      timeBucket(frame.minutes),
    );

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
