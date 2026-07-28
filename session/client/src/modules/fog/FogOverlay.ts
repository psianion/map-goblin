// §2.4.4 — the DM's fog overlay, and the fog tool's pointer handling.
//
// This is the *DM* view: a tint that says which rooms the party cannot see, plus the room
// under the cursor while the tool is armed. The player-facing mask is a different thing
// built by a different layer (D10) — nothing here ever renders for a player.
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
/** Warm torchlight — the map's own accent language, not a UI blue. */
const HOVER_COLOR = 0xf0a252;
/** Explored mark: warm parchment, quiet enough to sit under a token. */
const GLYPH_COLOR = 0xd8cfc0;

/** Where the fog tool sends its clicks. */
const send = (action: string, payload: unknown): void =>
  useSessionStore.getState().sendCommand('fog', action, payload);

/**
 * A tick that says "you have been here": a check drawn at the room's centroid. Not colour,
 * not brightness — a mark, so "explored" is still legible when both are washed out.
 */
function drawExploredGlyph(g: Graphics, [cx, cy]: [number, number]): void {
  const s = 0.34;
  g.moveTo(cx - s, cy);
  g.lineTo(cx - s * 0.25, cy + s * 0.62);
  g.lineTo(cx + s, cy - s * 0.62);
  g.stroke({ color: GLYPH_COLOR, width: 0.11, alpha: 0.8, cap: 'round', join: 'round' });
}

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
  // The tint and the glyph stay in the world on purpose. A darkening wash still darkens
  // under a multiply, and both have to keep drawing *under* the DM's tokens and doors —
  // that draw order is PRODUCT principle 3 (`OVERLAY_STACK`), and lifting them over the
  // composite would lift them over those layers too.
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
      if (look.glyph) drawExploredGlyph(paint, room.centroid);
    }

    const hovered = toolArmed() ? rooms.find((r) => r.id === hoverRoomId) : undefined;
    if (hovered && hovered.boundary.length >= 3) {
      hover.poly(hovered.boundary.flat()).fill({ color: HOVER_COLOR, alpha: 0.1 });
      hover.poly(hovered.boundary.flat()).stroke({ color: HOVER_COLOR, width: 0.08, alpha: 0.95 });
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
