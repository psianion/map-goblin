import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { getEngineSingleton } from '@dnd/core/src/engine/engineSingleton';
import type { TriggersState } from '@dnd/mechanics/triggers';
import { sceneTriggersOf, worldLightOf, worldOf } from '@dnd/mechanics/triggers';
import { useStore } from '@dnd/core/src/store/store';
import { vocabLabel } from '@dnd/core/src/shared/prep';
import { worldBadge } from '../modules/world/world';
import { useOverlayMode, useShell } from '../shell/shellStore';
import { toolLabel, useActiveTool } from '../session/tools';
import type { ConnectionStatus } from '../session/WebSocketClient';
import { useModuleState, useRole, useSessionStore } from '../session/store';
import { MAX_ZOOM } from '../renderer/camera';
import { fitMap, minZoom, zoomAbout } from '../renderer/cameraInput';

/**
 * The table's status bar: the scene name (opens the Session popover), presence and
 * connection, latency, world light, and — while a tool is armed — its name and the key
 * that exits it. FPS/frame-time are diagnostics, off by default (Shift+D), where the
 * editor's equivalent bar always shows cursor coordinates. Same exponential zoom slider
 * on the right.
 */
const SLIDER_MIN = 10;

const sliderToZoom = (t: number): number => SLIDER_MIN * Math.pow(MAX_ZOOM / SLIDER_MIN, t);
const zoomToSlider = (zoom: number): number =>
  Math.log(zoom / SLIDER_MIN) / Math.log(MAX_ZOOM / SLIDER_MIN);

/** Color class for FPS value based on threshold (achromatic brightness) — as in canvas. */
const fpsColorClass = (fps: number): string => {
  if (fps >= 50) return 'text-text-primary';
  if (fps >= 30) return 'text-text-secondary';
  return 'text-text-muted';
};

const CONNECTION: Record<ConnectionStatus, { label: string }> = {
  connecting: { label: 'Connecting' },
  open: { label: 'Connected' },
  reconnecting: { label: 'Reconnecting' },
  closed: { label: 'Disconnected' },
};

/**
 * Presence as shape, not colour (chrome-style-guide.md "State encoding"): filled disc =
 * open, hollow ring = connecting/reconnecting, triangle = closed. `data-shape` is a test
 * hook only — nothing reads it at runtime.
 */
function ConnectionShape({ connection }: { connection: ConnectionStatus }) {
  if (connection === 'open') {
    return (
      <span
        aria-hidden
        data-shape="disc"
        className="h-2 w-2 shrink-0 rounded-full bg-text-secondary"
      />
    );
  }
  if (connection === 'closed') {
    return (
      <span
        aria-hidden
        data-shape="triangle"
        className="h-2 w-2 shrink-0 bg-text-muted"
        style={{ clipPath: 'polygon(50% 0%, 0% 100%, 100% 100%)' }}
      />
    );
  }
  return (
    <span
      aria-hidden
      data-shape="ring"
      className="h-2 w-2 shrink-0 rounded-full border border-text-muted"
    />
  );
}

const fitToScreen = (): void => {
  const engine = getEngineSingleton()?.engine;
  if (engine) fitMap(engine);
};

function ZoomSlider() {
  const [zoom, setZoom] = useState(20);
  const rafRef = useRef(0);

  // Poll the stage zoom every frame so the slider stays in sync with wheel/key zoom —
  // the camera is plain stage state (cameraInput), nothing emits an event to listen to.
  useEffect(() => {
    const tick = () => {
      const engine = getEngineSingleton()?.engine;
      if (engine) {
        const current = engine.stage().scale.x;
        setZoom((prev) => (Math.abs(prev - current) > 0.01 ? current : prev));
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const engine = getEngineSingleton()?.engine;
    if (!engine) return;
    const { width, height } = engine.viewport();
    const target = sliderToZoom(parseFloat(e.target.value));
    // Zoom about the viewport centre, on the same floor the wheel and keys respect.
    zoomAbout(
      engine.stage(),
      width / 2,
      height / 2,
      target / engine.stage().scale.x,
      minZoom(engine),
      MAX_ZOOM,
    );
    setZoom(engine.stage().scale.x);
  }, []);

  // A fit on a big map can rest below the slider's 10-floor — clamp the track, not the camera.
  const sliderVal = Math.max(0, Math.min(1, zoomToSlider(zoom)));
  const pct = Math.round(sliderVal * 100);

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={fitToScreen}
        className="min-w-[3ch] text-right tabular-nums text-text-muted transition-colors hover:text-text-primary"
        aria-label="Fit to screen"
        title="Fit to screen (0)"
      >
        {pct}%
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.001}
        value={sliderVal}
        onChange={handleChange}
        className="slider-minimal w-24"
        style={{ '--slider-fill': `${pct}%` } as CSSProperties}
        aria-label="Zoom"
      />
    </div>
  );
}

export function TableStatusBar() {
  // M4 — the player variant: scene name, presence, and env badge only. Latency, diagnostics
  // and the armed-tool segment are DM chrome (a player never arms a tool, and Shift+D reads
  // as doing nothing rather than as a hidden control that happens to render empty).
  const isPlayer = useRole() === 'player';
  const diagnostics = useShell((s) => s.diagnostics);
  const openPanelById = useShell((s) => s.openPanelById);
  const sidebarOpen = useShell((s) => s.sidebarOpen);
  const overlay = useOverlayMode();
  // table-shell-redesign D1: clears the inset-mode sidebar so the scene-name button never
  // sits underneath it; overlay-mode sidebars float above everything instead, no inset.
  const leftInset = sidebarOpen && !overlay;
  const [fpsStr, setFpsStr] = useState('—');
  const [ftStr, setFtStr] = useState('—');
  const [fpsColor, setFpsColor] = useState('text-text-muted');
  const connection = useSessionStore((s) => s.connection);
  const latencyMs = useSessionStore((s) => s.latencyMs);
  const sessionEnded = useSessionStore((s) => s.sessionEnded);
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const sceneName = useSessionStore(
    (s) => s.session?.scenes.find((scene) => scene.id === s.session?.activeSceneId)?.name ?? null,
  );
  const activeTool = useActiveTool((s) => s.activeTool);
  const toolDetail = useActiveTool((s) => s.toolDetail);
  const triggersState = useModuleState<TriggersState>('triggers');
  const map = useStore((s) => s.mapSettings);
  const env = sceneId && triggersState ? sceneTriggersOf(triggersState, sceneId).env : {};
  // P2 — the world half of the badge is the same resolver answer the referee gates sight with
  // and the World block shows in full (`worldBadge`), read down to one line. The hour is the
  // clock's now, not a second dial: `env.time` stopped being a source of truth for it.
  //
  // Daylight on a clock nobody has touched is the state every table is in until something
  // happens, so `mirror` is null there — the bar carries the world only when it is something
  // the table can feel, which is the rule this badge already played by.
  const mirror =
    sceneId && triggersState
      ? worldBadge(worldLightOf(map, triggersState, sceneId), map, worldOf(triggersState).nightSky)
          .mirror
      : null;
  const envLabel = [mirror ?? undefined, env.weather !== undefined ? vocabLabel(env.weather) : undefined]
    .filter((v): v is string => v !== undefined)
    .join(' · ');
  const rafRef = useRef(0);
  const frameCountRef = useRef(0);

  // Same cadence as the editor's StatusBar: read every 15th frame ≈ 250ms at 60fps.
  // Off the engine's own ticker (via the singleton) rather than core's fpsMetrics ref —
  // the numbers are Pixi's, and the singleton is the one cross-package handle the table
  // already trusts for the camera.
  useEffect(() => {
    const tick = () => {
      frameCountRef.current++;
      if (frameCountRef.current % 15 === 0) {
        const ticker = getEngineSingleton()?.engine.ticker();
        const nextFps = ticker ? Math.round(ticker.FPS).toString() : '—';
        const nextFt = ticker ? ticker.deltaMS.toFixed(1) : '—';
        const nextColor = ticker ? fpsColorClass(ticker.FPS) : 'text-text-muted';
        setFpsStr((prev) => (prev !== nextFps ? nextFps : prev));
        setFtStr((prev) => (prev !== nextFt ? nextFt : prev));
        setFpsColor((prev) => (prev !== nextColor ? nextColor : prev));
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const conn = CONNECTION[connection];

  return (
    <div
      data-testid="table-status-bar"
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      className={`absolute bottom-0 right-14 z-toolbar flex h-7 items-center justify-between border-t border-border-default bg-surface-1/80 px-3 font-mono text-xs text-text-muted backdrop-blur-sm transition-[left] duration-200 ease-settle motion-reduce:transition-none ${
        leftInset ? 'left-[300px]' : 'left-0'
      }`}
    >
      {/* Left: scene name (opens the Session popover), presence, latency, world light,
          diagnostics (Shift+D, off by default — after the env badge, never before the scene
          name), armed tool */}
      <div className="flex items-center gap-3 tabular-nums" data-testid="connection-status">
        <button
          type="button"
          data-testid="scene-name"
          onClick={() => openPanelById('session')}
          className="rounded font-serif text-[13px] text-text-primary transition-colors duration-150 ease-settle hover:text-accent-active focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus motion-reduce:transition-none"
        >
          {sceneName ?? 'No scene'}
        </button>
        <span>&middot;</span>
        <ConnectionShape connection={connection} />
        <span>{sessionEnded ? 'Session ended' : conn.label}</span>
        {!isPlayer && connection === 'open' && latencyMs !== null && (
          <span className="text-text-secondary">{Math.round(latencyMs)} ms</span>
        )}
        {envLabel && (
          <>
            <span>&middot;</span>
            <span data-testid="env-badge" className="text-text-secondary">
              {envLabel}
            </span>
          </>
        )}
        {!isPlayer && diagnostics && (
          <>
            <span>&middot;</span>
            <span className={fpsColor}>{fpsStr} FPS</span>
            <span>{ftStr}ms</span>
          </>
        )}
        {!isPlayer && activeTool && (
          <>
            <span>&middot;</span>
            {/* table-shell-redesign D3 — the QA-finding fix: an armed tool used to be plain
                text, easy to miss before it silently ate a token drag. A bordered, filled
                chip is the mockup's "Reveal armed · Esc" treatment; accent is earned here —
                this is live state, one of the four Moss accent jobs (chrome-style-guide.md). */}
            <span
              data-testid="active-tool"
              className="flex items-center gap-1.5 rounded-full border border-accent-dim/60 bg-accent-active/10 px-2 py-0.5 text-accent-active"
            >
              {toolLabel(activeTool, toolDetail)}
              <kbd className="rounded border border-border-default bg-surface-2 px-1 font-mono text-[10px] text-text-dim">
                Esc
              </kbd>
            </span>
          </>
        )}
      </div>

      {/* Right: zoom controls, the editor's */}
      <ZoomSlider />
    </div>
  );
}
