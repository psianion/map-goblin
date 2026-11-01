import { getEngineSingleton } from '@/engine/engineSingleton';
import { INITIAL_ZOOM } from '@/engine/PixiRenderEngine';
import { computeMapWorldBounds } from '@/engine/export/exportPipeline';
import { useStore } from '@/store/store';
import { viewportInsetsRef } from './zoomToFitRef';

/**
 * Stage zoom shared by every zoom control: the status-bar slider, the fit button and the
 * Ctrl+0 shortcut all move the same stage the same way, whichever chrome draws them.
 */
export const MIN_ZOOM = 10;
export const MAX_ZOOM = 100;
/** The zoom a map opens at (screen px per square), which every readout calls 100%. */
export const DEFAULT_ZOOM = INITIAL_ZOOM;

/** The zoom as a percentage of {@link DEFAULT_ZOOM}, so a freshly opened map reads 100%. */
export function zoomPercent(zoom: number): number {
  return Math.round((zoom / DEFAULT_ZOOM) * 100);
}

let animationRafId = 0;

/** Convert linear slider [0,1] → exponential zoom */
export function sliderToZoom(t: number): number {
  return MIN_ZOOM * Math.pow(MAX_ZOOM / MIN_ZOOM, t);
}

/** Convert zoom → linear slider [0,1] */
export function zoomToSlider(zoom: number): number {
  return Math.log(zoom / MIN_ZOOM) / Math.log(MAX_ZOOM / MIN_ZOOM);
}

/** The stage's current zoom (screen px per square), or null before the engine is up. */
export function currentZoom(): number | null {
  const singleton = getEngineSingleton();
  return singleton ? singleton.engine.stage().scale.x : null;
}

export function cancelZoomAnimation(): void {
  cancelAnimationFrame(animationRafId);
  animationRafId = 0;
}

/** Zoom toward the centre of the viewport. */
export function setZoomAtCentre(newZoom: number): void {
  // Cancel any in-flight zoom-to-fit animation
  cancelZoomAnimation();
  const singleton = getEngineSingleton();
  if (!singleton) return;

  const stage = singleton.engine.stage();
  const vp = singleton.engine.viewport();
  const cx = vp.width / 2;
  const cy = vp.height / 2;
  const oldZoom = stage.scale.x;

  stage.position.x = cx - (cx - stage.position.x) * (newZoom / oldZoom);
  stage.position.y = cy - (cy - stage.position.y) * (newZoom / oldZoom);
  stage.scale.set(newZoom);
}

export function fitToContent(): void {
  fitToBounds(computeMapWorldBounds(useStore.getState().layers));
}

/** Frame the camera on a world box (a layer's content), the way Fit frames the map. */
export function fitToBounds(bounds: { minX: number; minY: number; maxX: number; maxY: number }): void {
  const singleton = getEngineSingleton();
  if (!singleton) return;

  const stage = singleton.engine.stage();
  const vp = singleton.engine.viewport();

  let worldWidth = bounds.maxX - bounds.minX;
  let worldHeight = bounds.maxY - bounds.minY;

  // Guard against near-zero dimensions (single point or collinear content)
  if (worldWidth < 1) worldWidth = 10;
  if (worldHeight < 1) worldHeight = 10;

  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;

  // Fit into the gap the overlaid panels leave, not the full window — otherwise the map
  // centres behind the sidebars and opens half-hidden.
  const insets = viewportInsetsRef.current;
  const top = insets.top ?? 0;
  const vpWidth = Math.max(1, vp.width - insets.left - insets.right);
  const vpHeight = Math.max(1, vp.height - top - insets.bottom);

  const requiredZoom = Math.min(vpWidth / worldWidth, vpHeight / worldHeight) * 0.9;
  const newZoom = Math.min(Math.max(requiredZoom, MIN_ZOOM), MAX_ZOOM);

  const targetX = insets.left + vpWidth / 2 - centerX * newZoom;
  const targetY = top + vpHeight / 2 - centerY * newZoom;

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
}
