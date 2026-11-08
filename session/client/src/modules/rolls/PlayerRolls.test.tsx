import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { RollsState } from '@dnd/mechanics/rolls';
import { useDetectedSheet } from '../../session/detectedSheet';
import { BRAM, DM, seat, sent, token, tokensState } from '../tokens/playTestSeat';
import { CharacterSheet } from './CharacterSheet';
import { PlayOverlays } from './PlayOverlays';
import { InitiativePromptCard, PlayerRollBar, RollChips, RollPromptCard } from './PlayerRolls';
import { beyond20State, owedRequests } from './dice';

vi.mock('@dnd/ui/toast', () => ({ notify: { info: vi.fn(), error: vi.fn() } }));
vi.mock('../../shell/findMyToken', () => ({ findMyToken: vi.fn(() => true) }));

afterEach(cleanup);

const asked: RollsState = {
  log: [],
  requests: [{ id: 'q1', at: 0, label: 'Perception check', dc: 14, targets: [BRAM.identityId], results: [], shared: false }],
};

describe('player roll bar', () => {
  it('rolls dice and a formula with the chosen privacy', () => {
    const spy = seat({}, BRAM);
    render(<PlayerRollBar />);
    fireEvent.click(screen.getByTestId('roll-bar-mode-dm'));
    fireEvent.click(screen.getByTestId('roll-bar-d6'));
    fireEvent.change(screen.getByTestId('roll-bar-formula'), { target: { value: '1d20+5' } });
    fireEvent.keyDown(screen.getByTestId('roll-bar-formula'), { key: 'Enter' });
    expect(sent(spy)).toEqual([
      ['rolls', 'roll', { formula: '1d6', mode: 'dm' }],
      ['rolls', 'roll', { formula: '1d20+5', mode: 'dm' }],
    ]);
  });

  it('only players get the bar and the prompt', () => {
    seat({ rolls: asked }, DM);
    render(<PlayOverlays />);
    expect(screen.queryByTestId('player-roll-bar')).toBeNull();
  });
});

describe('roll prompt card', () => {
  it('shows the DM’s request and sends the answer with the modifier', () => {
    const spy = seat({ rolls: asked }, BRAM);
    render(<RollPromptCard />);
    expect(screen.getByTestId('roll-prompt-title').textContent).toBe('Perception check, DC 14');
    fireEvent.change(screen.getByTestId('roll-prompt-mod'), { target: { value: '3' } });
    fireEvent.click(screen.getByTestId('roll-prompt-roll'));
    expect(sent(spy)).toEqual([['rolls', 'roll-result', { requestId: 'q1', formula: '1d20+3' }]]);
  });

  it('goes once this seat has answered', () => {
    const answered: RollsState = {
      ...asked,
      requests: [{ ...asked.requests![0], results: [{ identityId: BRAM.identityId, playerName: 'Sam', total: 12, at: 1 }] }],
    };
    expect(owedRequests(answered, BRAM.identityId)).toEqual([]);
    seat({ rolls: answered }, BRAM);
    render(<RollPromptCard />);
    expect(screen.queryByTestId('roll-prompt')).toBeNull();
  });
});

describe('result chips', () => {
  it('stand by the roller’s token for a fresh roll with a total', () => {
    const now = Date.now();
    seat({
      tokens: tokensState([token({ id: 'b', ownerId: BRAM.identityId, kind: 'pc' })]),
      rolls: {
        log: [
          { id: 'r1', at: now, identityId: BRAM.identityId, playerName: 'Sam', source: 'server', visibility: 'public', mode: 'public', total: 17, formula: '1d20' },
          { id: 'r2', at: now - 60_000, identityId: BRAM.identityId, playerName: 'Sam', source: 'server', visibility: 'public', total: 3 },
        ],
      },
    });
    render(<RollChips />);
    expect(screen.getAllByTestId('roll-chip').map((c) => c.textContent)).toEqual(['17']);
  });
});

describe('Character sheet', () => {
  it('shows the PC’s HP, AC, speed, passive and conditions, and heals with the quick buttons', () => {
    const spy = seat(
      {
        tokens: tokensState([
          token({ id: 'b', name: 'Bram', kind: 'pc', ownerId: BRAM.identityId, hp: { current: 9, max: 24 }, ac: 16, speed: 30, passive: 14, conditions: ['poisoned'] }),
        ]),
      },
      BRAM,
    );
    render(<CharacterSheet />);
    expect(screen.getByTestId('character-hp').textContent).toBe('9 / 24 HP');
    expect(screen.getByTestId('character-sheet').textContent).toContain('30 ft');
    expect(screen.getByTestId('character-sheet').textContent).toContain('14');
    expect(screen.getByTestId('character-conditions').textContent).toBe('Poisoned');
    fireEvent.change(screen.getByTestId('character-amount'), { target: { value: '5' } });
    fireEvent.click(screen.getByTestId('character-heal'));
    expect(sent(spy)).toEqual([['tokens', 'heal', { targets: ['b'], amount: 5 }]]);
  });

  it('says how Beyond20 stands and finds the token', async () => {
    seat({ tokens: tokensState([token({ id: 'b', name: 'Bram', kind: 'pc', ownerId: BRAM.identityId })]) }, BRAM);
    useDetectedSheet.setState({ sheet: { name: 'Bram the Bold' } });
    render(<CharacterSheet />);
    expect(screen.getByTestId('character-beyond20').textContent).toContain('Beyond20 sees Bram the Bold');
    fireEvent.click(screen.getByTestId('character-find'));
    const { findMyToken } = await import('../../shell/findMyToken');
    expect(findMyToken).toHaveBeenCalled();
    useDetectedSheet.setState({ sheet: null });
  });

  it('beyond20State: linked, seen, or not connected', () => {
    expect(beyond20State('Bram', 'x').label).toBe('Beyond20: Bram');
    expect(beyond20State(undefined, undefined)).toEqual({ label: 'Beyond20 not connected', live: false });
  });
});

describe('initiative prompt card', () => {
  const gathering = {
    status: 'gathering',
    sceneId: 'scene-1',
    round: 0,
    turn: 0,
    entries: [{ key: 'e1', name: 'Bram', kind: 'pc', identityId: BRAM.identityId, initiative: null }],
    log: [],
  };

  it('asks the player for their number and sets it, typed or from the last roll', () => {
    const spy = seat(
      {
        initiative: gathering,
        rolls: { log: [{ id: 'r', at: 1, identityId: BRAM.identityId, playerName: 'Sam', source: 'server', visibility: 'public', total: 15, title: 'Initiative' }] },
      },
      BRAM,
    );
    render(<InitiativePromptCard />);
    fireEvent.click(screen.getByTestId('initiative-prompt-last'));
    fireEvent.change(screen.getByTestId('initiative-prompt-value'), { target: { value: '12' } });
    fireEvent.keyDown(screen.getByTestId('initiative-prompt-value'), { key: 'Enter' });
    expect(sent(spy)).toEqual([
      ['initiative', 'set', { key: 'e1', value: 15 }],
      ['initiative', 'set', { key: 'e1', value: 12 }],
    ]);
  });

  it('is gone once the entry has a number, and never shows for someone else’s', () => {
    seat({ initiative: { ...gathering, entries: [{ ...gathering.entries[0], initiative: 9 }] } }, BRAM);
    render(<InitiativePromptCard />);
    expect(screen.queryByTestId('initiative-prompt')).toBeNull();
    cleanup();
    seat({ initiative: gathering }, DM);
    render(<InitiativePromptCard />);
    expect(screen.queryByTestId('initiative-prompt')).toBeNull();
  });
});
