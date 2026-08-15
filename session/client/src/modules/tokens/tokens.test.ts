import { PROTOCOL_VERSION } from '@dnd/core/src/shared/protocol';
import { createElement } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DOOR_CLOSED, DOOR_LOCKED } from '@dnd/mechanics/doors';
import type { Token } from '@dnd/mechanics/tokens';
import type { PlayerInfo, SessionState } from '@dnd/core/src/shared/protocol';
import type { Layer } from '@dnd/core/src/store/types';
import { liveDoors } from '../doors/doors';
import { useSessionStore } from '../../session/store';
import { useToasts, type Toast } from '../../session/toasts';
import { tokenLabelText } from './TokenRenderer';
import type { RenderEngine } from '@dnd/core/src/engine/RenderEngine';
import type { WebSocketClient } from '../../session/WebSocketClient';
import {
  SETTLE_MS,
  approach,
  attachTokenInput,
  canDrag,
  createThrottle,
  drawOrder,
  hitTest,
  tokenRefusal,
  useTokenInteraction,
  type TokenLayer,
} from './drag';
import { mapScale, toCells, toUnits } from './sight';
import { TokenPanel } from './TokenPanel';
import { DISPOSITION_COLOR, initials, tokenAppearance, tokensOf } from './TokenRenderer';

const token = (over: Partial<Token> = {}): Token => ({
  id: 't1',
  name: 'Goblin Boss',
  imageAssetId: null,
  size: 'medium',
  disposition: 'hostile',
  sight: null,
  light: null,
  defId: null,
  x: 0.5,
  y: 0.5,
  elevation: 0,
  z: 0,
  hidden: false,
  ownerId: null,
  ...over,
});

describe('move throttle (D9 — ~10 Hz + a final on drop)', () => {
  it('fires the leading call and drops the rest of the window', () => {
    let now = 1000;
    const throttle = createThrottle(100, () => now);
    const sent: number[] = [];
    const send = () => sent.push(now);

    throttle.run(send); // leading edge
    now += 40;
    throttle.run(send); // inside the window — dropped
    now += 40;
    throttle.run(send); // still inside — dropped
    now += 40;
    throttle.run(send); // 120ms after the first
    expect(sent).toEqual([1000, 1120]);
  });

  it('reset re-arms it, so a new drag always sends its first position', () => {
    const now = 0;
    const throttle = createThrottle(100, () => now);
    expect(throttle.run(() => {})).toBe(true);
    expect(throttle.run(() => {})).toBe(false);
    throttle.reset();
    expect(throttle.run(() => {})).toBe(true);
  });
});

describe('approach (rubber-band tween)', () => {
  it('covers ~95% of the distance in the 150ms budget', () => {
    expect(approach(0, 10, 150)).toBeCloseTo(9.5, 1);
  });

  it('is frame-rate independent — two half steps land where one full step does', () => {
    const half = approach(0, 10, 75);
    expect(approach(half, 10, 75)).toBeCloseTo(approach(0, 10, 150), 6);
  });

  it('lands exactly on the target instead of easing forever', () => {
    expect(approach(9.9999, 10, 16)).toBe(10);
  });
});

describe('canDrag (D10, client-side gate)', () => {
  it('lets the DM drag anything', () => {
    expect(canDrag(token({ ownerId: 'p1' }), 'dm', 'dm1')).toBe(true);
  });

  it('lets a player drag only their own token', () => {
    expect(canDrag(token({ ownerId: 'p1' }), 'player', 'p1')).toBe(true);
    expect(canDrag(token({ ownerId: 'p2' }), 'player', 'p1')).toBe(false);
    expect(canDrag(token({ ownerId: null }), 'player', 'p1')).toBe(false);
  });

  it('refuses before the join snapshot lands', () => {
    expect(canDrag(token({ ownerId: 'p1' }), undefined, undefined)).toBe(false);
  });
});

describe('hitTest', () => {
  it('picks a token whose box covers the point, and nothing outside it', () => {
    const t = token({ x: 2.5, y: 2.5 });
    expect(hitTest([t], 2.9, 2.2)?.id).toBe('t1');
    expect(hitTest([t], 3.2, 2.5)).toBeUndefined();
  });

  it('scales the box with the token size', () => {
    const huge = token({ id: 'h', size: 'huge', x: 0, y: 0 }); // 3 cells wide
    expect(hitTest([huge], 1.4, -1.4)?.id).toBe('h');
    expect(hitTest([token({ size: 'tiny', x: 0, y: 0 })], 0.4, 0)).toBeUndefined();
  });

  it('returns the topmost of overlapping tokens (z, then elevation)', () => {
    const low = token({ id: 'low', z: 0, elevation: 0 });
    const high = token({ id: 'high', z: 1 });
    const flying = token({ id: 'flying', z: 0, elevation: 30 });
    expect(hitTest([low, high, flying], 0.5, 0.5)?.id).toBe('high');
    expect(hitTest([low, flying], 0.5, 0.5)?.id).toBe('flying');
    expect(drawOrder(high)).toBeGreaterThan(drawOrder(flying));
  });
});

describe('initials + disposition colours (portrait-less fallback, D11)', () => {
  it('takes one letter from each of the first two words', () => {
    expect(initials('Goblin Boss')).toBe('GB');
    expect(initials('  ancient red dragon ')).toBe('AR');
  });

  it('takes two letters from a single word, and never renders empty', () => {
    expect(initials('Aragorn')).toBe('AR');
    expect(initials('X')).toBe('X');
    expect(initials('   ')).toBe('?');
    expect(initials(undefined as unknown as string)).toBe('?');
  });

  it('maps every disposition to its own colour', () => {
    const colors = Object.values(DISPOSITION_COLOR);
    expect(new Set(colors).size).toBe(colors.length);
    expect(DISPOSITION_COLOR.friendly).not.toBe(DISPOSITION_COLOR.hostile);
  });
});

describe('tokenAppearance (D11 — the DM never loses visibility)', () => {
  it('draws a hidden token at full opacity with a badge, never ghosted', () => {
    expect(tokenAppearance(token({ hidden: true }), true)).toEqual({ alpha: 1, badge: 'hidden' });
  });

  it('never dims a token, hidden or not, for either seat', () => {
    for (const hidden of [true, false]) {
      for (const isDm of [true, false]) {
        expect(tokenAppearance(token({ hidden }), isDm).alpha).toBe(1);
      }
    }
  });

  it('badges nothing a player can see — they never receive a hidden token anyway (D4)', () => {
    expect(tokenAppearance(token({ hidden: true }), false).badge).toBeNull();
    expect(tokenAppearance(token({ hidden: false }), true).badge).toBeNull();
  });
});

describe('a refused move (the rubber-band on its own says nothing)', () => {
  const player: PlayerInfo = { identityId: 'p-2', name: 'Borin', role: 'player', connected: true };

  const session = (tokens: Token[]): SessionState => ({
    protocolVersion: PROTOCOL_VERSION,
    sessionId: 's1',
    campaignId: 'c1',
    activeSceneId: 'scene-1',
    scenes: [{ id: 'scene-1', name: 'Crypt', mapId: 'scene-1' }],
    players: [player],
    modules: {
      tokens: { library: {}, byScene: { 'scene-1': Object.fromEntries(tokens.map((t) => [t.id, t])) } },
    },
  });

  /** What the server hands back for `tokens.move` into a room a player may not stand in. */
  const refused = (at: number) => ({
    code: 'invalid-command' as const,
    message: 'that space cannot be occupied',
    at,
  });

  beforeEach(() => {
    cleanup();
    useSessionStore.setState({ session: session([token()]), you: player, client: null, lastError: null });
    useToasts.setState({ toast: null });
  });

  it('reads the sentence a move is refused with, and nobody else’s refusal', () => {
    expect(tokenRefusal('that space cannot be occupied')).toBe("You can't move there.");
    expect(tokenRefusal('you may only move a token you own')).toBeNull();
    expect(tokenRefusal(`${DOOR_LOCKED}: that door is locked`)).toBeNull();
  });

  it('toasts the player who dropped a token where it may not stand, once per drop', () => {
    render(createElement(TokenPanel));

    const shown: Toast[] = [];
    const unsubscribe = useToasts.subscribe((s) => {
      if (s.toast) shown.push(s.toast);
    });
    // A drag across a wall is refused on the way at ~10 Hz and again on the drop; the
    // player is owed one answer, not one per message.
    act(() => useSessionStore.setState({ lastError: refused(1) }));
    act(() => useSessionStore.setState({ lastError: refused(2) }));
    unsubscribe();

    // One toast — the same id throughout, never a second one stacked behind it.
    expect(new Set(shown.map((t) => t.id)).size).toBe(1);
    expect(shown.map((t) => t.message)).toEqual([
      "You can't move there.",
      "You can't move there.",
    ]);
    // …but re-set on the later refusal, which is what restarts its dismissal window. The
    // drop is what the player actually looks up from; a clock started by the first refusal
    // mid-drag had all but run out by then.
    expect(shown[1]).not.toBe(shown[0]);
  });

  it('says nothing when the move was taken — a slow echo is not a refusal', () => {
    render(createElement(TokenPanel));
    act(() => useSessionStore.setState({ session: session([token({ x: 4.5, y: 6.5 })]) }));
    expect(useToasts.getState().toast).toBeNull();
  });
});

describe('a refused drag rubber-bands to where the pointer picked the token up', () => {
  const player: PlayerInfo = { identityId: 'p-2', name: 'Borin', role: 'player', connected: true };
  const mine = (over: Partial<Token> = {}) => token({ ownerId: 'p-2', ...over });

  const session = (tokens: Token[]): SessionState => ({
    protocolVersion: PROTOCOL_VERSION,
    sessionId: 's1',
    campaignId: 'c1',
    activeSceneId: 'scene-1',
    scenes: [{ id: 'scene-1', name: 'Crypt', mapId: 'scene-1' }],
    players: [player],
    modules: {
      tokens: { library: {}, byScene: { 'scene-1': Object.fromEntries(tokens.map((t) => [t.id, t])) } },
    },
  });

  /**
   * A canvas that hands its listeners back. `drag.ts` wires capture-phase DOM listeners and
   * reads only button/clientX/clientY/pointerId off an event, so driving them directly is
   * the whole gesture without jsdom's PointerEvent — which is the GPU-free seam the file
   * was split for.
   */
  function fakeCanvas() {
    const listeners: Record<string, ((e: unknown) => void)[]> = {};
    return {
      el: {
        addEventListener: (t: string, fn: unknown) => void (listeners[t] ??= []).push(fn as never),
        removeEventListener: () => {},
        getBoundingClientRect: () => ({ left: 0, top: 0 }),
        setPointerCapture: () => {},
        hasPointerCapture: () => false,
        releasePointerCapture: () => {},
      },
      /**
       * Dispatch, with `stopImmediatePropagation` meaning what the DOM means by it: the
       * listeners registered after the one that called it never run. That is the whole of
       * how a grabbed token keeps the door overlay — which listens on this very element —
       * out of the same press, so the fake has to model it rather than no-op it.
       */
      fire(type: string, clientX: number, clientY: number) {
        let stopped = false;
        for (const fn of listeners[type] ?? []) {
          if (stopped) return;
          fn({
            button: 0,
            clientX,
            clientY,
            pointerId: 1,
            stopPropagation() {},
            stopImmediatePropagation() {
              stopped = true;
            },
            preventDefault() {},
          });
        }
      },
    };
  }

  /** Every `tokens` command the tab put on the wire, in order. */
  function harness(held: Token[]) {
    const canvas = fakeCanvas();
    const sent: { action: string; payload: { id: string; x: number; y: number } }[] = [];
    let tokens = held;
    let settled: { x: number; y: number } | null = null;

    useSessionStore.setState({
      session: session(tokens),
      you: player,
      lastError: null,
      client: {
        send: (m: unknown) => {
          const msg = m as { module: string; action: string; payload: typeof sent[number]['payload'] };
          if (msg.module === 'tokens') sent.push({ action: msg.action, payload: msg.payload });
        },
      } as never,
    });

    const engine = {
      canvas: () => canvas.el,
      // One screen unit is one world unit, so a client point is already a world point.
      screenToWorld: (x: number, y: number) => ({ x, y }),
    } as unknown as RenderEngine;

    const layer: TokenLayer = {
      tokens: () => tokens,
      placeAt: () => {},
      setDragging: () => {},
      settleAt: (_id, x, y) => void (settled = { x, y }),
    };

    return {
      canvas,
      sent,
      detach: attachTokenInput(engine, layer),
      settled: () => settled,
      /** The server took a hop: the authoritative slice now says the token moved. */
      accept: (x: number, y: number) => {
        tokens = [mine({ x, y })];
        act(() => useSessionStore.setState({ session: session(tokens) }));
      },
      refuse: () =>
        act(() =>
          useSessionStore.setState({
            lastError: { code: 'invalid-command', message: 'that space cannot be occupied', at: Date.now() },
          }),
        ),
    };
  }

  beforeEach(() => {
    cleanup();
    useToasts.setState({ toast: null });
  });

  it('undoes the hops the drag already got past the server, not just the last one', async () => {
    const h = harness([mine({ x: 0.5, y: 0.5 })]);

    // The gesture: down on the token, across, up. The throttle's leading edge puts the
    // first hop on the wire mid-drag, which is the one the server takes.
    h.canvas.fire('pointerdown', 0.5, 0.5);
    h.canvas.fire('pointermove', 2.5, 0.5);
    h.canvas.fire('pointermove', 6.5, 0.5);
    h.canvas.fire('pointerup', 6.5, 0.5);

    // That legal hop is committed over there — this is the ground a refused drag used to
    // keep, one cell at a time.
    h.accept(2.5, 0.5);
    h.refuse();
    await Promise.resolve();

    expect(h.settled(), 'the sprite goes back to the cell it was picked up from').toEqual({
      x: 0.5,
      y: 0.5,
    });
    expect(h.sent.at(-1), 'and the server is told to give the ground back').toEqual({
      action: 'move',
      payload: { id: 't1', x: 0.5, y: 0.5 },
    });
    h.detach();
  });

  it('leaves an accepted drop alone, even when a hop on the way was refused', async () => {
    const h = harness([mine({ x: 0.5, y: 0.5 })]);

    h.canvas.fire('pointerdown', 0.5, 0.5);
    h.canvas.fire('pointermove', 2.5, 0.5);
    h.canvas.fire('pointerup', 6.5, 0.5);
    const drop = h.sent.at(-1)!.payload;

    // The server refused a cell on the way but took the drop; a move that landed must not
    // be undone by the answer to one that did not.
    h.accept(drop.x, drop.y);
    h.refuse();
    await Promise.resolve();

    expect(h.settled()).toBeNull();
    expect(h.sent.at(-1)!.payload).toEqual(drop);
    h.detach();
  });

  it('ignores a refusal that arrives long after the gesture settled', async () => {
    const h = harness([mine({ x: 0.5, y: 0.5 })]);

    h.canvas.fire('pointerdown', 0.5, 0.5);
    h.canvas.fire('pointermove', 2.5, 0.5);
    h.canvas.fire('pointerup', 2.5, 0.5);
    h.accept(2.5, 0.5);

    act(() =>
      useSessionStore.setState({
        lastError: {
          code: 'invalid-command',
          message: 'that space cannot be occupied',
          at: Date.now() + SETTLE_MS + 1,
        },
      }),
    );
    await Promise.resolve();

    expect(h.settled(), 'somebody else’s refusal never moves this token').toBeNull();
    h.detach();
  });

  // The gate refuses this drag before a single move leaves the tab, so the server never
  // answers and the refusal toast never fires. Silence is what the browser gate found.
  it('answers a grab at a token this seat may not move', () => {
    const h = harness([token({ id: 't1', ownerId: null })]);

    h.canvas.fire('pointerdown', 0.5, 0.5);
    expect(useToasts.getState().toast?.message).toBe('Claim this token to move it.');
    // Refused before the wire, not on it: nothing was sent and nothing moved.
    expect(h.sent).toEqual([]);
    expect(h.settled()).toBeNull();

    // One toast per refusal, not one per grab.
    const id = useToasts.getState().toast!.id;
    h.canvas.fire('pointerup', 0.5, 0.5);
    h.canvas.fire('pointerdown', 0.5, 0.5);
    expect(useToasts.getState().toast!.id).toBe(id);
    h.detach();
  });

  /**
   * The door overlay listens on this same canvas, and it registers after token input on
   * purpose — tokens are dragged, doors are only tapped. `stopPropagation` never enforced
   * that: propagation is between nodes, so a listener on the same element ran anyway, and
   * pressing down on a token standing in a doorway both grabbed the token and swung the
   * door open under it. A door opens because somebody chose to open it.
   */
  it('keeps the press that grabs a token away from the door overlay behind it', () => {
    const h = harness([mine({ x: 0.5, y: 0.5 })]);
    const overlay: number[] = [];
    h.canvas.el.addEventListener('pointerdown', () => void overlay.push(1));

    h.canvas.fire('pointerdown', 0.5, 0.5);
    expect(overlay, 'the token won the press; the door under it stays shut').toEqual([]);

    // A press that grabs nothing is still the door's to answer.
    h.canvas.fire('pointerup', 0.5, 0.5);
    h.canvas.fire('pointerdown', 40.5, 40.5);
    expect(overlay).toEqual([1]);
    h.detach();
  });

  it('names the holder when the token is somebody else’s', () => {
    const h = harness([token({ id: 't1', ownerId: 'p-9' })]);

    h.canvas.fire('pointerdown', 0.5, 0.5);
    expect(useToasts.getState().toast?.message).toBe('Another player is holding that token.');
    h.detach();
  });
});

describe('tokensOf', () => {
  const state = { library: {}, byScene: { a: { t1: token(), junk: null as unknown as Token }, b: {} } };

  it('reads the active scene and drops wire junk', () => {
    expect(tokensOf(state, 'a').map((t) => t.id)).toEqual(['t1']);
  });

  it('is empty for a scene with no tokens, an unknown scene, or no scene at all', () => {
    expect(tokensOf(state, 'b')).toEqual([]);
    expect(tokensOf(state, 'nope')).toEqual([]);
    expect(tokensOf(state, null)).toEqual([]);
    expect(tokensOf(undefined, 'a')).toEqual([]);
  });
});

describe('tokenLabelText', () => {
  it('names the player alongside the token when that says something new', () => {
    expect(tokenLabelText('Goblin Archer', 'Borin')).toBe('Goblin Archer · Borin');
  });

  /** The gate walk's "Borin · Borin": the token and its claimant are the same word. */
  it('says the name once when the token is already called that', () => {
    expect(tokenLabelText('Borin', 'Borin')).toBe('Borin');
  });

  it('is just the token name while nobody has claimed it', () => {
    expect(tokenLabelText('Borin', null)).toBe('Borin');
  });
});

describe('tokenRefusal carries the cause the server named', () => {
  it('says the bare fact when the refusal names no cause', () => {
    expect(tokenRefusal('that space cannot be occupied')).toBe("You can't move there.");
  });

  /**
   * The unification: a move blocked by a door is the same fact the doors lane already has
   * words for, so it gets those words rather than a vaguer sentence of its own.
   */
  it('says which door, once a refusal carries the door lane’s prefix', () => {
    expect(tokenRefusal(`${DOOR_LOCKED}: that space cannot be occupied`)).toBe(
      'The door is locked.',
    );
    expect(tokenRefusal(`${DOOR_CLOSED}: that space cannot be occupied`)).toBe(
      'The door is closed.',
    );
  });

  /** …and by name, when this seat holds the door the server named. */
  it('names the door out of the ones this seat holds', () => {
    const doors = liveDoors(
      [
        {
          id: 'l1',
          type: 'dungeon',
          rooms: [],
          standaloneWalls: [],
          children: [
            {
              id: 'door-sump',
              name: 'Sump Portcullis',
              childType: 'door',
              visible: true,
              wallId: 'w1',
              position: [4, 4],
              angle: 0,
              width: 1.6,
              style: 'portcullis',
              state: 'closed',
              isSecret: false,
            },
          ],
        } as unknown as Layer,
      ],
      undefined,
      'scene-1',
    );
    expect(tokenRefusal(`${DOOR_CLOSED} door-sump: that space cannot be occupied`, doors)).toBe(
      'Sump Portcullis is closed.',
    );
    // A door this seat was not handed keeps the nameless sentence — never "Door 1".
    expect(tokenRefusal(`${DOOR_CLOSED} door-elsewhere: that space cannot be occupied`, doors)).toBe(
      'The door is closed.',
    );
  });

  it('stays out of refusals that are not about a move', () => {
    expect(tokenRefusal(`${DOOR_LOCKED}: that door is locked`)).toBeNull();
    expect(tokenRefusal('no token def "goblin"')).toBeNull();
  });
});

// ── P4 §3/§4 — Sight & light, and the links ────────────────────────────────

describe('mapScale / the unit a DM reads ranges in', () => {
  it('quotes the map’s own unit and stores cells either way', () => {
    const feet = { value: 5, unit: 'ft' };
    expect(mapScale({ mapSettings: { cellScale: feet } })).toEqual(feet);
    expect(toUnits(6, feet)).toBe(30);
    expect(toCells(30, feet)).toBe(6);
    // A half-cell radius is 2.5 ft, not 2.5000000000000004.
    expect(toUnits(1.5, feet)).toBe(7.5);
    // No scale on the document ⇒ cells, which is honest rather than a guessed 5 ft.
    expect(mapScale(null)).toEqual({ value: 1, unit: 'cells' });
    expect(mapScale({ mapSettings: { cellScale: { value: 0, unit: 'ft' } } }).value).toBe(1);
  });
});

describe('TokenPanel — the DM’s section (owner, sight & light)', () => {
  const dm: PlayerInfo = { identityId: 'dm-1', name: 'Ayla', role: 'dm', connected: true };
  const player: PlayerInfo = { identityId: 'p-1', name: 'Borin', role: 'player', connected: true };

  const scene = (tokens: Token[]): SessionState => ({
    protocolVersion: PROTOCOL_VERSION,
    sessionId: 's1',
    campaignId: 'c1',
    activeSceneId: 'scene-1',
    scenes: [{ id: 'scene-1', name: 'Crypt', mapId: 'scene-1' }],
    players: [dm, player],
    modules: {
      tokens: { library: {}, byScene: { 'scene-1': Object.fromEntries(tokens.map((t) => [t.id, t])) } },
    },
  });

  interface Sent {
    module: string;
    action: string;
    payload: Record<string, unknown>;
  }

  /** Renders the panel with `tokens` on the scene and the first one selected. */
  function panel(tokens: Token[], you: PlayerInfo = dm): Sent[] {
    const sent: Sent[] = [];
    useSessionStore.setState({
      session: scene(tokens),
      you,
      lastError: null,
      mapData: { mapSettings: { cellScale: { value: 5, unit: 'ft' } } },
      client: { send: (m: Sent) => sent.push(m) } as unknown as WebSocketClient,
    });
    useTokenInteraction.getState().select(tokens[0].id);
    render(createElement(TokenPanel));
    return sent;
  }

  beforeEach(() => {
    cleanup();
    useToasts.setState({ toast: null });
  });

  it('is the DM’s section alone — a player who owns the token never sees it', () => {
    panel([token({ ownerId: 'p-1' })], player);
    expect(screen.queryByTestId('token-sight')).toBeNull();
    expect(screen.queryByLabelText('Owner')).toBeNull();
  });

  /**
   * The way out of the join deadlock: a seat with no token is sent no tokens in vision mode,
   * so there is nothing on its list to claim. The DM hands one over from here instead.
   */
  it('hands a token to a player from the Owner select, and takes it back', () => {
    const sent = panel([token()]);
    const select = screen.getByLabelText('Owner');
    // The seats, and only the seats — the DM is not an owner you can pick.
    expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'Unassigned',
      'Borin',
    ]);
    expect(select).toHaveProperty('value', '');

    fireEvent.change(select, { target: { value: 'p-1' } });
    expect(sent[0]).toMatchObject({
      module: 'tokens',
      action: 'assign',
      payload: { id: 't1', identityId: 'p-1' },
    });

    // With an owner stored the select reads it back, and "Unassigned" clears it.
    cleanup();
    const held = panel([token({ ownerId: 'p-1' })]);
    expect(screen.getByLabelText('Owner')).toHaveProperty('value', 'p-1');
    fireEvent.change(screen.getByLabelText('Owner'), { target: { value: '' } });
    expect(held[0].payload).toEqual({ id: 't1', identityId: null });
  });

  it('gives a token sight and takes it away again, in the map’s own unit', () => {
    const sent = panel([token()]);
    // Nothing to edit until it has some: sight is nullable and starts null.
    expect(screen.queryByLabelText('Sight range')).toBeNull();

    fireEvent.click(screen.getByTestId('token-sight-add'));
    expect(sent[0]).toMatchObject({
      module: 'tokens',
      action: 'update',
      payload: { id: 't1', sight: { range: 6, angle: 360, visionMode: 'normal' } },
    });

    // …and with sight on the token, the field reads 30 ft for those 6 cells.
    cleanup();
    const withSight = panel([token({ sight: { range: 6, angle: 360, visionMode: 'normal' } })]);
    expect(screen.getByLabelText('Sight range')).toHaveProperty('value', '30');

    // A range commits on blur, never per keystroke (every update is a sweep + a broadcast).
    fireEvent.change(screen.getByLabelText('Sight range'), { target: { value: '60' } });
    expect(withSight).toEqual([]);
    fireEvent.blur(screen.getByLabelText('Sight range'));
    expect(withSight[0].payload.sight).toEqual({ range: 12, angle: 360, visionMode: 'normal' });

    fireEvent.change(screen.getByLabelText('Vision mode'), { target: { value: 'darkvision' } });
    expect(withSight[1].payload.sight).toMatchObject({ visionMode: 'darkvision' });

    fireEvent.click(screen.getByTestId('token-sight-clear'));
    expect(withSight[2].payload).toEqual({ id: 't1', sight: null });
  });

  it('edits the carried light the same way, colour included', () => {
    const sent = panel([token({ light: { dim: 8, bright: 4, color: '#ffbb66', angle: 360 } })]);
    expect(screen.getByLabelText('Dim light radius')).toHaveProperty('value', '40');
    expect(screen.getByLabelText('Bright light radius')).toHaveProperty('value', '20');

    fireEvent.change(screen.getByLabelText('Bright light radius'), { target: { value: '10' } });
    fireEvent.blur(screen.getByLabelText('Bright light radius'));
    expect(sent[0].payload.light).toEqual({ dim: 8, bright: 2, color: '#ffbb66', angle: 360 });

    fireEvent.change(screen.getByLabelText('Light colour'), { target: { value: '#3366ff' } });
    expect(sent[1].payload.light).toMatchObject({ color: '#3366ff' });

    fireEvent.click(screen.getByTestId('token-light-clear'));
    expect(sent[2].payload).toEqual({ id: 't1', light: null });
  });

  it('commits a range once, on the way out — and never commits an emptied field', () => {
    const sent = panel([token({ sight: { range: 6, angle: 360, visionMode: 'normal' }, light: null })]);
    const range = screen.getByLabelText('Sight range');

    // Typing "120" one key at a time: three updates would be three party sweeps and three
    // fog broadcasts, and the table would spend the middle of them playing on a 10 ft range.
    for (const value of ['1', '12', '120']) fireEvent.change(range, { target: { value } });
    expect(sent).toEqual([]);

    fireEvent.blur(range);
    expect(sent).toHaveLength(1);
    expect(sent[0].payload.sight).toEqual({ range: 24, angle: 360, visionMode: 'normal' });

    // Clearing the field to type a new number reads as NaN, which used to commit as 0 —
    // sight range zero collapses every player's mask mid-keystroke. Nothing is sent, and the
    // field falls back to the value the table is still playing on.
    fireEvent.change(range, { target: { value: '' } });
    fireEvent.blur(range);
    expect(sent).toHaveLength(1);
    expect(range).toHaveProperty('value', '30');

    // Enter commits from the keyboard, exactly once — it blurs rather than sending beside it.
    fireEvent.change(range, { target: { value: '45' } });
    fireEvent.keyDown(range, { key: 'Enter' });
    expect(sent).toHaveLength(2);
    expect(sent[1].payload.sight).toMatchObject({ range: 9 });
  });

  it('links a token to another and unlinks it from the chip', () => {
    const familiar = token({ id: 't2', name: 'Hawk' });
    const sent = panel([token(), familiar]);
    // Offered, not linked: no chip yet.
    expect(screen.getByTestId('token-links').querySelector('[data-link-id]')).toBeNull();

    fireEvent.change(screen.getByLabelText('Link a token'), { target: { value: 't2' } });
    expect(sent[0]).toMatchObject({
      module: 'tokens',
      action: 'set-sight-link',
      payload: { id: 't1', otherId: 't2', linked: true },
    });

    // With the link stored, the chip names the other token and its × unlinks.
    cleanup();
    const linked = panel([token({ sharesSightWith: ['t2'] }), familiar]);
    expect(screen.getByTestId('token-links').textContent).toContain('Hawk');
    fireEvent.click(screen.getByLabelText('Unlink Hawk'));
    expect(linked[0]).toMatchObject({
      action: 'set-sight-link',
      payload: { id: 't1', otherId: 't2', linked: false },
    });
    // A token cannot be offered to itself, nor offered twice.
    expect(screen.queryByLabelText('Link a token')).toBeNull();
  });
});
