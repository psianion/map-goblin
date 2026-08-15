import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { getEngineSingleton } from '@dnd/core/src/engine/engineSingleton';
import type { TriggersState } from '@dnd/mechanics/triggers';
import { sceneTriggersOf } from '@dnd/mechanics/triggers';
import { vocabLabel } from '@dnd/core/src/shared/prep';
import { useModuleState, useSessionStore } from '../session/store';
import { MAX_ZOOM } from '../renderer/camera';
import { fitMap, minZoom, zoomAbout } from '../renderer/cameraInput';

/**
 * The editor's status bar, at the table: FPS and frame time on the left, the connection
 * where the editor shows cursor coordinates (the table's equivalent vital sign), and the
 * same exponential zoom slider on the right. No X/Y — nobody authors here.
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

const CONNECTION = {
  connecting: { label: 'Connecting', dot: 'bg-amber-400' },
  open: { label: 'Connected', dot: 'bg-emerald-400' },
  reconnecting: { label: 'Reconnecting', dot: 'bg-amber-400 animate-pulse' },
  closed: { label: 'Disconnected', dot: 'bg-red-500' },
} as const;

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
  const [fpsStr, setFpsStr] = useState('—');
  const [ftStr, setFtStr] = useState('—');
  const [fpsColor, setFpsColor] = useState('text-text-muted');
  const connection = useSessionStore((s) => s.connection);
  const latencyMs = useSessionStore((s) => s.latencyMs);
  const sessionEnded = useSessionStore((s) => s.sessionEnded);
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const triggersState = useModuleState<TriggersState>('triggers');
  const env = sceneId && triggersState ? sceneTriggersOf(triggersState, sceneId).env : {};
  const envLabel = [
    env.time !== undefined ? vocabLabel(env.time) : undefined,
    env.weather !== undefined ? vocabLabel(env.weather) : undefined,
    // Daylight is the level every scene is at until a DM says otherwise (S3 P3 §1), so saying
    // it would be chrome about nothing — the badge carries the light level only when it is
    // something the table can feel.
    env.ambient !== undefined && env.ambient !== 'daylight' ? vocabLabel(env.ambient) : undefined,
  ]
    .filter((v): v is string => v !== undefined)
    .join(', ');
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
      className="absolute inset-x-0 bottom-0 z-10 flex h-7 items-center justify-between border-t border-border-default bg-surface-1/80 px-3 font-mono text-xs text-text-muted backdrop-blur-sm"
    >
      {/* Left: FPS metrics + connection */}
      <div className="flex items-center gap-3 tabular-nums" data-testid="connection-status">
        <span className={fpsColor}>{fpsStr} FPS</span>
        <span>&middot;</span>
        <span>{ftStr}ms</span>
        <span>&middot;</span>
        <span className={`h-2 w-2 shrink-0 rounded-full ${conn.dot}`} aria-hidden />
        <span>{sessionEnded ? 'Session ended' : conn.label}</span>
        {connection === 'open' && latencyMs !== null && (
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
      </div>

      {/* Right: zoom controls, the editor's */}
      <ZoomSlider />
    </div>
  );
}

/** Fit-to-screen, top-left over the map — the editor's Maximize control. */
export function FitScreenButton() {
  return (
    <button
      onClick={fitToScreen}
      title="Fit to screen (0)"
      aria-label="Fit to screen"
      className="absolute left-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded border border-border-default bg-surface-1/80 text-text-secondary backdrop-blur-sm transition-colors hover:text-text-primary"
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M8 3H5a2 2 0 0 0-2 2v3" />
        <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
        <path d="M3 16v3a2 2 0 0 0 2 2h3" />
        <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
      </svg>
    </button>
  );
}
