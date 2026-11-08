import { getEngineSingleton } from '@dnd/core/src/engine/engineSingleton';
import type { RenderEngine } from '@dnd/core/src/engine/RenderEngine';
import { fitMap, fitZoom, zoomStep } from '../renderer/cameraInput';

/** The camera's zoom as a share of the fit zoom ("100%" is the opening view); null before a map. */
export function readZoomPercent(): number | null {
  const engine = getEngineSingleton()?.engine;
  if (!engine) return null;
  const fit = fitZoom(engine);
  return fit ? Math.round((engine.stage().scale.x / fit) * 100) : null;
}

const withEngine = (fn: (engine: RenderEngine) => void) => (): void => {
  const engine = getEngineSingleton()?.engine;
  if (engine) fn(engine);
};

export const zoomIn = withEngine((e) => zoomStep(e, 1));
export const zoomOut = withEngine((e) => zoomStep(e, -1));
export const zoomFit = withEngine((e) => void fitMap(e));
