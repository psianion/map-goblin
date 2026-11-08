import { describe, expect, it } from 'vitest';
import type { TokensState } from '@dnd/mechanics/tokens';
import { useTokenInteraction } from '../../modules/tokens/drag';
import { previewAs, previewCandidates } from './previewAs';

describe('Preview as', () => {
  const tokens = {
    library: {},
    byScene: {
      a: {
        t1: { id: 't1', name: 'Pia', ownerId: 'p1', sight: { range: 60, angle: 360, visionMode: 'normal' } },
        t2: { id: 't2', name: 'Wolf', ownerId: null, sight: { range: 60, angle: 360, visionMode: 'normal' } },
        t3: { id: 't3', name: 'Bo', ownerId: 'p2', sight: null },
      },
    },
  } as unknown as TokensState;

  it('offers only owned tokens with eyes', () => {
    expect(previewCandidates(tokens, 'a').map((t) => t.id)).toEqual(['t1']);
  });

  it('points the sight preview at the token, and turns it off', () => {
    previewAs('t1');
    expect(useTokenInteraction.getState()).toMatchObject({ selectedId: 't1', previewSight: true });
    previewAs(null);
    expect(useTokenInteraction.getState().previewSight).toBe(false);
  });
});
