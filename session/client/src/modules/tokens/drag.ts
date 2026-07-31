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
import { isToolActive } from '../../session/tools';

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
 * is not this module's business. The doors lane matches on typed prefixes (`DOOR_LOCKED`);
 * tokens have none, so this matches the sentence `canOccupy` refuses with.
 *
 * ponytail: a string copied from `mechanics/tokens/module.ts`, so a reworded refusal there
 * goes quiet here rather than wrong. The upgrade is an exported constant beside the
 * message, the day a second token refusal needs telling apart from this one.
 */
export function tokenRefusal(message: string): string | null {
  return message.includes('cannot be occupied') ? "You can't move there." : null;
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
    if (!canDrag(token, you?.role, you?.identityId)) return;
    drag = { id: token.id, size: token.size, dx: x - token.x, dy: y - token.y, x: token.x, y: token.y, moved: false };
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
    drag = null;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };

  canvas.addEventListener('pointerdown', onDown, true);
  canvas.addEventListener('pointermove', onMove, true);
  canvas.addEventListener('pointerup', onUp, true);
  canvas.addEventListener('pointercancel', onUp, true);
  return () => {
    canvas.removeEventListener('pointerdown', onDown, true);
    canvas.removeEventListener('pointermove', onMove, true);
    canvas.removeEventListener('pointerup', onUp, true);
    canvas.removeEventListener('pointercancel', onUp, true);
  };
}
