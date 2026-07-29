// §2.4.3 — the door overlay: one mark per door showing the state the *table* is playing it
// at, and the click that changes it.
//
// The map's own door art (core's `doorRenderer`) draws the authored state and knows nothing
// about the session, so this sits above it: a small mark that says open / shut / locked /
// secret right now. Anyone may click one (D2); the DM's lock and reveal-secret affordances
// live inline in the panel, never behind a modal.

import { Container, Graphics } from 'pixi.js';
import type { RenderEngine } from '@dnd/core/src/engine/RenderEngine';
import type { SceneGraph } from '@dnd/core/src/engine/sceneGraph';
import { useStore } from '@dnd/core/src/store/store';
import type { DoorsState } from '@dnd/mechanics/doors';
import { addWorldOverlay, mountWhenEngineReady, worldPointOf } from '../../renderer/overlayLayer';
import { useSessionStore } from '../../session/store';
import { isToolActive } from '../../session/tools';
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

/** A padlock: a bar with a shackle over it, small enough to sit on the mark. */
function drawLockBadge(g: Graphics, x: number, y: number, color: number): void {
  const s = MARK_RADIUS * 0.62;
  g.rect(x - s * 0.6, y - s * 0.1, s * 1.2, s * 0.9).fill({ color, alpha: 1 });
  g.moveTo(x - s * 0.32, y - s * 0.1);
  g.arc(x, y - s * 0.1, s * 0.32, Math.PI, 0);
  g.stroke({ color, width: s * 0.24, alpha: 1 });
}

/** A four-point star — "there is more here than the map says". */
function drawSecretBadge(g: Graphics, x: number, y: number, color: number): void {
  const s = MARK_RADIUS * 0.85;
  for (const [dx, dy] of [
    [1, 0],
    [0, 1],
  ]) {
    g.moveTo(x - dx * s, y - dy * s);
    g.lineTo(x + dx * s, y + dy * s);
  }
  g.stroke({ color, width: MARK_RADIUS * 0.22, alpha: 1, cap: 'round' });
}

function mountDoorLayer(engine: RenderEngine, sceneGraph: SceneGraph): () => void {
  const layer = new Container();
  const paint = new Graphics();
  layer.addChild(paint);
  addWorldOverlay(sceneGraph, layer, 'doorOverlay');

  let doors: LiveDoor[] = [];

  const draw = () => {
    doors = liveSceneDoors();
    const selectedId = useDoorSelection.getState().selectedId;
    paint.clear();

    for (const { door, live } of doors) {
      const look = doorLook(door, live);
      const [x, y] = door.position;

      // Full opacity, always. A secret door on the DM's map is not a hint, it is a door.
      if (look.filled) {
        paint.circle(x, y, MARK_RADIUS).fill({ color: look.color, alpha: look.alpha });
      } else {
        paint
          .circle(x, y, MARK_RADIUS)
          .stroke({ color: look.color, width: MARK_RADIUS * 0.34, alpha: look.alpha });
      }

      // Badges are drawn in the mark's counter-colour so they read on either fill.
      const badgeColor = look.filled ? 0x141414 : look.color;
      if (look.badge === 'locked') drawLockBadge(paint, x, y, badgeColor);
      if (look.badge === 'secret') drawSecretBadge(paint, x, y, badgeColor);

      if (door.id === selectedId) {
        paint
          .circle(x, y, MARK_RADIUS * 1.7)
          .stroke({ color: 0xffffff, width: MARK_RADIUS * 0.16, alpha: 0.85 });
      }
    }
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
  // Same feed the lighting lane will read, so there is one answer to "what are the doors
  // doing" and the overlay cannot drift from the walls. It draws once on subscribe.
  const unsubDoors = subscribeLiveDoors(draw);
  let lastSelected = useDoorSelection.getState().selectedId;
  const unsubSelection = useDoorSelection.subscribe(() => {
    const selected = useDoorSelection.getState().selectedId;
    if (selected === lastSelected) return;
    lastSelected = selected;
    draw();
  });

  return () => {
    canvas.removeEventListener('pointerdown', onDown, true);
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
