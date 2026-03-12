import { useEffect, useRef, useState, useCallback } from 'react';
import { getEngineSingleton } from '@/engine/engineSingleton';

const MIN_ZOOM = 10;
const MAX_ZOOM = 100;

/** Convert linear slider [0,1] → exponential zoom */
function sliderToZoom(t: number): number {
  return MIN_ZOOM * Math.pow(MAX_ZOOM / MIN_ZOOM, t);
}

/** Convert zoom → linear slider [0,1] */
function zoomToSlider(zoom: number): number {
  return Math.log(zoom / MIN_ZOOM) / Math.log(MAX_ZOOM / MIN_ZOOM);
}

export function ZoomSlider() {
  const [zoom, setZoom] = useState(20);
  const rafRef = useRef<number>(0);

  // Poll the stage zoom every frame so the slider stays in sync with wheel zoom
  useEffect(() => {
    const tick = () => {
      const singleton = getEngineSingleton();
      if (singleton) {
        const currentZoom = singleton.engine.stage().scale.x;
        setZoom((prev) => (Math.abs(prev - currentZoom) > 0.01 ? currentZoom : prev));
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const t = parseFloat(e.target.value);
    const newZoom = sliderToZoom(t);
    const singleton = getEngineSingleton();
    if (!singleton) return;

    const stage = singleton.engine.stage();
    const vp = singleton.engine.viewport();
    const cx = vp.width / 2;
    const cy = vp.height / 2;
    const oldZoom = stage.scale.x;

    // Zoom toward center of viewport
    stage.position.x = cx - (cx - stage.position.x) * (newZoom / oldZoom);
    stage.position.y = cy - (cy - stage.position.y) * (newZoom / oldZoom);
    stage.scale.set(newZoom);
    setZoom(newZoom);
  }, []);

  const handleReset = useCallback(() => {
    const singleton = getEngineSingleton();
    if (!singleton) return;
    const stage = singleton.engine.stage();
    const vp = singleton.engine.viewport();
    const cx = vp.width / 2;
    const cy = vp.height / 2;
    const oldZoom = stage.scale.x;
    const newZoom = 20;
    stage.position.x = cx - (cx - stage.position.x) * (newZoom / oldZoom);
    stage.position.y = cy - (cy - stage.position.y) * (newZoom / oldZoom);
    stage.scale.set(newZoom);
    setZoom(newZoom);
  }, []);

  const pct = Math.round((zoom / MAX_ZOOM) * 100);

  return (
    <div className="flex items-center gap-2 bg-surface-1/80 backdrop-blur-sm rounded-md px-3 py-1.5 border border-border">
      <button
        onClick={handleReset}
        className="text-xs text-muted-foreground hover:text-foreground tabular-nums min-w-[3ch] text-right"
        title="Reset zoom"
      >
        {pct}%
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.001}
        value={zoomToSlider(zoom)}
        onChange={handleChange}
        className="w-24 h-1 accent-accent cursor-pointer"
      />
    </div>
  );
}
