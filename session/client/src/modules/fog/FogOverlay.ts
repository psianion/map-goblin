// §2.4.4 — the DM's fog overlay, and the fog tool's pointer handling.
//
// This is the *DM* view: a tint that says which rooms the party cannot see, plus the room
// under the cursor while the tool is armed — highlighted in that room's own state, so the
// cursor answers "what am I about to change" and not only "what am I over" (D11). The
// player-facing mask is a different thing built by a different layer (D10) — nothing here
// ever renders for a player.
//
// Nothing here tweens, and that is the design rather than an omission. The hover highlight
// tracks a pointer, so easing it would only make it lag; the tint changes when the DM
// changes the state, so a fade would say "still deciding" about a decision already made.
// The one dramatic exception in the product — the player's reveal fade — is a play beat and
// belongs to the player renderer. With nothing animated, reduced motion has nothing to turn
// off here, and the DM's view is identical either way.
//
// ponytail: pixi through @dnd/core, the same reach-through TokenRenderer documents.
import { Container, Graphics } from 'pixi.js';
import type { Room } from '@dnd/core/src/shared/types';
import type { RenderEngine } from '@dnd/core/src/engine/RenderEngine';
import type { SceneGraph } from '@dnd/core/src/engine/sceneGraph';
import type { FogState } from '@dnd/mechanics/fog';
import {
  addScreenOverlay,
  addWorldOverlay,
  mountWhenEngineReady,
  worldPointOf,
} from '../../renderer/overlayLayer';
import { useSessionStore } from '../../session/store';
import { useActiveTool } from '../../session/tools';
import { DM_FOG_LOOK, fogActionFor, roomAt, roomFog, sceneFog, serverRooms } from './fog';

/** Near-black, matching the art guide's dungeon negative space rather than a grey wash. */
const FOG_TINT = 0x05060a;
/** The hover outline. Full strength on every state — the DM's cursor is never ghosted. */
const HOVER_STROKE = { width: 0.08, alpha: 0.95 };

/** Where the fog tool sends its clicks. */
const send = (action: string, payload: unknown): void =>
  useSessionStore.getState().sendCommand('fog', action, payload);

function mountFogOverlay(engine: RenderEngine, sceneGraph: SceneGraph): () => void {
  const layer = new Container();
  const paint = new Graphics();
  layer.addChild(paint);
  addWorldOverlay(sceneGraph, layer, 'fogOverlay');

  // The hover highlight is the DM's cursor, not map content, and it is the one thing this
  // layer draws that has to be *brighter* than what is beneath it. The engine composites
  // lighting as a screen-space multiply after the world (see `addScreenOverlay`), so on an
  // unlit dungeon a warm stroke drawn in the world survives at about 7%: measured on the
  // gate map, hovering a room moved the canvas by 1.1/255, which is the "no highlight at
  // all" the browser gate read as byte-identical.
  //
  // The tint stays in the world on purpose. A darkening wash still darkens under a
  // multiply, and it has to keep drawing *under* the DM's tokens and doors — that draw
  // order is PRODUCT principle 3 (`OVERLAY_STACK`), and lifting it over the composite would
  // lift it over those layers too.
  const cursor = new Container();
  const hover = new Graphics();
  cursor.addChild(hover);
  // Nothing here is clickable; the fog tool reads the DOM canvas directly.
  cursor.eventMode = 'none';
  addScreenOverlay(sceneGraph, cursor, 'fogOverlay');

  let rooms: Room[] = [];
  let hoverRoomId: string | null = null;

  const isDm = () => useSessionStore.getState().you?.role === 'dm';
  const toolArmed = () => isDm() && useActiveTool.getState().activeTool === 'fog';

  const draw = () => {
    const { session, mapData } = useSessionStore.getState();
    const sceneId = session?.activeSceneId ?? null;
    // The server's rooms, not core's re-detected ones: on a map nobody zoned core invents
    // rooms the referee has never heard of, and tinting those paints a DM's whole map dark
    // over rooms no fog command can even name.
    rooms = serverRooms(mapData);
    const fog = sceneFog(session?.modules?.fog as FogState | undefined, sceneId);

    // The overlay is the DM's alone: a player never has room polygons to tint in the first
    // place (never-revealed geometry is stripped server-side, D4).
    layer.visible = isDm();
    cursor.visible = layer.visible;
    paint.clear();
    hover.clear();
    if (!layer.visible) return;

    for (const room of rooms) {
      if (room.boundary.length < 3) continue;
      const look = DM_FOG_LOOK[roomFog(fog, room.id).status];
      if (look.tintAlpha > 0) {
        paint.poly(room.boundary.flat()).fill({ color: FOG_TINT, alpha: look.tintAlpha });
      }
    }

    // D11 asks the hover to name the room's *state*, not merely its outline, so it is drawn
    // from the same table the tint is: torchlight on a lit room, parchment on a memory, cold
    // slate on one nobody has seen. Both are what the click is about to change.
    const hovered = toolArmed() ? rooms.find((r) => r.id === hoverRoomId) : undefined;
    if (hovered && hovered.boundary.length >= 3) {
      const look = DM_FOG_LOOK[roomFog(fog, hovered.id).status];
      const path = hovered.boundary.flat();
      hover.poly(path).fill({ color: look.hoverColor, alpha: look.hoverAlpha });
      hover.poly(path).stroke({ color: look.hoverColor, ...HOVER_STROKE });
    }
  };

  // Per frame: mirror the camera, because the cursor layer lives in screen space. Nothing
  // is redrawn here — the highlight is rebuilt when the pointer moves and then just drawn.
  const world = sceneGraph.worldContainer;
  const tick = (): void => {
    cursor.position.copyFrom(world.position);
    cursor.scale.copyFrom(world.scale);
  };
  const ticker = engine.ticker();
  ticker.add(tick);

  // The session store fires on every ping, so redraw only when something this layer
  // actually draws from moved. Slice identity is enough: the store replaces its slices
  // wholesale (§2.5), never mutates them.
  let last: unknown[] = [];
  const sync = () => {
    const { session, you, mapData } = useSessionStore.getState();
    const next = [
      you?.role,
      session?.activeSceneId,
      session?.modules?.fog,
      // Replaced wholesale on a load and on every merged reveal delta — the rooms this
      // draws come off it, so identity is the whole test.
      mapData,
      useActiveTool.getState().activeTool,
      hoverRoomId,
    ];
    if (next.length === last.length && next.every((v, i) => v === last[i])) return;
    last = next;
    draw();
  };

  // ── Input ────────────────────────────────────────────────────────────────
  // Document capture, so an armed tool is answered before anything on the canvas gets a
  // look — a click in fog mode is a fog click, never a token grab.
  const onMove = (e: PointerEvent) => {
    if (!toolArmed()) {
      if (hoverRoomId === null) return;
      hoverRoomId = null;
      sync();
      return;
    }
    const point = worldPointOf(engine, e);
    const next = point ? (roomAt(rooms, point.x, point.y)?.id ?? null) : null;
    if (next === hoverRoomId) return;
    hoverRoomId = next;
    sync();
  };

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 || !toolArmed()) return;
    const point = worldPointOf(engine, e);
    if (!point) return;
    const room = roomAt(rooms, point.x, point.y);
    // ponytail: unzoned map is not claimed, so a left-drag out there still pans. Panning
    // from inside a room needs the middle button while the tool is armed — give the fog
    // click a drag threshold if that ever grates.
    if (!room) return;
    e.stopPropagation();
    e.preventDefault();
    const sceneId = useSessionStore.getState().session?.activeSceneId;
    const status = roomFog(
      sceneFog(useSessionStore.getState().session?.modules?.fog as FogState | undefined, sceneId),
      room.id,
    ).status;
    send(fogActionFor(status), { roomId: room.id });
  };

  const onLeave = () => {
    if (hoverRoomId === null) return;
    hoverRoomId = null;
    sync();
  };

  document.addEventListener('pointermove', onMove, true);
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('pointerleave', onLeave, true);
  // No core-store subscription: everything this draws now comes off the session store.
  const unsubSession = useSessionStore.subscribe(sync);
  const unsubTool = useActiveTool.subscribe(sync);
  sync();

  return () => {
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('pointerleave', onLeave, true);
    unsubSession();
    unsubTool();
    // The engine may already be gone (GameRenderer unmounting first) — its objects are
    // destroyed and touching them throws.
    try {
      ticker.remove(tick);
      if (!layer.destroyed) layer.destroy({ children: true });
      if (!cursor.destroyed) cursor.destroy({ children: true });
    } catch {
      /* engine torn down first */
    }
  };
}

/** Call from an effect; the returned function is the effect's cleanup. */
export const mountFogOverlayWhenReady = (pollMs?: number): (() => void) =>
  mountWhenEngineReady(mountFogOverlay, pollMs);
