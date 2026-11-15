import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PROTOCOL_VERSION, type PlayerInfo, type SessionState } from '@dnd/core/src/shared/protocol';
import { useStore } from '@dnd/core/src/store/store';
import type { WebSocketClient } from '../../session/WebSocketClient';
import { useSessionStore } from '../../session/store';
import { WorldBody } from './WorldTab';
import { setDarknessPreview, setDmLit } from './worldPrefs';

const dm: PlayerInfo = { identityId: 'd', name: 'Dana', role: 'dm', connected: true };
const pia: PlayerInfo = { identityId: 'p1', name: 'Pia', role: 'player', connected: true };

const BASE_SCENE = { fired: {}, armed: {}, disabled: {}, lightOverrides: {}, lightEdits: {}, prompts: [], log: [] };

function session(scene: Record<string, unknown> = {}): SessionState {
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionId: 's1',
    campaignId: 'c1',
    activeSceneId: 'a',
    scenes: [{ id: 'a', name: 'A', mapId: 'm' }],
    players: [dm, pia],
    modules: { triggers: { byScene: Object.keys(scene).length ? { a: scene } : {}, world: { time: 'day' } } },
  };
}

interface Sent {
  module: string;
  action: string;
  payload: unknown;
}
function capture(): Sent[] {
  const sent: Sent[] = [];
  useSessionStore.setState({ client: { send: (m: Sent) => sent.push(m) } as unknown as WebSocketClient });
  return sent;
}

beforeEach(() => {
  cleanup();
  useSessionStore.setState({
    you: dm,
    session: session(),
    mapData: { layers: [{ id: 'L', type: 'dungeon', rooms: [{ id: 'r1', name: 'Hall', boundary: [[0, 0], [1, 0], [1, 1]] }], children: [] }] },
  });
  useStore.setState({
    levels: [
      { id: 'lv1', name: 'Ground' },
      { id: 'lv2', name: 'Cellar' },
    ],
  });
});

describe('Sky tab', () => {
  it('sets the campaign time from the tiles', () => {
    const sent = capture();
    render(<WorldBody />);
    fireEvent.click(screen.getByRole('button', { name: 'Dusk' }));
    expect(sent).toEqual([expect.objectContaining({ module: 'triggers', action: 'set-world', payload: { time: 'dusk' } })]);
  });
  it('marks the current time, and sends nothing for picking it again', () => {
    const sent = capture();
    render(<WorldBody />);
    expect(screen.getByRole('button', { name: 'Day' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Day' }));
    expect(sent).toEqual([]);
  });

  it('has no weather, moon, clock speed or hour controls any more', () => {
    render(<WorldBody />);
    for (const name of [/weather/i, /moon/i, /speed/i, /pause/i, /rain/i, /storm/i]) {
      expect(screen.queryByText(name)).toBeNull();
    }
  });

  it('reads Darkness · Auto, with Auto disabled, while the scene has no slider value', () => {
    render(<WorldBody />);
    expect(screen.getByText('Darkness · Auto')).toBeTruthy();
    expect((screen.getByTestId('world-darkness-auto') as HTMLButtonElement).disabled).toBe(true);
  });

  it('hands the scene back to Auto from the Auto button', () => {
    useSessionStore.setState({ session: session({ ...BASE_SCENE, darkness: 0.7 }) });
    const sent = capture();
    render(<WorldBody />);
    expect(screen.getByText('Darkness')).toBeTruthy();
    expect(screen.getByText('0.70')).toBeTruthy();
    fireEvent.click(screen.getByTestId('world-darkness-auto'));
    expect(sent).toEqual([
      expect.objectContaining({ module: 'triggers', action: 'set-darkness', payload: { sceneId: 'a', value: null } }),
    ]);
  });

  it('commits the slider to this scene once the hand stops', () => {
    vi.useFakeTimers();
    const sent = capture();
    render(<WorldBody />);
    fireEvent.change(document.querySelector('input[type="range"]')!, { target: { value: '80' } });
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(400);
    expect(sent).toEqual([
      expect.objectContaining({ module: 'triggers', action: 'set-darkness', payload: { sceneId: 'a', value: 0.8 } }),
    ]);
  });

  it('turns the DM lit view on and off from the switch', () => {
    render(<WorldBody />);
    const lit = screen.getByRole('switch', { name: 'Show me everything lit' });
    expect(lit.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(lit);
    expect(screen.getByRole('switch', { name: 'Show me everything lit' }).getAttribute('aria-checked')).toBe('true');
  });
});

afterEach(() => {
  vi.useRealTimers();
  setDarknessPreview(null);
  setDmLit(false);
});
