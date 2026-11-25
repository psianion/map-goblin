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
import type { TokensState } from '@dnd/mechanics/tokens';
import { useSessionStore } from '../../session/store';
import { hitTest } from '../tokens/drag';
import { tokensOf } from '../tokens/TokenRenderer';
import { isToolActive } from '../../session/tools';
import { useAsPlayers } from '../fog/asPlayers';
import { lightAt, lightById, lightPropAt, patchLightLocal, propToggle, sendSwitch, switchIdsOf } from './lights';
import { useLightSelection } from './selection';
import { notify } from '@dnd/ui/toast';

const send = (action: string, payload: unknown): void =>
  useSessionStore.getState().sendCommand('triggers', action, payload);

/** Screen px a press must travel before a click-to-select counts as a drag instead. */
const DRAG_SLOP_PX = 3;

/** Exported for the tests; production mounts it through `mountWhenEngineReady`. */
export function mountLightsEditor(engine: RenderEngine, sceneGraph: SceneGraph): () => void {
  // "As players see it" shows the DM a player's screen, and a player has no light icons.
  const showIcons = (): void => sceneGraph.lightingRenderer.setIconsVisible(!useAsPlayers.getState().on);
  showIcons();
  const unsubAsPlayers = useAsPlayers.subscribe(showIcons);

  const canvas = engine.canvas();
  let dragId: string | null = null;
  let dragStart = { x: 0, y: 0 };
  let dragged = false;
  /** The pressed light is fixed to a prop: a drag says so once and moves nothing. */
  let fixed = false;
  let told = false;
  let lastClick: { point: { x: number; y: number }; time: number } | null = null;
  /** The last press on a light prop: its first click falls through, its second switches it. */
  let lastPropClick: { point: { x: number; y: number }; time: number } | null = null;
  /** Whether the pointer cursor over a light prop is this file's doing, so it only undoes its own. */
  let pointing = false;

  // Over a light prop the DM's cursor says it can be switched; a player's never changes (this
  // overlay is only mounted on seats that see the Lights panel, and "As players" turns it off).
  const onHover = (e: PointerEvent) => {
    if (drag()) return;
    const rect = canvas.getBoundingClientRect();
    const over =
      !isToolActive() &&
      !useAsPlayers.getState().on &&
      lightPropAt(useStore.getState().layers, engine.screenToWorld(e.clientX - rect.left, e.clientY - rect.top)) !== null;
    if (over && !pointing) {
      canvas.style.cursor = 'pointer';
      pointing = true;
    } else if (!over && pointing) {
      canvas.style.cursor = '';
      pointing = false;
    }
  };
  const drag = (): boolean => dragId !== null;

  const onMove = (e: PointerEvent) => {
    if (!dragId) return;
    if (!dragged && Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y) > DRAG_SLOP_PX) {
      dragged = true;
    }
    if (!dragged) return;
    // A light fixed to a prop stays with it: the table moves no props, so it moves no fixed light.
    if (fixed) {
      if (!told) notify.info('This light is fixed to its prop');
      told = true;
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const world = engine.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    patchLightLocal(dragId, { position: world });
  };

  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    // One `set-light` for the whole drag (task spec), reading back wherever the live preview
    // above actually left it rather than recomputing from the last pointer event.
    if (dragId && dragged && !fixed) {
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
    if (e.button !== 0 || isToolActive() || useAsPlayers.getState().on) return;
    if (!canvas.contains(e.target as Node)) return; // the popover's own controls, the rail, …
    const rect = canvas.getBoundingClientRect();
    const local = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const hit = lightAt(useStore.getState().layers, local);
    if (!hit) {
      onPropPress(e, local);
      return;
    }
    // The table's rule: a token under the pointer wins over a light. Lights are the DM's
    // furniture; tokens are what people at the table click. The press falls through to
    // token input (`tokens/drag.ts`), which listens on the canvas after this.
    const { session } = useSessionStore.getState();
    const at = engine.screenToWorld(local.x, local.y);
    if (hitTest(tokensOf(session?.modules.tokens as TokensState | undefined, session?.activeSceneId), at.x, at.y)) return;
    // Immediate, and from the capture phase: a light is drawn on top of whatever it lights, so
    // it wins the press over doors and the map; a token is the one exception, above. Plain
    // `stopPropagation` on the canvas would not do it: token drag (`tokens/drag.ts`) listens
    // on that same element and would still start a drag under the icon.
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
      if (hit.light.darkness) {
        // A darkness source is not one of the table's lights to switch: its own edit, as before.
        patchLightLocal(hit.light.id, { visible });
        send('set-light', { lightId: hit.light.id, patch: { visible } });
      } else {
        // With its group, as one `set-lights`.
        sendSwitch(switchIdsOf(useStore.getState().layers, [hit.light.id]), visible);
      }
      return;
    }
    lastClick = { point: world, time: now };
    useLightSelection.getState().select(hit.light.id);
    dragId = hit.light.id;
    fixed = !!hit.light.attachedTo;
    told = false;
    dragStart = { x: e.clientX, y: e.clientY };
    dragged = false;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  /**
   * A press off every light icon, on a prop with lights attached: the first falls through (to a
   * pan, a token, a door) and only arms the double-click; the second switches the prop's lights
   * and their groups, one `set-lights`. A token under the pointer still wins.
   */
  function onPropPress(e: PointerEvent, local: { x: number; y: number }): void {
    const world = engine.screenToWorld(local.x, local.y);
    const prop = lightPropAt(useStore.getState().layers, world);
    if (!prop) {
      lastPropClick = null;
      return;
    }
    const { session } = useSessionStore.getState();
    if (hitTest(tokensOf(session?.modules.tokens as TokensState | undefined, session?.activeSceneId), world.x, world.y)) return;
    const now = Date.now();
    if (!isDoubleClick(lastPropClick, world, now)) {
      lastPropClick = { point: world, time: now };
      return;
    }
    lastPropClick = null;
    const toggle = propToggle(useStore.getState().layers, prop.id);
    if (!toggle) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    sendSwitch(toggle.ids, toggle.on);
  }

  document.addEventListener('pointerdown', onDown, true);
  canvas.addEventListener('pointermove', onHover);
  return () => {
    canvas.removeEventListener('pointermove', onHover);
    if (pointing) canvas.style.cursor = '';
    unsubAsPlayers();
    document.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    useLightSelection.getState().select(null);
    sceneGraph.lightingRenderer.setIconsVisible(false);
  };
}
