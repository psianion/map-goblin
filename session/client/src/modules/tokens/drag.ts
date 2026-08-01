// §2.4.6 / D9 — pointer handling for the token overlay, plus the interaction state the
// React panels share with it.
//
// Input is wired with plain DOM listeners on the pixi canvas in the *capture* phase
// rather than pixi's event system: GameRenderer pans the camera from a bubble-phase
// listener on the canvas's parent, so `stopPropagation()` here is what tells "I grabbed a
// token" apart from "I grabbed the map". One event path, no eventMode plumbing.
//
// This file stays pixi-free on purpose — the renderer hands it a `TokenLayer` — so the
// arithmetic below is unit-testable without a GPU.

import { create } from 'zustand';
import { SIZE_CELLS, snap, type Token, type TokenSize } from '@dnd/mechanics/tokens';
import type { Role } from '@dnd/core/src/shared/protocol';
import type { RenderEngine } from '@dnd/core/src/engine/RenderEngine';
import { useSessionStore } from '../../session/store';
import { showToast, useToasts } from '../../session/toasts';
import { isToolActive } from '../../session/tools';
import { doorRefusal, type LiveDoor } from '../doors/doors';

/** What the renderer exposes to the input layer. */
export interface TokenLayer {
  /** Tokens of the active scene, as last synced. */
  tokens(): readonly Token[];
  /** Optimistic, un-tweened move of one sprite (dragging). */
  placeAt(id: string, x: number, y: number): void;
  /**
   * While `true` the renderer ignores inbound positions for this token (§4). On
   * `false` it starts waiting for the authoritative echo and rubber-bands if none comes.
   */
  setDragging(id: string, dragging: boolean): void;
  /**
   * Put a token back at a position the caller is asserting, dropping the optimistic state
   * of the gesture that led there. The sprite eases rather than cuts, so a refusal reads as
   * the token being pushed back and not as a teleport.
   */
  settleAt(id: string, x: number, y: number): void;
}

interface TokenInteraction {
  /** Token the local player has selected; drives the outline and the panel. */
  selectedId: string | null;
  /** Library def armed for click-to-place, or null. */
  placingDefId: string | null;
  select: (id: string | null) => void;
  setPlacing: (defId: string | null) => void;
}

// ponytail: a 4-field zustand store instead of React context — the Pixi layer is outside
// React and needs the same two values, and zustand is already a dependency.
export const useTokenInteraction = create<TokenInteraction>()((set) => ({
  selectedId: null,
  placingDefId: null,
  select: (selectedId) => set({ selectedId }),
  setPlacing: (placingDefId) => set({ placingDefId }),
}));

/** D9: ~10 Hz while the pointer is down. */
export const MOVE_INTERVAL_MS = 100;

/** How long a dropped token waits for the server to agree before rubber-banding (D9). */
export const SETTLE_MS = 600;

/** Leading-edge throttle. `run` fires immediately or drops; nothing is queued. */
export function createThrottle(intervalMs: number, now: () => number = Date.now) {
  let last = -Infinity;
  return {
    run(fn: () => void): boolean {
      const t = now();
      if (t - last < intervalMs) return false;
      last = t;
      fn();
      return true;
    },
    reset(): void {
      last = -Infinity;
    },
  };
}

/**
 * Exponential approach — ~95% of the distance in `ms`, which is the D9 rubber-band
 * (150ms) and doubles as smoothing for everyone else's moves. Frame-rate independent.
 */
export function approach(from: number, to: number, dtMs: number, ms = 150): number {
  if (Math.abs(to - from) < 1e-3) return to;
  return from + (to - from) * (1 - Math.exp((-3 * dtMs) / ms));
}

/**
 * The refusal a move hands back, in words a player can act on — or null for anything that
 * is not this module's business.
 *
 * One vocabulary for both lanes: a refusal says why when the server named a why, and falls
 * back to the bare fact when it did not. The doors lane stamps typed prefixes on its own
 * refusals (`DOOR_LOCKED`), and a move blocked *by a door* is the same fact arriving through
 * another command, so it gets the same sentence rather than a vaguer one of its own.
 *
 * `doors` is what lets it say *which* door — the caller passes the doors this seat holds and
 * `doorRefusal` resolves the id the server named. Omit them and the sentence is still
 * correct, just nameless, which is all a caller using this as a yes/no gate needs.
 *
 * ponytail: the sentence is copied from `mechanics/tokens/module.ts`, so a reword there goes
 * quiet here rather than wrong. The upgrade is an exported constant beside the message.
 */
export function tokenRefusal(message: string, doors: readonly LiveDoor[] = []): string | null {
  if (!message.includes('cannot be occupied')) return null;
  return doorRefusal(message, doors) ?? "You can't move there.";
}

/**
 * Why the pointer cannot move this token — the answer the gate below owes a player.
 *
 * A drag the client refuses never reaches the server, so nothing refuses it back and the
 * refusal-toast path (`useTokenFeedback`, which reads `lastError`) is never on. The gesture
 * was answered by a 600ms rubber-band and nothing else, which reads as a dropped frame.
 * These words point at the affordance the panel is already offering beside the token.
 */
export function dragRefusal(token: Token): string {
  return token.ownerId === null
    ? 'Claim this token to move it.'
    : 'Another player is holding that token.';
}

/** D10 client-side gate. The server enforces this too — this only saves a round trip. */
export function canDrag(token: Token, role: Role | undefined, identityId: string | undefined): boolean {
  if (role === 'dm') return true;
  return role === 'player' && !!identityId && token.ownerId === identityId;
}

const cellsOf = (size: TokenSize): number => SIZE_CELLS[size] ?? 1;

/** Draw order: z first, elevation breaks ties. Shared by the hit test and the renderer. */
export const drawOrder = (t: Token): number => (t.z || 0) * 1e6 + (t.elevation || 0);

/** Topmost token whose box contains the world point, or undefined. */
export function hitTest(tokens: readonly Token[], x: number, y: number): Token | undefined {
  let best: Token | undefined;
  for (const token of tokens) {
    const r = cellsOf(token.size) / 2;
    if (Math.abs(token.x - x) > r || Math.abs(token.y - y) > r) continue;
    if (!best || drawOrder(token) >= drawOrder(best)) best = token;
  }
  return best;
}

const send = (action: string, payload: unknown): void =>
  useSessionStore.getState().sendCommand('tokens', action, payload);

/** Wires select / click-to-place / drag onto the canvas. Returns the detach function. */
export function attachTokenInput(engine: RenderEngine, layer: TokenLayer): () => void {
  const canvas = engine.canvas();
  const throttle = createThrottle(MOVE_INTERVAL_MS);
  let drag: { id: string; size: TokenSize; dx: number; dy: number; x: number; y: number; moved: boolean } | null =
    null;

  /**
   * The whole gesture, kept until the server has answered the drop.
   *
   * A drag streams moves at ~10 Hz (D9) and the server judges each one on its own, so a
   * gesture that ends on a cell it refuses has usually had its earlier, legal hops committed
   * already. Rubber-banding to "the last position we were told about" therefore lands on the
   * furthest legal hop rather than on the cell the token was picked up from, and the token
   * keeps that ground — about a cell per refused drag, which is the creep the gate measured.
   * The gesture is one move as far as a player is concerned, so a refusal undoes all of it.
   */
  let gesture:
    | { id: string; from: { x: number; y: number }; to: { x: number; y: number }; endedAt: number }
    | null = null;

  /** Put the token back where the pointer picked it up, on this side and on the server's. */
  const revert = (): void => {
    if (!gesture) return;
    const { id, from } = gesture;
    gesture = null;
    layer.settleAt(id, from.x, from.y);
    // The sprite answers immediately; the server has to be *told*, because the hops it
    // accepted on the way are real state over there and only a move undoes them. Deferred
    // one microtask because this runs from a store subscription, and `sendCommand` drops
    // anything sent while a server message is still being folded in (`applyingRemote`).
    queueMicrotask(() => send('move', { id, x: from.x, y: from.y }));
  };

  /**
   * A refusal is this gesture's verdict only if it could still be about the drop, and only
   * if the drop did not land after all — an intermediate hop can be refused on the way to a
   * cell the server is perfectly happy with, and that move must stand.
   */
  let seenError = useSessionStore.getState().lastError;
  const onStoreChange = (): void => {
    const { lastError } = useSessionStore.getState();
    if (lastError === seenError) return;
    seenError = lastError;
    // Still steering: the pointer is the authority until it lifts, and yanking the sprite
    // out from under a live drag would read as a stutter rather than as an answer.
    const g = gesture;
    if (!lastError || !g || drag || !tokenRefusal(lastError.message)) return;
    if (lastError.at > g.endedAt + SETTLE_MS) return;
    const landed = layer.tokens().find((t) => t.id === g.id);
    if (landed && landed.x === g.to.x && landed.y === g.to.y) {
      gesture = null; // the drop stands; this refusal was an earlier hop's
      return;
    }
    revert();
  };
  const unsubscribe = useSessionStore.subscribe(onStoreChange);

  const worldOf = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return engine.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
  };
  // Claiming the gesture: the camera pan listener sits on the canvas's parent.
  const claim = (e: PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };

  const onDown = (e: PointerEvent) => {
    // A tool mode owns the canvas (D11): while the fog tool is armed a click is a fog
    // click, and token input stands down rather than racing it.
    if (e.button !== 0 || isToolActive()) return;
    const { x, y } = worldOf(e);
    const { placingDefId, setPlacing, select } = useTokenInteraction.getState();

    if (placingDefId) {
      send('place', { defId: placingDefId, x, y }); // the server snaps and mints the id
      setPlacing(null);
      claim(e);
      return;
    }

    const token = hitTest(layer.tokens(), x, y);
    if (!token) {
      select(null);
      return; // empty map: let the pan handler have the gesture
    }
    select(token.id);
    claim(e);

    const you = useSessionStore.getState().you;
    if (!canDrag(token, you?.role, you?.identityId)) {
      // Deduped the way `useTokenFeedback` dedupes a refusal: while the same words are
      // still on screen, grabbing the token again has nothing to add.
      const message = dragRefusal(token);
      if (useToasts.getState().toast?.message !== message) showToast({ message });
      return;
    }
    drag = { id: token.id, size: token.size, dx: x - token.x, dy: y - token.y, x: token.x, y: token.y, moved: false };
    // `endedAt: 0` is "the pointer is still down" — nothing can be this gesture's verdict yet.
    gesture = { id: token.id, from: { x: token.x, y: token.y }, to: { x: token.x, y: token.y }, endedAt: 0 };
    layer.setDragging(token.id, true);
    canvas.setPointerCapture(e.pointerId);
    throttle.reset();
  };

  const onMove = (e: PointerEvent) => {
    if (!drag) return;
    claim(e);
    const world = worldOf(e);
    // Snapped with the server's own function, so the optimistic sprite lands exactly
    // where the authoritative echo will put it.
    const x = snap(world.x - drag.dx, drag.size);
    const y = snap(world.y - drag.dy, drag.size);
    if (x === drag.x && y === drag.y) return;
    const id = drag.id;
    drag.x = x;
    drag.y = y;
    drag.moved = true;
    layer.placeAt(id, x, y);
    throttle.run(() => send('move', { id, x, y }));
  };

  const onUp = (e: PointerEvent) => {
    if (!drag) return;
    claim(e);
    // The throttle may have dropped the last move — the drop is always sent.
    if (drag.moved) send('move', { id: drag.id, x: drag.x, y: drag.y });
    layer.setDragging(drag.id, false);
    // A gesture that never moved sent nothing, so there is nothing a refusal could undo.
    if (gesture && drag.moved) {
      gesture.to = { x: drag.x, y: drag.y };
      gesture.endedAt = Date.now();
    } else {
      gesture = null;
    }
    drag = null;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };

  canvas.addEventListener('pointerdown', onDown, true);
  canvas.addEventListener('pointermove', onMove, true);
  canvas.addEventListener('pointerup', onUp, true);
  canvas.addEventListener('pointercancel', onUp, true);
  return () => {
    unsubscribe();
    canvas.removeEventListener('pointerdown', onDown, true);
    canvas.removeEventListener('pointermove', onMove, true);
    canvas.removeEventListener('pointerup', onUp, true);
    canvas.removeEventListener('pointercancel', onUp, true);
  };
}
