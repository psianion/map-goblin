import { useEffect, useRef, useState } from 'react';
import type { Clipper2ZFactoryFunction, MainModule } from 'clipper2-wasm/dist/clipper2z';
import clipper2WasmUrl from 'clipper2-wasm/dist/es/clipper2z.wasm?url';
import { PixiRenderEngine } from '@dnd/core/src/engine/PixiRenderEngine';
import { buildSceneGraph } from '@dnd/core/src/engine/sceneGraph';
import { setupRenderLoop } from '@dnd/core/src/engine/renderLoop';
import { subscribeToStore } from '@dnd/core/src/engine/subscribeToStore';
import { subscribeToAssets } from '@dnd/core/src/engine/subscribeToAssets';
import { setEngineSingleton, clearEngineSingleton } from '@dnd/core/src/engine/engineSingleton';
import { listenDprChanges } from '@dnd/core/src/engine/camera';
import { LightManager } from '@dnd/core/src/engine/lighting';
import { setTerrainRenderer } from '@dnd/core/src/engine/terrain/TerrainRenderer';
import { destroyWaterAnimation } from '@dnd/core/src/engine/water/waterAnimation';
import { getAssetPackManager } from '@dnd/core/src/engine/assetPackInstance';
import { ensureBundledPack } from '@dnd/core/src/engine/firstBootInstall';
import { setClipperModule } from '@dnd/core/src/geometry/Clipper2Engine';
import { useStore } from '@dnd/core/src/store/store';
import type { SerializedMapData } from '@dnd/core/src/store/types';
import { attachCameraInput, fitMap } from './cameraInput';
import { useSessionStore } from '../session/store';
import { loadSceneMap } from '../session/loadSceneMap';
import { syncDoorsToLighting } from '../modules/doors/doorLighting';
import { mountPlayerFogWhenReady } from '../modules/fog/FogRenderer';

// ponytail: copied from canvas/src/geometry/initClipper.ts (12 lines). It cannot
// live in @dnd/core — the `?url` import is a Vite-bundler feature and core is
// plain TS consumed by a Node server too. Two consumers, two four-line loaders.
async function initClipper(): Promise<void> {
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  const factory = mod.default as Clipper2ZFactoryFunction;
  const clipper: MainModule = await factory({
    locateFile: (path: string) => (path.endsWith('.wasm') ? clipper2WasmUrl : path),
  });
  setClipperModule(clipper);
}

/**
 * Read-only mount of the `@dnd/core` engine (§2.6).
 *
 * Identical boot sequence to canvas's CanvasHost — same PixiRenderEngine, same
 * scene graph, same render loop, same store subscriptions — minus everything
 * that mutates: no `registerAllTools`, no snap middleware, no ToolManager input,
 * no drag-drop/paste import. Local pan/zoom only, and it never writes to the
 * core store except `loadFromFile`.
 *
 * D9: sizes to its parent element via ResizeObserver. No `100vw/100vh` anywhere.
 */
export function GameRenderer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const framedScene = useRef<string | null>(null);
  const [engine, setEngine] = useState<PixiRenderEngine | null>(null);
  const [initFailed, setInitFailed] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const mapData = useSessionStore((s) => s.mapData);
  const token = useSessionStore((s) => s.token);

  // ── Engine boot ───────────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const pixiEngine = new PixiRenderEngine();
    let destroyed = false;
    let teardown: (() => void) | null = null;

    const setup = async () => {
      // Yield one tick so React Strict Mode's immediate cleanup lands before the
      // expensive Application is created (same trick as CanvasHost).
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (destroyed) return;

      try {
        await Promise.all([pixiEngine.init(container), initClipper()]);
      } catch (err) {
        console.error('[GameRenderer] engine/Clipper2 init failed:', err);
        if (!destroyed) setInitFailed(true);
        return;
      }
      if (destroyed) {
        pixiEngine.destroy();
        return;
      }

      // Floor/wall textures live in the bundled asset pack. Failure is soft —
      // geometry and lighting still render, textures fall back to empty.
      try {
        const packManager = getAssetPackManager();
        await packManager.rehydrate();
        await ensureBundledPack(packManager);
      } catch (err) {
        console.warn('[GameRenderer] asset pack rehydration failed:', err);
      }
      if (destroyed) {
        pixiEngine.destroy();
        return;
      }

      const sceneGraph = buildSceneGraph(pixiEngine);
      // The runner has no light-editing tool; icons are editor chrome (the map is the stage).
      sceneGraph.lightingRenderer.setIconsVisible(false);
      const lightManager = new LightManager();
      setupRenderLoop(pixiEngine, sceneGraph, lightManager);
      const unsubStore = subscribeToStore(pixiEngine, sceneGraph, lightManager);
      const unsubAssets = subscribeToAssets();
      setEngineSingleton(pixiEngine, sceneGraph);
      pixiEngine.startRenderLoop();

      const unregFogResize = pixiEngine.onResize((w, h) => sceneGraph.fogTransition.resize(w, h));
      const cleanupDpr = listenDprChanges(pixiEngine);

      teardown = () => {
        sceneGraph.toolManager.destroy();
        sceneGraph.lightingRenderer.destroy();
        sceneGraph.fogTransition.destroy();
        // Same three as CanvasHost's teardown: the terrain renderer keeps two live store
        // subscriptions and the water filter its own ticker, both outliving the engine.
        sceneGraph.terrainRenderer.destroy();
        setTerrainRenderer(null);
        destroyWaterAnimation();
        unsubStore();
        unsubAssets();
        unregFogResize();
        cleanupDpr();
      };

      setEngine(pixiEngine);
    };

    void setup();

    return () => {
      destroyed = true;
      teardown?.();
      clearEngineSingleton();
      pixiEngine.destroy();
      setEngine(null);
    };
  }, []);

  // ── Fog + door sight (S3) ─────────────────────────────────────────────────
  // Both live here rather than in a module panel: the player fog has no panel to hang off
  // (the fog *tool* is the DM's), and the door→lighting feed is D3 layer 1, which is always
  // on for both roles. Each waits for the engine on its own and is role-aware inside.
  useEffect(() => mountPlayerFogWhenReady(), []);
  useEffect(() => syncDoorsToLighting(), []);

  // ── Container-relative sizing (D9) ────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !engine) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) engine.resize(width, height);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [engine]);

  // ── Local pan/zoom ────────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !engine) return;
    return attachCameraInput(engine, container);
  }, [engine]);

  // ── Map data flow ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!sceneId || mapData || !token) return;
    let cancelled = false;
    loadSceneMap(sceneId, token).then(
      () => {
        if (!cancelled) setFetchError(null);
      },
      (err: unknown) => {
        if (!cancelled) setFetchError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [sceneId, mapData, token]);

  // Deserialized document → core store → scene graph, via core's own loader.
  // Guarded: `loadFromFile` runs the scene-graph subscribers synchronously, so a
  // malformed document from the server would otherwise throw through React and
  // blank the page. The map is a trust boundary — degrade to a message instead.
  useEffect(() => {
    if (!engine || !mapData) return;
    try {
      // splatPngs travels beside mapData (set in the same store pass by
      // loadSceneMap) — read here, not subscribed, so the effect keys stay.
      useStore
        .getState()
        .loadFromFile(mapData as SerializedMapData, useSessionStore.getState().splatPngs);
    } catch (err) {
      console.error('[GameRenderer] map document rejected by the engine:', err);
      // Terminal error path — one extra render, versus a blank page.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoadFailed(true);
      return;
    }

    // Nobody at this table chose a camera: the editor's was never sent. Without framing, a
    // map drawn away from the origin opens mostly off-screen — the default camera is zoom 20
    // on the origin — and the player has to go looking for it.
    //
    // Once per scene, though: from S3 the map grows as rooms are revealed (D5), and
    // re-framing on a reveal would yank the camera out from under whoever is looking at it.
    // The opening view is an opening view, not a response to every delta.
    if (framedScene.current === sceneId) return;
    if (fitMap(engine)) {
      framedScene.current = sceneId;
      return;
    }
    // Nothing to frame yet. A player seat is handed a document stripped to what it has
    // revealed, and the floor union the bounds are measured from is rebuilt a beat after the
    // document lands — so keep watching rather than leaving the seat parked over empty space
    // with a click on a door row as its only way back.
    const stop = useStore.subscribe(() => {
      if (framedScene.current === sceneId || !fitMap(engine)) return;
      framedScene.current = sceneId;
      stop();
    });
    return stop;
  }, [engine, mapData, sceneId]);

  const status = initFailed
    ? 'Renderer failed to start — WebGL may be unavailable.'
    : loadFailed
      ? 'This map could not be rendered — it may be corrupt.'
      : fetchError
        ? `Could not load the map: ${fetchError}`
        : !sceneId
          ? 'Waiting for the DM to pick a scene…'
          : !mapData
            ? 'Loading map…'
            : // The map can be in hand well before the engine is: first boot installs the
              // bundled asset pack (~8MB) into a cold IndexedDB. Without this branch the
              // overlay clears and the player watches an empty canvas with no explanation.
              !engine
              ? 'Starting the renderer…'
              : null;

  return (
    <div className="relative h-full w-full overflow-hidden bg-neutral-950">
      <div ref={containerRef} className="h-full w-full touch-none" data-testid="game-canvas" />
      {status && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <p className="rounded-md bg-neutral-900/80 px-4 py-2 text-sm text-neutral-300">
            {status}
          </p>
        </div>
      )}
    </div>
  );
}
