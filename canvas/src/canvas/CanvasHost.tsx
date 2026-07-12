import { useRef, useEffect, useState } from 'react';
import { PixiRenderEngine } from '@/engine/PixiRenderEngine';
import type { RenderEngine } from '@/engine/RenderEngine';
import { buildSceneGraph } from '@/engine/sceneGraph';
import { setupRenderLoop } from '@/engine/renderLoop';
import { subscribeToStore } from '@/engine/subscribeToStore';
import { subscribeToAssets } from '@/engine/subscribeToAssets';
import { setEngineSingleton, clearEngineSingleton } from '@/engine/engineSingleton';
import { LightManager } from '@dnd/core/src/engine/lighting/index';
import { useCanvasResize } from './useCanvasResize';
import { useCanvasInput, registerInputMiddleware, setToolManager, setSnapIndicator } from './useCanvasInput';
import { listenDprChanges } from '@/engine/camera';
import { gridSnap } from './gridSnap';
import { wallEndpointSnap } from './wallEndpointSnap';
import { initClipper } from '@/geometry/initClipper';
import { registerAllTools } from '@/engine/tools/registerTools';
import { SnapIndicator } from './snapIndicator';
import { useStore } from '@/store/store';
import { notify } from '@/lib/toast';
import { getAssetPackManager } from '@/engine/assetPackInstance';
import { ensureBundledPack } from '@/engine/firstBootInstall';
import { buildMergedManifest } from '@/engine/manifestBridge';

export function CanvasHost() {
  const containerRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const [engine, setEngine] = useState<RenderEngine | null>(null);
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

      // Initialize PixiJS and Clipper2 WASM in parallel
      try {
        await Promise.all([pixiEngine.init(container), initClipper()]);
      } catch (err) {
        console.error('[CanvasHost] Failed to initialize engine or Clipper2 WASM:', err);
        notify.error('Engine failed to start', { persistent: true });
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

      // Rehydrate asset packs from IndexedDB (non-blocking — log errors, don't block boot)
      try {
        const packManager = getAssetPackManager();
        await packManager.rehydrate();
        // First-boot: install bundled pack if no packs exist
        await ensureBundledPack(packManager);
        if (destroyed) return;

        // Populate PacksSlice from rehydrated + newly installed state
        const store = useStore.getState();
        store.setInstalledPacks(
          packManager.getInstalledPacks().map((p) => ({
            packId: p.packId,
            name: p.packId,
            version: p.version,
            sizeBytes: p.bundleSize,
            bundled: p.packId === 'dungeon-classic',
            installedAt: Date.now(),
          })),
        );
        // Merge pack manifests into asset browser manifest
        const packManifests = packManager.getPackManifests();
        if (packManifests.length > 0) {
          const merged = buildMergedManifest(packManifests);
          store.setManifest(merged);
        }

        // Fire checkForUpdates in background — don't block boot
        packManager.checkForUpdates().then((updates) => {
          if (!destroyed && updates.length > 0) {
            useStore.getState().setAvailableUpdates(updates);
          }
        }).catch(() => {});
      } catch (err) {
        console.warn('[CanvasHost] Asset pack rehydration failed:', err);
      }
      if (destroyed) return;

      // Build scene graph hierarchy
      const sceneGraph = buildSceneGraph(pixiEngine);

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
      };
      canvas.addEventListener('webglcontextlost', onContextLost);

      setEngine(pixiEngine);

      cleanupRef.current = () => {
        setToolManager(null);
        setSnapIndicator(null);
        snapIndicator.destroy();
        sceneGraph.toolManager.destroy();
        sceneGraph.lightingRenderer.destroy();
        sceneGraph.fogTransition.destroy();
        unsubStore();
        unsubAssets();
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
    };
  }, []);

  useCanvasResize(containerRef, engine);
  useCanvasInput(containerRef, engine);

  return (
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
  );
}
