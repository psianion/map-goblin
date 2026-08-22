import { PROTOCOL_VERSION } from '@dnd/core/src/shared/protocol';
import type { SessionState } from '@dnd/core/src/shared/protocol';
import type { InitiativeState } from '@dnd/mechanics/initiative';
import type { TriggersState } from '@dnd/mechanics/triggers';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore } from '../session/store';
import { RollBar } from './RollBar';

function session(modules: SessionState['modules']): SessionState {
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionId: 's1',
    campaignId: 'c1',
    activeSceneId: 'sc-1',
    scenes: [],
    players: [],
    modules,
  };
}

function triggersWithPrompt(): TriggersState {
  return {
    byScene: {
      'sc-1': {
        fired: {},
        armed: {},
        disabled: {},
        lightOverrides: {},
        env: {},
        log: [],
        prompts: [
          {
            id: 'p1',
            triggerId: 't1',
            kind: 'trap',
            targetIdentityId: 'me',
            text: 'The floor gives way.',
            at: 1,
          },
        ],
      },
    },
  } as TriggersState;
}

beforeEach(() => {
  useSessionStore.setState({ session: null, presence: [], mapData: null, you: null, sendCommand: vi.fn() });
});
afterEach(() => cleanup());

describe('RollBar', () => {
  it('renders the composer input', () => {
    useSessionStore.setState({ session: session({}) });
    render(<RollBar />);
    expect(screen.getByTestId('manual-roll')).toBeTruthy();
    expect(screen.getByLabelText('Roll or say something')).toBeTruthy();
  });

  it('posts a public line on submit and clears the draft', () => {
    const sendCommand = vi.fn();
    useSessionStore.setState({ sendCommand, session: session({}) });
    render(<RollBar />);
    const input = screen.getByTestId('manual-roll') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'stealth 17' } });
    fireEvent.click(screen.getByText('Post'));

    expect(sendCommand).toHaveBeenCalledWith('rolls', 'post', {
      source: 'manual',
      text: 'stealth 17',
      visibility: 'public',
    });
    expect(input.value).toBe('');
  });

  it('posts private with Whisper on, then resets the toggle', () => {
    const sendCommand = vi.fn();
    useSessionStore.setState({ sendCommand, session: session({}) });
    render(<RollBar />);
    const whisper = screen.getByRole('button', { name: 'Whisper' });
    fireEvent.click(whisper);
    expect(whisper.getAttribute('aria-pressed')).toBe('true');

    fireEvent.change(screen.getByTestId('manual-roll'), { target: { value: 'a secret note' } });
    fireEvent.click(screen.getByText('Post'));

    expect(sendCommand).toHaveBeenCalledWith('rolls', 'post', {
      source: 'manual',
      text: 'a secret note',
      visibility: 'private',
    });
    expect(whisper.getAttribute('aria-pressed')).toBe('false');
  });

  it('does not shift with nothing prompting', () => {
    useSessionStore.setState({ session: session({}) });
    render(<RollBar />);
    expect(screen.getByTestId('roll-bar').className).not.toContain('-translate-y-12');
  });

  it('shifts up while this seat owes the table an initiative number', () => {
    useSessionStore.setState({
      you: { identityId: 'me', name: 'Willow', role: 'player', connected: true },
      session: session({
        initiative: {
          status: 'gathering',
          sceneId: 'sc-1',
          round: 0,
          turn: 0,
          entries: [{ key: 'k1', name: 'Willow', kind: 'pc', identityId: 'me', initiative: null }],
          log: [],
        } satisfies InitiativeState,
      }),
    });
    render(<RollBar />);
    expect(screen.getByTestId('roll-bar').className).toContain('-translate-y-12');
  });

  it('shifts up while a trigger prompt card is open for this seat', () => {
    useSessionStore.setState({
      you: { identityId: 'me', name: 'Willow', role: 'player', connected: true },
      session: session({ triggers: triggersWithPrompt() }),
    });
    render(<RollBar />);
    expect(screen.getByTestId('roll-bar').className).toContain('-translate-y-12');
  });
});
