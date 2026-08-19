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
import {
  fogModeOf,
  regionOf,
  tableRegion,
  type Cell,
  type FogState,
  type Frame,
} from '@dnd/mechanics/fog';
import {
  addScreenOverlay,
  addWorldOverlay,
  mountWhenEngineReady,
  worldPointOf,
} from '../../renderer/overlayLayer';
import { prefersReducedMotion } from '../../session/motion';
import { useSessionStore } from '../../session/store';
import { useActiveTool } from '../../session/tools';
import { BRUSH_FLUSH_CELLS, useFogBrush, type BrushOp } from './brush';
import { featherEdge } from './FogRenderer';
import { MASK_MEMORY, createLivingFog } from './livingFog';
import {
  DM_FOG_LOOK,
  cellAt,
  cellRect,
  fogActionFor,
  fogFrame,
  regionRects,
  roomAt,
  roomFog,
  sceneFog,
  serverRooms,
} from './fog';

/** Near-black, matching the art guide's dungeon negative space rather than a grey wash. */
const FOG_TINT = 0x05060a;
/** The hover outline. Full strength on every state — the DM's cursor is never ghosted. */
const HOVER_STROKE = { width: 0.08, alpha: 0.95 };
/**
 * The brush cursor: one cell, white, the way every overlay in this product marks a thing the
 * DM is about to change. Not the room hover's state colours — the brush is not asking about a
 * room's state, it is showing the square it will write.
 */
const BRUSH_CURSOR = { color: 0xffffff, fillAlpha: 0.12, width: 0.05, alpha: 0.9 };
/**
 * The region record, on the DM's own canvas: the cells the party actually holds.
 *
 * Without it the brush is blind. The room tint answers by the room, so the first stroke into
 * an unseen room lightens it once and every stroke after that changes nothing a DM can see —
 * they would be painting a reveal they cannot read back. The wash is `re_hidden`'s own drained
 * parchment at a fraction of its weight, so it says "memory" in the vocabulary the tint already
 * uses, and it is light enough that it cannot be mistaken for a room the DM has lit.
 */
const REGION_WASH = { color: 0xd8cfc0, alpha: 0.1 };

/** Where the fog tool sends its clicks. */
const send = (action: string, payload: unknown): void =>
  useSessionStore.getState().sendCommand('fog', action, payload);

function mountFogOverlay(engine: RenderEngine, sceneGraph: SceneGraph): () => void {
  const layer = new Container();
  const paint = new Graphics();
  // The DM's breathing haze: the same cloud shader as the player's fog at a fraction of
  // the weight, drawn *over* the tint — which stays, both as the state's flat reading and
  // as the look this seat falls back to if the shader never draws. The mesh lives in the
  // world container, so the lighting composite grades it along with the map beneath it.
  const haze = createLivingFog(engine, { dense: 0.26, mist: 0.13, rim: 0.3 });
  layer.addChild(paint, haze.mesh);
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
  /** The cell under the cursor while the brush is armed — the room hover's counterpart. */
  let hoverCell: Cell | null = null;

  const isDm = () => useSessionStore.getState().you?.role === 'dm';
  const toolArmed = () => isDm() && useActiveTool.getState().activeTool === 'fog';

  const sceneFogNow = () => {
    const { session } = useSessionStore.getState();
    return sceneFog(session?.modules?.fog as FogState | undefined, session?.activeSceneId ?? null);
  };

  const frameNow = (): Frame | null => fogFrame(useSessionStore.getState().mapData);

  /**
   * The brush is a sub-mode of the armed tool (P4 §2) and a vision-mode one: the region record
   * is what a rooms-mode mask never draws, so painting cells there would write memory nothing
   * renders. Rooms-mode clicks stay exactly what they were.
   *
   * And a scene whose frame is past `REGION_CELL_MAX` keeps no region record at all — the
   * referee refuses every cell of such a stroke, so the brush must not enter painting there.
   * The panel disables the button for the same reason; this is the half that holds when the
   * flag is already on.
   */
  const brushArmed = () => {
    if (!toolArmed() || !useFogBrush.getState().on) return false;
    if (fogModeOf(sceneFogNow()) !== 'vision') return false;
    const frame = frameNow();
    return frame !== null && regionOf(frame) !== undefined;
  };

  /**
   * The swept cells as row runs, remembered on the *mask's own bytes*.
   *
   * `regionRects` decodes the whole record, and P5 made a miss cost that per seat: the table's
   * memory is every seat's record ORed together (`tableRegion`) — the party record alone would
   * freeze at the moment the DM flipped the switch and leave the DM's wash lying about what the
   * table has seen (principle 3). Meanwhile a redraw happens per *cell* crossed during a brush
   * stroke, and per fog write of any kind.
   *
   * So the key is the base64 the union is built from, not the fog slice's identity. A fog
   * `state-update` is fresh JSON every time (§2.5 — the slice is replaced wholesale), and it
   * fires for every set-mode, share flip, auto-explore toggle and room reveal, none of which
   * touch a single cell: on slice identity every one of those re-decoded and re-ran the union
   * for bytes that had not changed. Strings compare by reference first, so the hover-move case
   * — same slice, same string objects — is still a pointer test.
   *
   * `mapData` rides in the key because the frame is a pure function of it, and the frame is
   * what re-bases the union (`tableRegion`, D3): a republish that moves the map must not draw
   * yesterday's cells at today's origin.
   *
   * ponytail: still a fresh Graphics rebuild per redraw. At 512×512 (`REGION_CELL_MAX`) that is
   * a few thousand rects; if a stroke ever stutters, the next step is drawing the wash into a
   * RenderTexture and blitting it rather than re-recording the polys.
   */
  let cachedKey: unknown[] = [];
  let cachedRects: ReturnType<typeof regionRects> = [];
  const rectsOf = (scene: FogState['byScene'][string], mapData: unknown) => {
    const key = [
      mapData,
      scene.region?.bits,
      ...Object.values(scene.regions ?? {}).map((mask) => mask.bits),
    ];
    if (key.length !== cachedKey.length || key.some((v, i) => v !== cachedKey[i])) {
      cachedKey = key;
      cachedRects = regionRects(tableRegion(scene, fogFrame(mapData) ?? undefined));
    }
    return cachedRects;
  };

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

    // The haze's own tier mask: white is clear, black an unrevealed room, `MASK_MEMORY` an
    // explored one — the same vocabulary the tint speaks, as texels. Feathered in white so
    // the coastline has a ramp to meander across at each room's rim.
    const hazeFrame = frameNow();
    haze.mesh.visible = hazeFrame !== null;
    if (hazeFrame) {
      haze.maskPaint.clear();
      haze.maskPaint
        .rect(hazeFrame.minX, hazeFrame.minY, hazeFrame.maxX - hazeFrame.minX, hazeFrame.maxY - hazeFrame.minY)
        .fill({ color: 0xffffff, alpha: 1 });
      for (const room of rooms) {
        if (room.boundary.length < 3) continue;
        const status = roomFog(fog, room.id).status;
        if (status === 'revealed') continue;
        haze.maskPaint
          .poly(room.boundary.flat())
          .fill({ color: status === 'never_revealed' ? 0x000000 : MASK_MEMORY, alpha: 1 });
        featherEdge(haze.maskPaint, room.boundary, 0xffffff);
      }
      haze.setMaskBounds(hazeFrame);
      haze.renderMask();
      haze.cover(hazeFrame);
    }

    // …and over that, in vision mode, the cells themselves — drawn from the same record the
    // player's mask reads, as merged row runs rather than a square per cell (`regionRects`).
    // Rooms mode has no cell tier at all, and painting one there would say something the
    // player's canvas does not.
    if (fogModeOf(fog) === 'vision') {
      for (const rect of rectsOf(fog, mapData)) {
        paint.poly(rect.flat()).fill(REGION_WASH);
      }
    }

    // The brush replaces the room highlight rather than adding to it: with the brush armed a
    // drag writes cells, so a whole room lit under the cursor would promise an act the drag
    // is not about to perform. The cursor is the write's exact footprint — the eraser's disc
    // of cells, or the box marquee mid-drag.
    const frame = hoverCell && brushArmed() ? frameNow() : null;
    if (frame && hoverCell) {
      const { size, shape } = useFogBrush.getState();
      if (shape === 'box' && boxStart && boxEnd) {
        const [c0, r0, c1, r1] = boxSpan(boxStart, boxEnd);
        const [x0, y0] = cellRect(frame, [c0, r0])[0];
        const [x1, y1] = cellRect(frame, [c1, r1])[2];
        const rect = [x0, y0, x1, y0, x1, y1, x0, y1];
        hover.poly(rect).fill({ color: BRUSH_CURSOR.color, alpha: BRUSH_CURSOR.fillAlpha });
        hover
          .poly(rect)
          .stroke({ color: BRUSH_CURSOR.color, width: BRUSH_CURSOR.width, alpha: BRUSH_CURSOR.alpha });
        return;
      }
      const footprint = shape === 'box' ? 1 : size;
      for (const cell of disc(hoverCell, footprint)) {
        hover
          .poly(cellRect(frame, cell).flat())
          .fill({ color: BRUSH_CURSOR.color, alpha: BRUSH_CURSOR.fillAlpha });
      }
      // One ring around the whole footprint rather than a stroke per cell — the brush is
      // one instrument, and its rim is where the next stamp lands.
      const [cx, cy] = [frame.minX + hoverCell[0] + 0.5, frame.minY + hoverCell[1] + 0.5];
      hover
        .circle(cx, cy, footprint / 2)
        .stroke({ color: BRUSH_CURSOR.color, width: BRUSH_CURSOR.width, alpha: BRUSH_CURSOR.alpha });
      return;
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
    // The haze's clock — the one per-frame cost this layer has. Reduced motion freezes it.
    if (layer.visible && !prefersReducedMotion()) haze.advance(ticker.deltaMS / 1000);
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
      useFogBrush.getState().on,
      // The cursor's footprint moves with these two, so they redraw it like a move does.
      useFogBrush.getState().size,
      useFogBrush.getState().shape,
      // The cell as a key: the tuple is compared by identity, and a fresh `[col, row]` on
      // every pointermove would redraw the whole layer for a cursor that has not moved.
      hoverCell?.join(),
      boxEnd?.join(),
    ];
    if (next.length === last.length && next.every((v, i) => v === last[i])) return;
    last = next;
    draw();
  };

  // ── The brush stroke (P4 §2) ─────────────────────────────────────────────
  // One `region-set` per flush, and a flush is a fog write the whole table sees. So the stroke
  // is gathered here and sent in batches: every `BRUSH_FLUSH_CELLS` mid-drag, so the players
  // watch the reveal appear as the DM paints it, and always again on pointerup however short
  // the stroke was. `painted` dedupes across the whole stroke, not just the batch — a DM
  // scrubbing back and forth over one doorway must not send that cell forty times.

  let painting = false;
  let strokeOp: BrushOp = 'reveal';
  let batch: Cell[] = [];
  const painted = new Set<string>();
  let lastCell: Cell | null = null;
  /** The frame the stroke opened on — measured once, not per stamp (the DM's copy has no
   * stamped frame, so `frameNow` recomputes it from the layers every call). */
  let strokeFrame: Frame | null = null;
  /** The box marquee's two corners, in cells. Non-null exactly while a box drag runs. */
  let boxStart: Cell | null = null;
  let boxEnd: Cell | null = null;

  const flush = () => {
    if (batch.length === 0) return;
    send('region-set', { op: strokeOp, cells: batch });
    batch = [];
  };

  const mark = (cell: Cell) => {
    const key = cell.join();
    if (painted.has(key)) return;
    painted.add(key);
    batch.push(cell);
    // The flush pace scales with the brush: a wide eraser lays cells an order faster than
    // the one-cell brush the constant was tuned for, and the point of the number is "the
    // players watch the reveal appear at the pace the DM paints it".
    if (batch.length >= BRUSH_FLUSH_CELLS * useFogBrush.getState().size) flush();
  };

  /** The eraser's footprint: the cells inside a disc of `size` cells diameter. */
  const disc = (center: Cell, size: number): Cell[] => {
    const r = size / 2;
    const reach = Math.ceil(r - 0.5);
    const cells: Cell[] = [];
    for (let dr = -reach; dr <= reach; dr++) {
      for (let dc = -reach; dc <= reach; dc++) {
        if (dc * dc + dr * dr <= r * r) cells.push([center[0] + dc, center[1] + dr]);
      }
    }
    return cells;
  };

  /** Stamp the disc at one path cell, clamped to the frame — the referee refuses any cell
   * outside the scene, and one bad cell refuses the whole write. */
  const stamp = (cell: Cell) => {
    if (!strokeFrame) return;
    const cols = Math.round(strokeFrame.maxX - strokeFrame.minX);
    const rows = Math.round(strokeFrame.maxY - strokeFrame.minY);
    for (const [col, row] of disc(cell, useFogBrush.getState().size)) {
      if (col >= 0 && row >= 0 && col < cols && row < rows) mark([col, row]);
    }
  };

  // ponytail: 128 cells per side is the box's ceiling — the marquee simply stops growing
  // there, which the DM sees as they drag. Bigger asks exist ("Reveal all") and a full
  // 512×512 rectangle is a multi-megabyte write nobody means by a drag.
  const BOX_MAX = 128;

  /** The marquee's cell span, clamped to the ceiling from its anchor corner. */
  const boxSpan = (a: Cell, b: Cell): [number, number, number, number] => {
    const held = (from: number, to: number) =>
      from + Math.max(1 - BOX_MAX, Math.min(BOX_MAX - 1, to - from));
    const [c1, r1] = [held(a[0], b[0]), held(a[1], b[1])];
    return [Math.min(a[0], c1), Math.min(a[1], r1), Math.max(a[0], c1), Math.max(a[1], r1)];
  };

  /** Release writes the whole rectangle, in slices the wire is comfortable with. */
  const commitBox = () => {
    if (!boxStart || !boxEnd || !strokeFrame) return;
    const cols = Math.round(strokeFrame.maxX - strokeFrame.minX);
    const rows = Math.round(strokeFrame.maxY - strokeFrame.minY);
    const [c0, r0, c1, r1] = boxSpan(boxStart, boxEnd);
    const cells: Cell[] = [];
    for (let row = Math.max(0, r0); row <= Math.min(rows - 1, r1); row++) {
      for (let col = Math.max(0, c0); col <= Math.min(cols - 1, c1); col++) {
        cells.push([col, row]);
      }
    }
    for (let i = 0; i < cells.length; i += 1024) {
      send('region-set', { op: strokeOp, cells: cells.slice(i, i + 1024) });
    }
  };

  /**
   * Every cell between the last one painted and this one.
   *
   * A pointermove is sampled, not continuous: a flick across the map at 120Hz still jumps
   * several cells between events, and a brush that painted only where the events landed would
   * leave a dashed stroke. Stepping the segment in whole-cell increments is the whole fix —
   * the count is the longer axis, so no step can skip a cell.
   */
  const paintTo = (cell: Cell) => {
    const from = lastCell;
    lastCell = cell;
    if (!from) return stamp(cell);
    const [dc, dr] = [cell[0] - from[0], cell[1] - from[1]];
    const steps = Math.max(Math.abs(dc), Math.abs(dr));
    for (let i = 1; i <= steps; i++) {
      stamp([from[0] + Math.round((dc * i) / steps), from[1] + Math.round((dr * i) / steps)]);
    }
  };

  /** The cell under a pointer, or null off the canvas / off the frame. */
  const cellUnder = (e: PointerEvent): Cell | null => {
    const point = worldPointOf(engine, e);
    const frame = point && frameNow();
    return point && frame ? cellAt(frame, point.x, point.y) : null;
  };

  // ── Input ────────────────────────────────────────────────────────────────
  // Document capture, so an armed tool is answered before anything on the canvas gets a
  // look — a click in fog mode is a fog click, never a token grab.
  const onMove = (e: PointerEvent) => {
    if (!toolArmed()) {
      if (hoverRoomId === null && hoverCell === null) return;
      hoverRoomId = null;
      hoverCell = null;
      sync();
      return;
    }
    if (brushArmed()) {
      const cell = cellUnder(e);
      if (boxStart && cell) {
        // The drag owns the pointer, and the marquee follows it.
        e.stopPropagation();
        e.preventDefault();
        boxEnd = cell;
      }
      if (painting && cell) {
        // The drag owns the pointer: releasing it to the canvas mid-stroke would pan the map
        // out from under the cells being painted.
        e.stopPropagation();
        e.preventDefault();
        paintTo(cell);
      }
      if (!boxStart && cell?.join() === hoverCell?.join()) return;
      hoverCell = cell;
      hoverRoomId = null;
      sync();
      return;
    }
    hoverCell = null;
    const point = worldPointOf(engine, e);
    const next = point ? (roomAt(rooms, point.x, point.y)?.id ?? null) : null;
    if (next === hoverRoomId) return;
    hoverRoomId = next;
    sync();
  };

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 || !toolArmed()) return;
    if (brushArmed()) {
      const cell = cellUnder(e);
      // Off the frame is unpainted map, and a left-drag out there still pans (the same rule
      // the room click has about unzoned map).
      if (!cell) return;
      e.stopPropagation();
      e.preventDefault();
      // Alt is the modifier, read once at the start: a stroke is one op end to end, so
      // letting go of the key halfway cannot leave half of it revealed and half hidden.
      const { op, shape } = useFogBrush.getState();
      strokeOp = e.altKey ? (op === 'reveal' ? 'hide' : 'reveal') : op;
      strokeFrame = frameNow();
      if (shape === 'box') {
        boxStart = cell;
        boxEnd = cell;
        hoverCell = cell;
        sync();
        return;
      }
      painting = true;
      painted.clear();
      batch = [];
      lastCell = null;
      paintTo(cell);
      hoverCell = cell;
      sync();
      return;
    }
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

  // Anywhere, not only on the canvas: a stroke that ends off-screen still has to land, or the
  // cells the DM painted on the way out are lost with the pointer.
  const onUp = () => {
    if (boxStart) {
      commitBox();
      boxStart = null;
      boxEnd = null;
      sync();
    }
    if (!painting) return;
    painting = false;
    lastCell = null;
    flush();
  };

  const onLeave = () => {
    if (hoverRoomId === null && hoverCell === null) return;
    hoverRoomId = null;
    hoverCell = null;
    sync();
  };

  document.addEventListener('pointermove', onMove, true);
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('pointerup', onUp, true);
  document.addEventListener('pointercancel', onUp, true);
  document.addEventListener('pointerleave', onLeave, true);
  // No core-store subscription: everything this draws now comes off the session store.
  const unsubSession = useSessionStore.subscribe(sync);
  const unsubTool = useActiveTool.subscribe(() => {
    // Leaving the tool leaves the brush behind with it: a flag surviving a disarm makes
    // re-arming re-enter cell painting silently, on a click the DM meant for a room.
    if (!toolArmed() && useFogBrush.getState().on) useFogBrush.getState().setOn(false);
    sync();
  });
  // The brush is a thing this layer *draws* (the cell cursor instead of the room highlight),
  // so toggling it has to repaint now rather than on the next pointer event.
  const unsubBrush = useFogBrush.subscribe(sync);
  sync();

  return () => {
    // A stroke in flight when the table unmounts is still the DM's act: send it.
    onUp();
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('pointerup', onUp, true);
    document.removeEventListener('pointercancel', onUp, true);
    document.removeEventListener('pointerleave', onLeave, true);
    unsubSession();
    unsubTool();
    unsubBrush();
    // The engine may already be gone (GameRenderer unmounting first) — its objects are
    // destroyed and touching them throws.
    try {
      ticker.remove(tick);
      haze.destroy();
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
