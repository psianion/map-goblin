// §2.4.3 — the door overlay: one mark per door showing the state the *table* is playing it
// at, and the click that changes it.
//
// The map's own door art (core's `doorRenderer`) draws the authored state and knows nothing
// about the session, so this sits above it: a door glyph that says open / shut / secret right
// now. The DM's overlay alone (D2 — they work the doors, and the server refuses everyone
// else), so a player's canvas carries no mark and no click target at all; their fast path is
// the art redraw below and asking out loud. Lock and reveal-secret live inline in the panel,
// never behind a modal.

import { Container, Graphics, Sprite } from 'pixi.js';
import { renderDoors } from '@dnd/core/src/engine/doorRenderer';
import { lucideTexture } from '@dnd/core/src/engine/lucideIcons';
import type { RenderEngine } from '@dnd/core/src/engine/RenderEngine';
import type { SceneGraph } from '@dnd/core/src/engine/sceneGraph';
import { isDoubleClick } from '@dnd/core/src/engine/tools/DrawingTool';
import { resolveDoors, resolveWalls } from '@dnd/core/src/shared/wallResolve';
import { useStore } from '@dnd/core/src/store/store';
import type { DoorsState } from '@dnd/mechanics/doors';
import {
  addScreenOverlay,
  mountWhenEngineReady,
  shownMaskOf,
  worldPointOf,
} from '../../renderer/overlayLayer';
import { useSessionStore } from '../../session/store';
import { isToolActive } from '../../session/tools';
import { REVEAL_MS, easeOutQuart, revealDurationMs } from '../fog/FogRenderer';
import { doorAt, doorLook, liveDoors, type LiveDoor } from './doors';
import { useDoorSelection } from './selection';

/** World units (grid cells). Readable at the editor's default zoom without shouting. */
const MARK_RADIUS = 0.26;
/**
 * The glyph's height in world units — a shade over a half-square, so a door still reads as a
 * door at the zoom a table plays at, where the old disc only read as "a dot".
 */
const GLYPH_WU = 0.75;
/** Rasterized once at this size and sized in world units, so zoom costs nothing. */
const GLYPH_PX = 48;

const send = (action: string, payload: unknown): void =>
  useSessionStore.getState().sendCommand('doors', action, payload);

/**
 * The scene's doors at their live state, for anything that needs to know what a door is
 * doing right now. The lighting lane's wall input reads this: a shut door is a wall (D12),
 * so it needs the authored geometry and the live flag together.
 */
export function liveSceneDoors(): LiveDoor[] {
  const session = useSessionStore.getState().session;
  return liveDoors(
    useStore.getState().layers,
    session?.modules?.doors as DoorsState | undefined,
    session?.activeSceneId,
  );
}

/**
 * Fires whenever `liveSceneDoors()` could have changed — a door command landing, a scene
 * change, or a new map. Both stores replace their slices wholesale, so identity is the
 * whole test.
 */
export function subscribeLiveDoors(onChange: () => void): () => void {
  let last: unknown[] = [];
  const check = () => {
    const session = useSessionStore.getState().session;
    const next = [session?.modules?.doors, session?.activeSceneId, useStore.getState().layers];
    if (next.length === last.length && next.every((v, i) => v === last[i])) return;
    last = next;
    onChange();
  };
  check();
  const unsubSession = useSessionStore.subscribe(check);
  const unsubMap = useStore.subscribe(check);
  return () => {
    unsubSession();
    unsubMap();
  };
}

/**
 * The door ids that just arrived — the reveal beat's trigger — and the set to remember.
 *
 * `known === null` is a first paint: a fresh mount, or a scene change. It fades nothing,
 * because the drama belongs to the secret the DM just revealed, not to arriving at a table
 * that already has doors in it. An empty list is never a diff either: a fog delta reloads
 * the whole map document (GameRenderer), so a frame caught with no doors in hand must not
 * make every door "new" on the frame after.
 */
export function trackDoorIds(
  known: ReadonlySet<string> | null,
  ids: readonly string[],
): { arrived: string[]; known: ReadonlySet<string> | null } {
  if (ids.length === 0) return { arrived: [], known };
  return {
    arrived: known ? ids.filter((id) => !known.has(id)) : [],
    known: new Set(ids),
  };
}

/**
 * A four-point star — "there is more here than the map says". It rides the glyph's top-right
 * corner rather than its middle: gold alone would leave the secret to colour, and a star over
 * the door art would leave it unreadable.
 */
function drawSecretBadge(g: Graphics, x: number, y: number, color: number, alpha: number): void {
  const s = GLYPH_WU * 0.16;
  for (const [dx, dy] of [
    [1, 0],
    [0, 1],
  ]) {
    g.moveTo(x - dx * s, y - dy * s);
    g.lineTo(x + dx * s, y + dy * s);
  }
  g.stroke({ color, width: s * 0.28, alpha, cap: 'round' });
}

/** Exported for the tests; production mounts it through `mountDoorLayerWhenReady`. */
export function mountDoorLayer(engine: RenderEngine, sceneGraph: SceneGraph): () => void {
  const layer = new Container();
  const art = new Container();
  const paint = new Graphics();
  const marks = new Container();
  marks.label = 'doorMarks';
  // Hidden until a stencil says otherwise (`applyStencil`), so the frames between this mount
  // and the fog's own cannot show a door over ground that is about to be covered.
  art.visible = false;
  // Art first, marks over it: the mark is the interaction affordance and has to stay legible
  // on top of whatever the door is drawn as. `paint` carries what is drawn *around* a glyph —
  // the selection ring and the secret badge — so the glyph sprites sort above it.
  layer.addChild(art);
  layer.addChild(paint);
  layer.addChild(marks);
  // Screen space, not the world, and that is the whole of the fix for "the player's canvas
  // never moved when a door opened". The player's fog mask is a screen-space layer (D12 —
  // the lighting is composited beneath it), and no world-space child can sort above one,
  // whatever `OVERLAY_STACK` says. A door sits on a room boundary, so the scrim's own edge
  // covered ~95% of its mark. Drawing above the mask is bounded by wearing the mask's own
  // shown stencil in `tick` — see `applyStencil` — because redaction alone does not bound it.
  // Nothing here is clickable; the doors read the DOM canvas directly, below.
  layer.eventMode = 'none';
  addScreenOverlay(sceneGraph, layer, 'doorOverlay');

  let doors: LiveDoor[] = [];
  /** One reused sprite per door — never a new one per frame (frame budget, as below). */
  const glyphs = new Map<string, Sprite>();
  // The reveal beat (PRODUCT — the one dramatic play beat): a door mark that was not on the
  // player's map last frame fades in over the same 300ms the fog reveal takes. The DM is
  // exempt: their secret door was always there, at full opacity, badge and all.
  let known: ReadonlySet<string> | null = null;
  let fadeScene: string | null = null;
  const fading = new Map<string, number>();

  const fadeAlpha = (id: string, now: number): number => {
    const startedAt = fading.get(id);
    if (startedAt === undefined) return 1;
    const t = (now - startedAt) / REVEAL_MS;
    if (t >= 1) {
      fading.delete(id);
      return 1;
    }
    return easeOutQuart(t);
  };

  /**
   * The map's own door art, drawn a second time — above the fog mask, for the player seat.
   *
   * Core draws every door into the world container, which on a player's screen sits under
   * the fog scrim *and* under the lighting multiply. The scrim only cuts holes for room
   * polygons, and a door sits on the wall *between* two rooms — room boundaries are detected
   * inset by half a wall width, so the door band falls outside every hole there is. The DM
   * has neither the scrim nor the multiply, which is the whole of why one door measured 262
   * warm-wood pixels on that seat and exactly zero here.
   *
   * What bounds the redraw is the stencil, not redaction. The server ships a room whole the
   * moment any of it is swept, so in vision mode a player legitimately *holds* doors standing
   * on ground their own mask still hides — and this copy, drawn above that mask, put two lit
   * doors out on an otherwise black canvas (the reported leak). It wears `shownMask` instead:
   * clear tier plus memory, which is precisely where the map is drawn for this seat. The DM is
   * skipped — their copy in the world is already lit, and a second one would pay twice.
   *
   * ponytail: the player's buried world copy is still drawn and simply never seen. Hiding
   * core's doors sublayer would save it, and would mean reaching into the scene graph to do
   * it — worth doing the day a map has enough doors for the double draw to show up in a
   * frame budget.
   */
  const drawArt = () => {
    for (const child of art.removeChildren()) child.destroy({ children: true });
    if (useSessionStore.getState().you?.role === 'dm') return;

    const cell = useStore.getState().grid.snapDivision || 1;
    for (const dungeon of useStore.getState().layers) {
      if (dungeon.type !== 'dungeon') continue;
      // The layer holds only the doors this seat was sent, so the resolve is already the
      // held set — the same list the marks below are drawn from.
      const resolved = resolveDoors(dungeon, resolveWalls(dungeon)).filter((d) => d.door.visible);
      if (resolved.length > 0) renderDoors(art, resolved, dungeon.style, cell);
    }
  };

  const draw = () => {
    // Archways are dropped here rather than in each consumer: a hole in a wall has nothing to
    // open, close or lock (the server refuses every command on one), so it gets no mark and
    // no click target. `doors` is the overlay's list, not the scene's — the lighting lane
    // reads `liveSceneDoors()` for that.
    doors = liveSceneDoors().filter(({ door }) => door.style !== 'archway');
    const selectedId = useDoorSelection.getState().selectedId;
    const now = performance.now();

    const sceneId = useSessionStore.getState().session?.activeSceneId ?? null;
    // A different scene is a different set of doors; nothing carries over.
    if (sceneId !== fadeScene) {
      fadeScene = sceneId;
      known = null;
      fading.clear();
    }
    const arrivals = trackDoorIds(known, doors.map(({ door }) => door.id));
    known = arrivals.known;
    // Reduced motion cuts instead of fading, so it simply never starts one.
    if (useSessionStore.getState().you?.role !== 'dm' && revealDurationMs() > 0) {
      for (const id of arrivals.arrived) fading.set(id, now);
    }

    paint.clear();

    // D2 — the DM's overlay alone. A player has nothing to click (the server refuses their
    // toggle) and nothing to read that the door art above the fog does not already say.
    const drawn = new Set<string>();
    if (useSessionStore.getState().you?.role === 'dm') {
      for (const { door, live } of doors) {
        const look = doorLook(door, live);
        const [x, y] = door.position;
        // Full opacity, always. A secret door on the DM's map is not a hint, it is a door.
        // The only thing that ever moves this number is the arrival fade above.
        const alpha = look.alpha * fadeAlpha(door.id, now);

        // The glyph is the state: a door standing open, or one shut in its frame. Colour only
        // seconds it (parchment, or gold for a secret) — the same two looks `doorLook` names.
        let glyph = glyphs.get(door.id);
        if (!glyph) {
          glyph = new Sprite();
          glyph.anchor.set(0.5);
          marks.addChild(glyph);
          glyphs.set(door.id, glyph);
        }
        drawn.add(door.id);
        glyph.texture = lucideTexture(live.open ? 'door-open' : 'door-closed', GLYPH_PX);
        glyph.setSize(GLYPH_WU);
        glyph.position.set(x, y);
        glyph.tint = look.color;
        glyph.alpha = alpha;

        if (look.badge === 'secret') {
          drawSecretBadge(paint, x + GLYPH_WU * 0.44, y - GLYPH_WU * 0.44, look.color, alpha);
        }

        if (door.id === selectedId) {
          paint
            .circle(x, y, GLYPH_WU * 0.72)
            .stroke({ color: 0xffffff, width: MARK_RADIUS * 0.16, alpha: 0.85 * alpha });
        }
      }
    }

    for (const [id, glyph] of glyphs) {
      if (drawn.has(id)) continue;
      glyph.destroy();
      glyphs.delete(id);
    }
  };

  // Per frame: mirror the camera, because the layer lives in screen space now, and advance
  // any fade.
  //
  // ponytail: the whole overlay is repainted per frame while a door is fading, rather than
  // giving each fading mark its own Graphics. A scene has tens of doors and a fade lasts
  // 300ms; split them out if a map ever makes this show up in a frame budget.
  /**
   * A door mark reaches exactly as far as the map does on this seat.
   *
   * The stencil is the fog's own `shownMask` — the clear tier and the memory tier together —
   * so a remembered room keeps its doors (where a door is stops being a secret once the room
   * around it has been seen, unlike a token's live position) and never-seen ground shows
   * none. Looked up per frame rather than once, on the token layer's rationale: the fog
   * mounts on its own schedule and the seat is not known until the join snapshot lands.
   *
   * `null` is the answer on every seat the fog draws no mask for — a DM outside sight
   * preview, and any scene with no fog at all — so it cannot be read as "wear nothing, draw
   * freely". The player-side art is gated on it instead: no stencil, no redraw, and the map's
   * own world copy is what shows, which is the fail-dark direction. The DM's glyphs are not
   * gated (they are the seat's controls, and their world copy is unmasked anyway), but they
   * do wear the stencil while a sight preview is running — a preview that drew marks the
   * previewed token cannot see would be lying about what the player sees.
   */
  const applyStencil = () => {
    const stencil = shownMaskOf(sceneGraph);
    if (layer.mask !== stencil) layer.mask = stencil;
    const shown = stencil !== null;
    if (art.visible !== shown) art.visible = shown;
  };

  const world = sceneGraph.worldContainer;
  const tick = () => {
    layer.position.copyFrom(world.position);
    layer.scale.copyFrom(world.scale);
    applyStencil();
    if (fading.size > 0) draw();
  };

  // The bubble phase, where token input takes the capture phase on this same canvas. At the
  // target the capture listeners run first whatever order they were added in, so a token
  // standing in a doorway wins the press (its `stopImmediatePropagation` ends the event before
  // this runs) — tokens are dragged, doors are only tapped. This used to ride on registration
  // order instead, with both in capture: the old sidebar mounted TokenPanel before DoorPanel,
  // the rail mounts Doors before Tokens, and placing a token on a door then swung the door.
  const canvas = engine.canvas();
  // One click picks the door up (the menu opens off the selection), two swing it — the same
  // split, and the same detector, the canvas's own DoorTool uses. A press that only ever
  // toggled meant no way to read a door without changing it, and no way to reach the DM's
  // lock/reveal buttons without one.
  let lastClick: { point: { x: number; y: number }; time: number } | null = null;
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 || isToolActive()) return;
    if (useSessionStore.getState().you?.role !== 'dm') return;
    const point = worldPointOf(engine, e);
    if (!point) return;
    const hit = doorAt(doors, point.x, point.y);
    if (!hit) return;
    e.stopPropagation();
    e.preventDefault();
    // Re-selected on both clicks: `DoorMenu`'s capture listener clears the selection on every
    // press over the map, so the second click of a double would otherwise close the menu it
    // just acted through.
    useDoorSelection.getState().select(hit.door.id);
    const now = Date.now();
    if (isDoubleClick(lastClick, point, now)) {
      lastClick = null;
      send('toggle', { id: hit.door.id });
      return;
    }
    lastClick = { point, time: now };
  };

  canvas.addEventListener('pointerdown', onDown);
  const ticker = engine.ticker();
  ticker.add(tick);
  // Same feed the lighting lane will read, so there is one answer to "what are the doors
  // doing" and the overlay cannot drift from the walls. It draws once on subscribe.
  // The art only changes when the doors or the document do — never on a selection or a fade
  // frame — so it is rebuilt here rather than inside `draw`.
  const unsubDoors = subscribeLiveDoors(() => {
    drawArt();
    draw();
  });
  let lastSelected = useDoorSelection.getState().selectedId;
  const unsubSelection = useDoorSelection.subscribe(() => {
    const selected = useDoorSelection.getState().selectedId;
    if (selected === lastSelected) return;
    lastSelected = selected;
    draw();
  });

  return () => {
    canvas.removeEventListener('pointerdown', onDown);
    ticker.remove(tick);
    unsubDoors();
    unsubSelection();
    // The engine may already be gone (GameRenderer unmounting first).
    try {
      if (!layer.destroyed) layer.destroy({ children: true });
    } catch {
      /* engine torn down first */
    }
  };
}

/** Call from an effect; the returned function is the effect's cleanup. */
export const mountDoorLayerWhenReady = (pollMs?: number): (() => void) =>
  mountWhenEngineReady(mountDoorLayer, pollMs);
