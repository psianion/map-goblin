import { describe, expect, it } from 'vitest';
import type { Token } from '@dnd/mechanics/tokens';
import { approach, canDrag, createThrottle, drawOrder, hitTest } from './drag';
import { DISPOSITION_COLOR, initials, tokensOf } from './TokenRenderer';

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
