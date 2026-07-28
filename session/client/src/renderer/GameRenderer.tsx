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
import { getAssetPackManager } from '@dnd/core/src/engine/assetPackInstance';
import { computeMapWorldBounds } from '@dnd/core/src/engine/export/exportPipeline';
import { ensureBundledPack } from '@dnd/core/src/engine/firstBootInstall';
import { setClipperModule } from '@dnd/core/src/geometry/Clipper2Engine';
import { useStore } from '@dnd/core/src/store/store';
import type { SerializedMapData } from '@dnd/core/src/store/types';
import { useSessionStore } from '../session/store';
import { loadSceneMap } from '../session/loadSceneMap';
import { syncDoorsToLighting } from '../modules/doors/doorLighting';
import { mountPlayerFogWhenReady } from '../modules/fog/FogRenderer';

// ponytail: copied from canvas/src/geometry/initClipper.ts (12 lines). It cannot
// live in @dnd/core — the `?url` import is a Vite-bundler feature and core is
// plain TS consumed by a Node server too. Two consumers, two four-line loaders.
// Same range the editor's zoom slider clamps to, so a scene framed in canvas feels
// identical here. World units are grid cells, so this is pixels-per-cell.
const MIN_ZOOM = 10;
const MAX_ZOOM = 100;

async function initClipper(): Promise<void> {
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  const factory = mod.default as Clipper2ZFactoryFunction;
  const clipper: MainModule = await factory({
    locateFile: (path: string) => (path.endsWith('.wasm') ? clipper2WasmUrl : path),
  });
  setClipperModule(clipper);
}

/**
 * Centres the loaded map in the viewport at the largest zoom that still fits it, with a
 * little margin. Same math as the editor's "fit to content" (ZoomSlider), minus the
 * animation — this is the opening view, not a transition from one.
 */
function frameMap(engine: PixiRenderEngine): void {
  const bounds = computeMapWorldBounds(useStore.getState().layers);
  // An empty map has infinite bounds; leave the default camera rather than divide by it.
  if (!Number.isFinite(bounds.minX) || !Number.isFinite(bounds.maxX)) return;

  const viewport = engine.viewport();
  // Collinear or single-point content would otherwise demand infinite zoom.
  const width = Math.max(bounds.maxX - bounds.minX, 1);
  const height = Math.max(bounds.maxY - bounds.minY, 1);
  const zoom = Math.min(
    MAX_ZOOM,
    Math.max(MIN_ZOOM, Math.min(viewport.width / width, viewport.height / height) * 0.9),
  );

  const stage = engine.stage();
  stage.scale.set(zoom);
  stage.position.x = viewport.width / 2 - ((bounds.minX + bounds.maxX) / 2) * zoom;
  stage.position.y = viewport.height / 2 - ((bounds.minY + bounds.maxY) / 2) * zoom;
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
  // Camera state lives on the world container itself (see renderLoop step 1), so
  // "camera" is just stage.position/scale. Same factors and clamp as the editor
  // so a scene framed in canvas feels identical here.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !engine) return;
    const stage = engine.stage();
    let panning = false;
    let lastX = 0;
    let lastY = 0;

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.button !== 1) return;
      panning = true;
      lastX = e.clientX;
      lastY = e.clientY;
      container.setPointerCapture(e.pointerId);
      e.preventDefault();
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!panning) return;
      stage.position.x += e.clientX - lastX;
      stage.position.y += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onPointerUp = (e: PointerEvent) => {
      panning = false;
      if (container.hasPointerCapture(e.pointerId)) container.releasePointerCapture(e.pointerId);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const oldZoom = stage.scale.x;
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, oldZoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      stage.position.x = mx - (mx - stage.position.x) * (newZoom / oldZoom);
      stage.position.y = my - (my - stage.position.y) * (newZoom / oldZoom);
      stage.scale.set(newZoom);
    };

    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerup', onPointerUp);
    container.addEventListener('pointercancel', onPointerUp);
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerup', onPointerUp);
      container.removeEventListener('pointercancel', onPointerUp);
      container.removeEventListener('wheel', onWheel);
    };
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
      useStore.getState().loadFromFile(mapData as SerializedMapData);
      // Nobody at this table chose a camera: the editor's was never sent and there are no
      // view controls on the page. Without framing, a map drawn away from the origin opens
      // mostly off-screen and the player has to go looking for it. `loadFromFile` runs the
      // scene-graph subscribers synchronously, so mergedFloor — what the bounds are
      // measured from — already exists by the time this line runs.
      //
      // Once per scene, though: from S3 the map grows as rooms are revealed (D5), and
      // re-framing on a reveal would yank the camera out from under whoever is looking at
      // it. The opening view is an opening view, not a response to every delta.
      if (framedScene.current !== sceneId) {
        framedScene.current = sceneId;
        frameMap(engine);
      }
    } catch (err) {
      console.error('[GameRenderer] map document rejected by the engine:', err);
      // Terminal error path — one extra render, versus a blank page.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoadFailed(true);
    }
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
