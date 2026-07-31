import { createElement } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { DOOR_LOCKED } from '@dnd/mechanics/doors';
import type { Token } from '@dnd/mechanics/tokens';
import type { PlayerInfo, SessionState } from '@dnd/core/src/shared/protocol';
import { useSessionStore } from '../../session/store';
import { useToasts } from '../../session/toasts';
import { approach, canDrag, createThrottle, drawOrder, hitTest, tokenRefusal } from './drag';
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
    protocolVersion: 3,
    sessionId: 's1',
    campaignId: 'c1',
    activeSceneId: 'scene-1',
    scenes: [{ id: 'scene-1', name: 'Crypt' }],
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

    const shown: string[] = [];
    const unsubscribe = useToasts.subscribe((s) => {
      if (s.toast) shown.push(s.toast.message);
    });
    // A drag across a wall is refused on the way at ~10 Hz and again on the drop; the
    // player is owed one answer, not one per message.
    act(() => useSessionStore.setState({ lastError: refused(1) }));
    act(() => useSessionStore.setState({ lastError: refused(2) }));
    unsubscribe();

    expect(shown).toEqual(["You can't move there."]);
  });

  it('says nothing when the move was taken — a slow echo is not a refusal', () => {
    render(createElement(TokenPanel));
    act(() => useSessionStore.setState({ session: session([token({ x: 4.5, y: 6.5 })]) }));
    expect(useToasts.getState().toast).toBeNull();
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
