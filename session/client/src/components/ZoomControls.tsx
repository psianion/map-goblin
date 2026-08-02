import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { getEngineSingleton } from '@dnd/core/src/engine/engineSingleton';
import { MAX_ZOOM } from '../renderer/camera';
import { fitMap, minZoom, zoomAbout } from '../renderer/cameraInput';

/**
 * The editor's zoom control, at the table: a percentage that fits-to-screen when
 * clicked, and the same exponential slider over the same 10–100 zoom scale
 * (canvas/src/components/toolbar/ZoomSlider.tsx). Floats over the map's corner —
 * the table has no status bar to live in.
 */
const SLIDER_MIN = 10;

const sliderToZoom = (t: number): number => SLIDER_MIN * Math.pow(MAX_ZOOM / SLIDER_MIN, t);
const zoomToSlider = (zoom: number): number =>
  Math.log(zoom / SLIDER_MIN) / Math.log(MAX_ZOOM / SLIDER_MIN);

export function ZoomControls() {
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
    zoomAbout(engine.stage(), width / 2, height / 2, target / engine.stage().scale.x, minZoom(engine), MAX_ZOOM);
    setZoom(engine.stage().scale.x);
  }, []);

  const handleFit = useCallback(() => {
    const engine = getEngineSingleton()?.engine;
    if (engine) fitMap(engine);
  }, []);

  // A fit on a big map can rest below the slider's 10-floor — clamp the track, not the camera.
  const sliderVal = Math.max(0, Math.min(1, zoomToSlider(zoom)));
  const pct = Math.round(sliderVal * 100);

  return (
    <div className="absolute bottom-2 right-2 z-10 flex items-center gap-2 rounded bg-surface-0/80 px-2 py-1 backdrop-blur-sm">
      <button
        onClick={handleFit}
        className="min-w-[3ch] text-right font-mono text-xs tabular-nums text-text-secondary transition-colors hover:text-text-primary"
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
