// Where the runner's own Pixi layers live in the engine's world container, and how they
// get there. Everything the session draws on top of the authored map — fog tint, door
// state, tokens — is a session-state overlay, so none of it belongs in @dnd/core's scene
// graph; it is stacked above `layerContainer` from here instead.

import type { Container } from 'pixi.js';
import { getEngineSingleton } from '@dnd/core/src/engine/engineSingleton';
import type { RenderEngine } from '@dnd/core/src/engine/RenderEngine';
import type { SceneGraph } from '@dnd/core/src/engine/sceneGraph';

/**
 * Bottom to top. Fog tint sits under everything the DM must never lose sight of: a hidden
 * token or a secret door in an unrevealed room renders at full opacity *over* the tint,
 * which is the whole of PRODUCT principle 3 expressed as a draw order.
 *
 * Layers place themselves by label, so mount order does not decide the stack — the panels
 * that mount them are ordered by what a DM wants to read, not by what must draw first.
 */
export const OVERLAY_STACK = ['fogOverlay', 'doorOverlay', 'tokenLayer'] as const;

export type OverlayLabel = (typeof OVERLAY_STACK)[number];

/** Add an overlay to the world container at its place in `OVERLAY_STACK`. */
export function addWorldOverlay(sceneGraph: SceneGraph, layer: Container, label: OverlayLabel): void {
  layer.label = label;
  const world = sceneGraph.worldContainer;
  const base = world.getChildIndex(sceneGraph.layerContainer) + 1;
  const rank = OVERLAY_STACK.indexOf(label);

  // Land directly above the last overlay that belongs below this one; failing that, on the
  // map itself. `addChildAt` pushes whatever sat there upwards, so overlays that belong on
  // top stay on top however late this one arrives.
  let index = base;
  for (let i = base; i < world.children.length; i++) {
    const other = OVERLAY_STACK.indexOf(world.children[i].label as OverlayLabel);
    if (other >= 0 && other < rank) index = i + 1;
  }
  world.addChildAt(layer, index);
}

/**
 * Mount a Pixi layer for as long as an engine exists, and re-mount when it is replaced.
 *
 * The engine is booted asynchronously by GameRenderer and cleared when it unmounts, and
 * module code may not edit the shell to get a ready callback — so this watches for one.
 * Call from an effect; the returned function is the effect's cleanup.
 */
export function mountWhenEngineReady(
  mount: (engine: RenderEngine, sceneGraph: SceneGraph) => () => void,
  pollMs = 200,
): () => void {
  let mounted: SceneGraph | null = null;
  let unmount: (() => void) | null = null;

  const check = () => {
    const current = getEngineSingleton();
    if ((current?.sceneGraph ?? null) === mounted) return;
    unmount?.();
    unmount = null;
    mounted = current?.sceneGraph ?? null;
    if (current) unmount = mount(current.engine, current.sceneGraph);
  };

  check();
  const timer = setInterval(check, pollMs);
  return () => {
    clearInterval(timer);
    unmount?.();
  };
}

/** World-space point under a pointer event, or null when it is not over the canvas. */
export function worldPointOf(engine: RenderEngine, e: PointerEvent): { x: number; y: number } | null {
  const canvas = engine.canvas();
  if (e.target !== canvas) return null;
  const rect = canvas.getBoundingClientRect();
  return engine.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
}
