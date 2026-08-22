import { describe, expect, it } from 'vitest';
import type { InitiativeState } from '@dnd/mechanics/initiative';
import type { TokensState } from '@dnd/mechanics/tokens';
import { activeTurnToken, ringGeometry } from './TurnRing';

const REFERENCE_ZOOM = 20;

describe('ringGeometry', () => {
  it('keeps constant on-screen weight: world constants halve when the zoom doubles', () => {
    const at100 = ringGeometry(1, REFERENCE_ZOOM);
    const at200 = ringGeometry(1, REFERENCE_ZOOM * 2);
    expect(at200.whiteWidth).toBeCloseTo(at100.whiteWidth / 2);
    expect(at200.inkWidth).toBeCloseTo(at100.inkWidth / 2);
    // Screen-space width = world width * zoom, and that is the invariant that matters.
    expect(at200.whiteWidth * REFERENCE_ZOOM * 2).toBeCloseTo(at100.whiteWidth * REFERENCE_ZOOM);
  });

  it('rides the token footprint but keeps a fixed screen clearance around it', () => {
    const small = ringGeometry(1, REFERENCE_ZOOM);
    const large = ringGeometry(4, REFERENCE_ZOOM);
    expect(large.radius - small.radius).toBeCloseTo(1.5); // 4/2 - 1/2 cells
    const zoomed = ringGeometry(1, REFERENCE_ZOOM * 4);
    expect(zoomed.radius - 0.5).toBeCloseTo((small.radius - 0.5) / 4);
  });

  it('falls back to 100% for a zero zoom rather than dividing by it', () => {
    expect(ringGeometry(1, 0)).toEqual(ringGeometry(1, REFERENCE_ZOOM));
  });

  it('draws the ink underlay wider than the white line', () => {
    const g = ringGeometry(1, REFERENCE_ZOOM);
    expect(g.inkWidth).toBeGreaterThan(g.whiteWidth);
  });
});

const token = (id: string) => ({
  id,
  name: id,
  size: 'medium',
  disposition: 'friendly',
  x: 3,
  y: 4,
  ownerId: null,
  hidden: false,
  imageAssetId: null,
});

const tokens = { byScene: { s1: { t1: token('t1'), t2: token('t2') } } } as unknown as TokensState;

const running = (over: Partial<InitiativeState> = {}): InitiativeState =>
  ({
    status: 'running',
    sceneId: 's1',
    round: 1,
    turn: 0,
    entries: [
      { key: 'a', name: 'Borin', kind: 'pc', tokenId: 't1', initiative: 18 },
      { key: 'b', name: 'Voice in the dark', kind: 'npc', initiative: 12 },
    ],
    log: [],
    ...over,
  }) as InitiativeState;

describe('activeTurnToken', () => {
  it('rings the token whose turn it is', () => {
    expect(activeTurnToken(running(), tokens, 's1')?.id).toBe('t1');
  });

  it('draws nothing while idle or gathering, or before any state arrives', () => {
    expect(activeTurnToken(undefined, tokens, 's1')).toBeNull();
    expect(activeTurnToken(running({ status: 'idle' }), tokens, 's1')).toBeNull();
    expect(activeTurnToken(running({ status: 'gathering' }), tokens, 's1')).toBeNull();
  });

  it('draws nothing when the table is looking at another scene', () => {
    expect(activeTurnToken(running(), tokens, 's2')).toBeNull();
    expect(activeTurnToken(running({ sceneId: 's9' }), tokens, 's1')).toBeNull();
    expect(activeTurnToken(running(), tokens, null)).toBeNull();
  });

  it('draws nothing for an off-board combatant or a token no longer on the board', () => {
    expect(activeTurnToken(running({ turn: 1 }), tokens, 's1')).toBeNull();
    expect(activeTurnToken(running({ turn: 5 }), tokens, 's1')).toBeNull();
    expect(activeTurnToken(running(), { byScene: { s1: {} } } as unknown as TokensState, 's1')).toBeNull();
    expect(activeTurnToken(running(), undefined, 's1')).toBeNull();
  });
});
