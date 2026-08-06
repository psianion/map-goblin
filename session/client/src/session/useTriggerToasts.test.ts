import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { PlayerInfo, SessionState } from '@dnd/core/src/shared/protocol';
import { PROTOCOL_VERSION } from '@dnd/core/src/shared/protocol';
import type { TriggerLogEntry, TriggersState } from '@dnd/mechanics/triggers';
import { pickToastable, useTriggerToasts } from './useTriggerToasts';
import { useSessionStore } from './store';
import { useToasts } from './toasts';

const entry = (over: Partial<TriggerLogEntry> = {}): TriggerLogEntry => ({
  id: 'e1',
  at: 0,
  kind: 'show-text',
  text: 'The brazier flares to life.',
  toPlayers: true,
  ...over,
});

describe('pickToastable', () => {
  it('surfaces new show-text entries addressed to players', () => {
    const e = entry();
    expect(pickToastable([e], new Set(), undefined)).toEqual([e]);
  });

  it('drops a show-text entry the DM kept private', () => {
    const e = entry({ toPlayers: false });
    expect(pickToastable([e], new Set(), undefined)).toEqual([]);
  });

  it('drops entries already seen', () => {
    const e = entry();
    expect(pickToastable([e], new Set(['e1']), undefined)).toEqual([]);
  });

  it('surfaces a roll outcome addressed to this viewer regardless of kind', () => {
    const e = entry({
      id: 'e2',
      kind: 'roll-outcome',
      toPlayers: false,
      forIdentityId: 'me',
      text: "Your DEX save: 14 vs DC 13 — success",
    });
    expect(pickToastable([e], new Set(), 'me')).toEqual([e]);
  });

  it('does not surface another viewer\'s roll outcome', () => {
    const e = entry({ id: 'e2', kind: 'roll-outcome', toPlayers: false, forIdentityId: 'someone-else' });
    expect(pickToastable([e], new Set(), 'me')).toEqual([]);
  });

  it('ignores forIdentityId entries when this viewer has no identity yet', () => {
    const e = entry({ id: 'e2', kind: 'roll-outcome', toPlayers: false, forIdentityId: 'me' });
    expect(pickToastable([e], new Set(), undefined)).toEqual([]);
  });

  it('surfaces a player-visible environment change (M4)', () => {
    const e = entry({ id: 'e2', kind: 'environment', text: 'Weather: storm' });
    expect(pickToastable([e], new Set(), undefined)).toEqual([e]);
  });

  it('surfaces a player-visible light change (M5)', () => {
    const e = entry({ id: 'e2', kind: 'light', text: 'The brazier lights' });
    expect(pickToastable([e], new Set(), undefined)).toEqual([e]);
  });

  it('drops a light/environment line the DM kept private', () => {
    const e = entry({ id: 'e2', kind: 'light', text: 'A light kindles', toPlayers: false });
    expect(pickToastable([e], new Set(), undefined)).toEqual([]);
  });
});

const dm: PlayerInfo = { identityId: 'dm1', name: 'Ann', role: 'dm', connected: true };

function session(log: TriggerLogEntry[]): SessionState {
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionId: 's1',
    campaignId: 'c1',
    activeSceneId: 'scene-1',
    scenes: [{ id: 'scene-1', name: 'Crypt' }],
    players: [dm],
    modules: {
      triggers: {
        byScene: {
          'scene-1': { fired: {}, armed: {}, disabled: {}, lightOverrides: {}, env: {}, prompts: [], log },
        },
      } satisfies TriggersState,
    },
  } as unknown as SessionState;
}

describe('useTriggerToasts (F2)', () => {
  beforeEach(() => {
    useToasts.setState({ toast: null });
    useSessionStore.setState({ session: session([]), you: dm });
  });

  it('raises exactly one toast carrying both texts when two toastable entries land in one update', () => {
    renderHook(() => useTriggerToasts());

    act(() => {
      useSessionStore.setState({
        session: session([
          entry({ id: 'e1', text: 'Dusk settles' }),
          entry({ id: 'e2', kind: 'environment', text: 'Rain begins to fall' }),
        ]),
      });
    });

    expect(useToasts.getState().toast?.message).toBe('Dusk settles\nRain begins to fall');
  });
});
