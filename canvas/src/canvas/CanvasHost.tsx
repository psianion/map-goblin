import { useRef, useEffect, useState } from 'react';
import { PixiRenderEngine } from '@/engine/PixiRenderEngine';
import type { RenderEngine } from '@/engine/RenderEngine';
import { buildSceneGraph } from '@/engine/sceneGraph';
import { setupRenderLoop } from '@/engine/renderLoop';
import { subscribeToStore } from '@/engine/subscribeToStore';
import { subscribeToAssets } from '@/engine/subscribeToAssets';
import { subscribeToTextLabels } from '@/engine/subscribeToTextLabels';
import { installBoundLabelSync } from '@dnd/core/src/store/boundLabels';
import { setEngineSingleton, clearEngineSingleton } from '@/engine/engineSingleton';
import { LightManager } from '@dnd/core/src/engine/lighting/index';
import { mountDoorIcons } from '@dnd/core/src/engine/doorIconRenderer';
import { setTerrainRenderer } from '@dnd/core/src/engine/terrain/TerrainRenderer';
import { useCanvasResize } from './useCanvasResize';
import {
  useCanvasInput,
  registerInputMiddleware,
  registerCanvasPressHandler,
  setToolManager,
  setSnapIndicator,
  setDimensionHud,
} from './useCanvasInput';
import { listenDprChanges } from '@/engine/camera';
import { gridSnap } from './gridSnap';
import { wallEndpointSnap } from './wallEndpointSnap';
import { initClipper } from '@/geometry/initClipper';
import { registerAllTools } from '@/engine/tools/registerTools';
import { SnapIndicator } from './snapIndicator';
import { DimensionHud } from './dimensionHud';
import { mountZoneOverlay } from './zoneOverlay';
import { mountRoomOverlay } from '@/canvas/roomOverlay';
import { mountPropOverlay } from '@/canvas/propOverlay';
import { mountSelectionOverlay } from '@/canvas/selectionOverlay';
import { mountDropToLayer } from '@/editor/dropToLayer';
import { mountLightOverlay } from '@/canvas/lightOverlay';
import { setRoomPicking } from '@dnd/core/src/engine/hitTest';
import { setRoomHighlightEnabled } from '@dnd/core/src/engine/roomHighlight';
import { useStore } from '@/store/store';
import { notify } from '@dnd/ui/toast';
import { LoadingScreen } from '@dnd/ui';
import { startAssetBoot, useAssetLoading } from './assetLoading';

const BOOT_STEPS = ['Engine', 'Library index', 'Map textures'];

export function CanvasHost() {
  const containerRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const [engine, setEngine] = useState<RenderEngine | null>(null);
  const [initError, setInitError] = useState(false);
  const [pixiReady, setPixiReady] = useState(false);
  const indexReady = useAssetLoading((s) => s.indexReady);
  const mapScreen = useAssetLoading((s) => (s.map?.mode === 'screen' ? s.map.progress : null));
  const [retryKey, setRetryKey] = useState(0);
  const clipperReady = useStore((s) => s.ui.clipperReady);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const pixiEngine = new PixiRenderEngine();
    let destroyed = false;

    const setup = async () => {
      // Yield one tick so React Strict Mode can run its immediate cleanup before we
      // create the expensive PixiJS Application. The first (Strict Mode) mount will see
      // destroyed=true after the yield and bail out immediately; the real second mount
      // will have destroyed=false and proceed normally.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (destroyed) return;

      // Pack metadata and the bundled index load beside Pixi and Clipper; the engine is
      // handed over when both are in, without waiting for any texture. Module-scoped, so a
      // retry after an init failure never starts a second boot.
      const assetBoot = startAssetBoot();

      // Initialize PixiJS and Clipper2 WASM in parallel
      try {
        await Promise.all([pixiEngine.init(container), initClipper()]);
      } catch (err) {
        console.error('[CanvasHost] Failed to initialize engine or Clipper2 WASM:', err);
        if (!destroyed) setInitError(true);
        return;
      }
      useStore.getState().setClipperReady(true);
      // Expose for E2E tests — direct window flag avoids React render timing issues
      (window as Window & { __clipperReady?: boolean }).__clipperReady = true;
      if (destroyed) {
        useStore.getState().setClipperReady(false);
        (window as Window & { __clipperReady?: boolean }).__clipperReady = false;
        pixiEngine.destroy();
        return;
      }

      setPixiReady(true);
      await assetBoot;
      if (destroyed) return;

      // Build scene graph hierarchy. This is the editor, so it gets the
      // authoring guides (the fixed-map boundary); the table does not.
      const sceneGraph = buildSceneGraph(pixiEngine, { editorGuides: true });

      // Create LightManager (shared between subscribeToStore and renderLoop)
      const lightManager = new LightManager();

      // Set up render loop
      setupRenderLoop(pixiEngine, sceneGraph, lightManager);

      // Subscribe to Zustand store for state → scene graph sync
      const unsubStore = subscribeToStore(pixiEngine, sceneGraph, lightManager);

      // Wire engine singleton (used by tools and E2E helpers)
      setEngineSingleton(pixiEngine, sceneGraph);

      // Subscribe to asset/image layer changes → PixiJS sprite sync
      const unsubAssets = subscribeToAssets();

      // Text labels sync the same way, into the same layer containers
      const unsubLabels = subscribeToTextLabels();
      // Room names, number pins and door tags follow the room or door they are bound to.
      const unsubBoundLabels = installBoundLabelSync();

      pixiEngine.startRenderLoop();

      // Register input middleware (order matters: gridSnap first, then wallEndpointSnap)
      const unregSnap = registerInputMiddleware(gridSnap);
      const unregWallSnap = registerInputMiddleware(wallEndpointSnap);

      // Register drawing tools and wire up ToolManager for input forwarding
      registerAllTools(sceneGraph.toolManager, sceneGraph.worldContainer, pixiEngine, sceneGraph.previewContainer);
      setToolManager(sceneGraph.toolManager);

      // Instantiate snap indicator in overlay container
      const snapIndicator = new SnapIndicator(sceneGraph.overlayContainer);
      setSnapIndicator(snapIndicator);

      // Dimension readout next to the cursor while drawing
      const dimensionHud = new DimensionHud(sceneGraph.overlayContainer);
      setDimensionHud(dimensionHud);

      // Zone markers — editor-only, never present in the session/table bundle
      const unmountZoneOverlay = mountZoneOverlay(sceneGraph.worldContainer);

      // Rooms — same editor-only reasoning as zones: the editor's own overlay (outlines,
      // badges, suggestions), and clicks pick rooms.
      const roomOverlay = mountRoomOverlay(pixiEngine);
      // Dev builds hand the overlay's counters to the console and the e2e suite.
      if (import.meta.env.DEV) (window as Window & { __roomOverlay?: typeof roomOverlay }).__roomOverlay = roomOverlay;
      const unregPress = registerCanvasPressHandler((sx, sy) => roomOverlay.pressAt(sx, sy));
      setRoomPicking(() => useStore.getState().ui.roomOverlayVisible);
      setRoomHighlightEnabled(false);
      // Locks and selected groups, editor-only like the rooms.
      const propOverlay = mountPropOverlay(pixiEngine);
      if (import.meta.env.DEV) (window as Window & { __propOverlay?: typeof propOverlay }).__propOverlay = propOverlay;
      // Locked members of the selection: a dashed outline and a padlock, no handles.
      const selectionOverlay = mountSelectionOverlay(pixiEngine);
      if (import.meta.env.DEV) (window as Window & { __selectionOverlay?: typeof selectionOverlay }).__selectionOverlay = selectionOverlay;
      // The selected light's rings and handles, and the Light tool's ghost rings.
      const lightOverlay = mountLightOverlay(pixiEngine);
      if (import.meta.env.DEV) (window as Window & { __lightOverlay?: typeof lightOverlay }).__lightOverlay = lightOverlay;
      const unregLightPress = registerCanvasPressHandler((sx, sy) => lightOverlay.pressAt(sx, sy));
      // A canvas drag released over a filmstrip tile moves the selection to that layer.
      const unmountDropToLayer = mountDropToLayer(sceneGraph.toolManager, pixiEngine.canvas());
      const unmountEditorOverlays = () => {
        unmountDropToLayer();
        unregPress();
        unregLightPress();
        lightOverlay.destroy();
        setRoomPicking(false);
        setRoomHighlightEnabled(true);
        roomOverlay.destroy();
        propOverlay.destroy();
        selectionOverlay.destroy();
      };

      // Door marks — same opt-in reasoning: the table draws its own live ones (DoorRenderer),
      // so core only ever has them where a surface asks.
      const unmountDoorIcons = mountDoorIcons(pixiEngine);

      // Wire fog transition resize to engine resize events
      const unregFogResize = pixiEngine.onResize((w, h) => {
        sceneGraph.fogTransition.resize(w, h);
      });

      // DPR change listener
      const cleanupDpr = listenDprChanges(pixiEngine);

      // WebGL context lost handler (Step 1.12)
      const canvas = pixiEngine.canvas();
      const onContextLost = () => {
        console.warn('[CanvasHost] WebGL context lost. Try refreshing the page.');
        notify.error('Graphics context lost — please refresh the page', { persistent: true });
      };
      canvas.addEventListener('webglcontextlost', onContextLost);

      setEngine(pixiEngine);

      cleanupRef.current = () => {
        setToolManager(null);
        setSnapIndicator(null);
        snapIndicator.destroy();
        setDimensionHud(null);
        dimensionHud.destroy();
        unmountZoneOverlay();
        unmountEditorOverlays();
        unmountDoorIcons();
        sceneGraph.toolManager.destroy();
        sceneGraph.lightingRenderer.destroy();
        sceneGraph.fogTransition.destroy();
        sceneGraph.terrainRenderer.destroy();
        setTerrainRenderer(null);
        unsubStore();
        unsubAssets();
        unsubLabels();
        unsubBoundLabels();
        unregSnap();
        unregWallSnap();
        unregFogResize();
        cleanupDpr();
        canvas.removeEventListener('webglcontextlost', onContextLost);
      };
    };

    setup();

    return () => {
      destroyed = true;
      cleanupRef.current?.();
      useStore.getState().setClipperReady(false);
      // Clear the global E2E test flag when cleaning up
      (window as Window & { __clipperReady?: boolean }).__clipperReady = false;
      clearEngineSingleton();
      pixiEngine.destroy();
      setEngine(null);
      setPixiReady(false);
    };
  }, [retryKey]);

  useCanvasResize(containerRef, engine);
  useCanvasInput(containerRef, engine);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div
        ref={containerRef}
        data-clipper-ready={clipperReady ? 'true' : undefined}
        style={{
          width: '100%',
          height: '100%',
          touchAction: 'none',
          overflow: 'hidden',
        }}
      />
      {initError ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            color: '#ccc',
            font: '14px system-ui, sans-serif',
            background: '#0f100e',
          }}
        >
          <div>Failed to initialize the canvas. Your browser may not support WebGL 2.</div>
          <button
            type="button"
            onClick={() => {
              setInitError(false);
              setRetryKey((k) => k + 1);
            }}
            style={{ padding: '6px 16px', cursor: 'pointer' }}
          >
            Retry
          </button>
        </div>
      ) : (
        (!engine || mapScreen) && (
          <LoadingScreen
            title="Opening the canvas"
            steps={BOOT_STEPS}
            current={!pixiReady ? 0 : !indexReady ? 1 : 2}
            progress={engine ? mapScreen : null}
          />
        )
      )}
    </div>
  );
}
