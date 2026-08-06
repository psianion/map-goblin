import { getEngineSingleton } from '@dnd/core/src/engine/engineSingleton';
import { getLayerEntries } from '@dnd/core/src/engine/sceneGraph';

/**
 * Read-only scene-graph probe for the e2e lanes. `__pixiApp` is dev-only, and the e2e
 * configs run production builds — without this, "the canvas never went blank during a
 * scene switch" and "the camera moved" have nothing to assert against. Unguarded for the
 * same reason as `__sessionStore` in main.tsx: everything reachable through it is
 * something a script already running on this page could read anyway.
 */
export function installTestProbe(): void {
  const w = window as Window & { __testProbe?: unknown };
  w.__testProbe = {
    /** Per-layer drawn-children counts; a swap must never show zero drawn overall. */
    layers: () =>
      [...getLayerEntries().entries()].map(([id, entry]) => ({
        id,
        drawn: entry.sublayers
          ? Object.values(entry.sublayers).reduce((n, c) => n + c.children.length, 0)
          : entry.container.children.length,
      })),
    /** World-container transform — scene switches must refit it (F3). */
    camera: () => {
      const engine = getEngineSingleton()?.engine;
      if (!engine) return null;
      const stage = engine.stage();
      return { x: stage.position.x, y: stage.position.y, scale: stage.scale.x };
    },
  };
}
