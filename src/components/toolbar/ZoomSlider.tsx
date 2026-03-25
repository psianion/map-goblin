import { useEffect, useRef, useState, useCallback, type CSSProperties } from 'react';
import { getEngineSingleton } from '@/engine/engineSingleton';
import { computeMapWorldBounds } from '@/engine/export/exportPipeline';
import { useStore } from '@/store/store';
import { zoomToFitRef } from './zoomToFitRef';

const MIN_ZOOM = 10;
const MAX_ZOOM = 100;

let animationRafId = 0;

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
    // Cancel any in-flight zoom-to-fit animation
    cancelAnimationFrame(animationRafId);
    animationRafId = 0;

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

  const handleFitToContent = useCallback(() => {
    const singleton = getEngineSingleton();
    if (!singleton) return;

    const stage = singleton.engine.stage();
    const vp = singleton.engine.viewport();
    const layers = useStore.getState().layers;
    const bounds = computeMapWorldBounds(layers);

    const worldWidth = bounds.maxX - bounds.minX;
    const worldHeight = bounds.maxY - bounds.minY;
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;

    const vpWidth = vp.width;
    const vpHeight = vp.height;

    const requiredZoom = Math.min(vpWidth / worldWidth, vpHeight / worldHeight) * 0.9;
    const newZoom = Math.min(Math.max(requiredZoom, MIN_ZOOM), MAX_ZOOM);

    const targetX = vpWidth / 2 - centerX * newZoom;
    const targetY = vpHeight / 2 - centerY * newZoom;

    // Animate to the target position
    cancelAnimationFrame(animationRafId);

    const startZoom = stage.scale.x;
    const startX = stage.position.x;
    const startY = stage.position.y;
    const startTime = performance.now();
    const duration = 150;

    function tick(): void {
      const elapsed = performance.now() - startTime;
      const t = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic

      stage.scale.set(startZoom + (newZoom - startZoom) * ease);
      stage.position.x = startX + (targetX - startX) * ease;
      stage.position.y = startY + (targetY - startY) * ease;

      if (t < 1) {
        animationRafId = requestAnimationFrame(tick);
      } else {
        animationRafId = 0;
      }
    }
    animationRafId = requestAnimationFrame(tick);
  }, []);

  // Expose handleFitToContent for shortcut system
  useEffect(() => {
    zoomToFitRef.current = handleFitToContent;
    return () => {
      zoomToFitRef.current = null;
    };
  }, [handleFitToContent]);

  const sliderVal = zoomToSlider(zoom);
  const pct = Math.round(sliderVal * 100);

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleFitToContent}
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
