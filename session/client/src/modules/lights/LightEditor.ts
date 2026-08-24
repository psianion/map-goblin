// M2 table UI (plan design decision 5) — the DM's light handles: it turns on core's own light
// icons (off by default at the table boot — `GameRenderer.tsx`) and reads clicks/drags off them
// the same way `DoorRenderer` reads door marks. No canvas-tool import, no new render code: a
// `LightChild`'s fields are already everything `LightingRenderer` draws, which is the whole
// point of M2 (`lightSync.ts` header).
//
// Standing overlay, like the door marks: mounted for the life of the seat from the Lights
// panel's `mount` (`LightsPanel.tsx`), and only on seats that can see that DM-only panel — so a
// player never sees an icon or has a light claim their click. The teardown below is the seat's,
// not a popover's: closing the Lights popover leaves the icons up.

import type { RenderEngine } from '@dnd/core/src/engine/RenderEngine';
import type { SceneGraph } from '@dnd/core/src/engine/sceneGraph';
import { isDoubleClick } from '@dnd/core/src/engine/tools/DrawingTool';
import { useStore } from '@dnd/core/src/store/store';
import { useSessionStore } from '../../session/store';
import { isToolActive } from '../../session/tools';
import { lightAt, lightById, patchLightLocal } from './lights';
import { useLightSelection } from './selection';

const send = (action: string, payload: unknown): void =>
  useSessionStore.getState().sendCommand('triggers', action, payload);

/** Screen px a press must travel before a click-to-select counts as a drag instead. */
const DRAG_SLOP_PX = 3;

/** Exported for the tests; production mounts it through `mountWhenEngineReady`. */
export function mountLightsEditor(engine: RenderEngine, sceneGraph: SceneGraph): () => void {
  sceneGraph.lightingRenderer.setIconsVisible(true);

  const canvas = engine.canvas();
  let dragId: string | null = null;
  let dragStart = { x: 0, y: 0 };
  let dragged = false;
  let lastClick: { point: { x: number; y: number }; time: number } | null = null;

  const onMove = (e: PointerEvent) => {
    if (!dragId) return;
    if (!dragged && Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y) > DRAG_SLOP_PX) {
      dragged = true;
    }
    if (!dragged) return;
    const rect = canvas.getBoundingClientRect();
    const world = engine.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    patchLightLocal(dragId, { position: world });
  };

  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    // One `set-light` for the whole drag (task spec), reading back wherever the live preview
    // above actually left it rather than recomputing from the last pointer event.
    if (dragId && dragged) {
      const light = lightById(useStore.getState().layers, dragId);
      if (light) send('set-light', { lightId: dragId, patch: { position: light.position } });
    }
    dragId = null;
  };

  const onDown = (e: PointerEvent) => {
    // Fog's own painting owns the canvas while armed (D11) — a light icon underneath a brush
    // stroke stays a light icon, not a competing click target. Doors/tokens make the same call
    // in the other direction: this handler only claims the press when it actually hits a light,
    // same as `DoorRenderer.onDown`, so a miss falls through to them untouched.
    if (e.button !== 0 || isToolActive()) return;
    if (!canvas.contains(e.target as Node)) return; // the popover's own controls, the rail, …
    const rect = canvas.getBoundingClientRect();
    const local = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const hit = lightAt(useStore.getState().layers, local);
    if (!hit) return;
    // Immediate, and from the capture phase: a light is drawn on top of whatever it lights, so
    // it wins the press outright (the same "lights hit-test first" rule the canvas editor's own
    // hitTest follows). Plain `stopPropagation` on the canvas would not do it — token drag
    // (`tokens/drag.ts`) listens on that same element and would still start a drag under the
    // icon — and the popover's own clear-on-outside-press (`LightPopover.tsx`) would undo the
    // selection this is making.
    e.stopImmediatePropagation();
    e.preventDefault();
    // Double-click flips the light on/off — same command the popover's own switch sends
    // (`set-light` already carries `visible`), and the same in-house detector the canvas's
    // `DoorTool` cycles a door with: world point + `Date.now()`, not a DOM `dblclick`, since
    // this handler is on `pointerdown`. The second press arms no drag, so a quick double tap
    // can't smear the light a pixel sideways on its way to a toggle.
    const world = engine.screenToWorld(local.x, local.y);
    const now = Date.now();
    if (isDoubleClick(lastClick, world, now)) {
      lastClick = null;
      const visible = !hit.light.visible;
      patchLightLocal(hit.light.id, { visible });
      send('set-light', { lightId: hit.light.id, patch: { visible } });
      return;
    }
    lastClick = { point: world, time: now };
    useLightSelection.getState().select(hit.light.id);
    dragId = hit.light.id;
    dragStart = { x: e.clientX, y: e.clientY };
    dragged = false;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  document.addEventListener('pointerdown', onDown, true);
  return () => {
    document.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    useLightSelection.getState().select(null);
    sceneGraph.lightingRenderer.setIconsVisible(false);
  };
}
