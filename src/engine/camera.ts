import type { RenderEngine } from './RenderEngine';

/**
 * Listen for DPR changes (e.g., moving window between displays).
 * Returns a cleanup function.
 */
export function listenDprChanges(engine: RenderEngine): () => void {
  let query: MediaQueryList | null = null;

  const update = () => {
    const dpr = window.devicePixelRatio;
    engine.setResolution(dpr);
    // Re-attach with new DPR value
    query?.removeEventListener('change', update);
    query = window.matchMedia(`(resolution: ${dpr}dppx)`);
    query.addEventListener('change', update, { once: true });
  };

  query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  query.addEventListener('change', update, { once: true });

  return () => {
    query?.removeEventListener('change', update);
  };
}
