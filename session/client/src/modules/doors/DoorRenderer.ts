// §2.4.3 — the door overlay: one mark per door showing the state the *table* is playing it
// at, and the click that changes it.
//
// The map's own door art (core's `doorRenderer`) draws the authored state and knows nothing
// about the session, so this sits above it: a small mark that says open / shut / locked /
// secret right now. Anyone may click one (D2); the DM's lock and reveal-secret affordances
// live inline in the panel, never behind a modal.

import { Container, Graphics } from 'pixi.js';
import { renderDoors } from '@dnd/core/src/engine/doorRenderer';
import type { RenderEngine } from '@dnd/core/src/engine/RenderEngine';
import type { SceneGraph } from '@dnd/core/src/engine/sceneGraph';
import { resolveDoors, resolveWalls } from '@dnd/core/src/shared/wallResolve';
import { useStore } from '@dnd/core/src/store/store';
import type { DoorsState } from '@dnd/mechanics/doors';
import { addScreenOverlay, mountWhenEngineReady, worldPointOf } from '../../renderer/overlayLayer';
import { useSessionStore } from '../../session/store';
import { isToolActive } from '../../session/tools';
import { REVEAL_MS, easeOutQuart, revealDurationMs } from '../fog/FogRenderer';
import { doorAt, doorLook, liveDoors, type LiveDoor } from './doors';
import { useDoorSelection } from './selection';

/** World units (grid cells). Readable at the editor's default zoom without shouting. */
const MARK_RADIUS = 0.26;

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

/** A four-point star — "there is more here than the map says". */
function drawSecretBadge(g: Graphics, x: number, y: number, color: number, alpha: number): void {
  const s = MARK_RADIUS * 0.85;
  for (const [dx, dy] of [
    [1, 0],
    [0, 1],
  ]) {
    g.moveTo(x - dx * s, y - dy * s);
    g.lineTo(x + dx * s, y + dy * s);
  }
  g.stroke({ color, width: MARK_RADIUS * 0.22, alpha, cap: 'round' });
}

/** Exported for the tests; production mounts it through `mountDoorLayerWhenReady`. */
export function mountDoorLayer(engine: RenderEngine, sceneGraph: SceneGraph): () => void {
  const layer = new Container();
  const art = new Container();
  const paint = new Graphics();
  // Art first, marks over it: the mark is the interaction affordance and has to stay legible
  // on top of whatever the door is drawn as.
  layer.addChild(art);
  layer.addChild(paint);
  // Screen space, not the world, and that is the whole of the fix for "the player's canvas
  // never moved when a door opened". The player's fog mask is a screen-space layer (D12 —
  // the lighting is composited beneath it), and no world-space child can sort above one,
  // whatever `OVERLAY_STACK` says. A door sits on a room boundary, so the scrim's own edge
  // covered ~95% of its mark. What the player holds has already been redacted by the referee
  // (PRODUCT principle 2), so drawing above the mask leaks nothing — see `OVERLAY_STACK`.
  // Nothing here is clickable; the doors read the DOM canvas directly, below.
  layer.eventMode = 'none';
  addScreenOverlay(sceneGraph, layer, 'doorOverlay');

  let doors: LiveDoor[] = [];
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
   * Redrawing it in the overlay is safe for the same reason the marks are: the server has
   * already cut a player's doors down to the ones they earned (PRODUCT principle 2), so this
   * shows nothing the referee did not hand over. The DM is skipped — their copy in the world
   * is already lit, and a second one would just pay for itself twice.
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
    doors = liveSceneDoors();
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

    for (const { door, live } of doors) {
      const look = doorLook(door, live);
      const [x, y] = door.position;
      // Full opacity, always. A secret door on the DM's map is not a hint, it is a door.
      // The only thing that ever moves this number is the arrival fade above.
      const alpha = look.alpha * fadeAlpha(door.id, now);

      if (look.filled) {
        paint.circle(x, y, MARK_RADIUS).fill({ color: look.color, alpha });
      } else {
        paint
          .circle(x, y, MARK_RADIUS)
          .stroke({ color: look.color, width: MARK_RADIUS * 0.34, alpha });
      }

      // The badge is drawn in the mark's counter-colour so it reads on either fill. Only the
      // DM ever has one to draw (`doorLook`): a player's canvas carries no state colour at
      // all, and locked lives in the door panel and the bump toast instead.
      if (look.badge === 'secret') {
        drawSecretBadge(paint, x, y, look.filled ? 0x141414 : look.color, alpha);
      }

      if (door.id === selectedId) {
        paint
          .circle(x, y, MARK_RADIUS * 1.7)
          .stroke({ color: 0xffffff, width: MARK_RADIUS * 0.16, alpha: 0.85 * alpha });
      }
    }
  };

  // Per frame: mirror the camera, because the layer lives in screen space now, and advance
  // any fade.
  //
  // ponytail: the whole overlay is repainted per frame while a door is fading, rather than
  // giving each fading mark its own Graphics. A scene has tens of doors and a fade lasts
  // 300ms; split them out if a map ever makes this show up in a frame budget.
  const world = sceneGraph.worldContainer;
  const tick = () => {
    layer.position.copyFrom(world.position);
    layer.scale.copyFrom(world.scale);
    if (fading.size > 0) draw();
  };

  // Canvas capture, like token input — and registered after it, because TokenPanel mounts
  // first (a lower panel order). A token standing in a doorway therefore wins the click,
  // which is the right way round: tokens are dragged, doors are only tapped.
  const canvas = engine.canvas();
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 || isToolActive()) return;
    const point = worldPointOf(engine, e);
    if (!point) return;
    const hit = doorAt(doors, point.x, point.y);
    if (!hit) return;
    e.stopPropagation();
    e.preventDefault();
    useDoorSelection.getState().select(hit.door.id);
    send('toggle', { id: hit.door.id });
  };

  canvas.addEventListener('pointerdown', onDown, true);
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
    canvas.removeEventListener('pointerdown', onDown, true);
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
