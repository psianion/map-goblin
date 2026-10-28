import { useEffect, useRef, useState, useCallback, type CSSProperties } from 'react';
import { zoomToFitRef, cancelZoomAnimationRef } from './zoomToFitRef';
import {
  sliderToZoom,
  zoomToSlider,
  currentZoom,
  setZoomAtCentre,
  fitToContent,
  cancelZoomAnimation,
  zoomPercent,
  DEFAULT_ZOOM,
} from './zoomControl';

export function ZoomSlider() {
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const rafRef = useRef<number>(0);

  // Poll the stage zoom every frame so the slider stays in sync with wheel zoom
  useEffect(() => {
    const tick = () => {
      const z = currentZoom();
      if (z !== null) {
        setZoom((prev) => (Math.abs(prev - z) > 0.01 ? z : prev));
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newZoom = sliderToZoom(parseFloat(e.target.value));
    setZoomAtCentre(newZoom);
    setZoom(newZoom);
  }, []);

  // Expose fit-to-content and cancelAnimation for shortcut system + input handlers
  useEffect(() => {
    zoomToFitRef.current = fitToContent;
    cancelZoomAnimationRef.current = cancelZoomAnimation;
    return () => {
      zoomToFitRef.current = null;
      cancelZoomAnimationRef.current = null;
    };
  }, []);

  const sliderVal = zoomToSlider(zoom);
  const pct = zoomPercent(zoom);

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={fitToContent}
        className="font-mono text-panel-small text-text-muted hover:text-text-primary tabular-nums min-w-[3ch] text-right transition-colors"
        title="Fit to content (Ctrl+0)"
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
        className="w-24 slider-minimal"
        style={{ '--slider-fill': `${pct}%` } as CSSProperties}
      />
    </div>
  );
}
