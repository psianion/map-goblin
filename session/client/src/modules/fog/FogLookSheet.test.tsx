import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PROTOCOL_VERSION, type PlayerInfo, type SessionState } from '@dnd/core/src/shared/protocol';
import { DEFAULT_FOG_LOOK } from '@dnd/core/src/shared/fogLook';
import type { WebSocketClient } from '../../session/WebSocketClient';
import { useSessionStore } from '../../session/store';
import { useAsPlayers } from './asPlayers';
import { FogLookSheet } from './FogLookSheet';
import { FogBody } from './FogTab';
import { changedCaption, changedFields } from './look';

const dm: PlayerInfo = { identityId: 'd', name: 'Dana', role: 'dm', connected: true };

const session = (look?: object): SessionState => ({
  protocolVersion: PROTOCOL_VERSION,
  sessionId: 's1',
  campaignId: 'c1',
  activeSceneId: 'a',
  scenes: [{ id: 'a', name: 'Cave', mapId: 'm' }],
  players: [dm],
  modules: { fog: { byScene: { a: { rooms: {}, concealBehindDoors: true, on: true, ...(look ? { look } : {}) } } } },
});

interface Sent {
  module: string;
  action: string;
  payload: { look: unknown };
}
let sent: Sent[];

beforeEach(() => {
  cleanup();
  sent = [];
  useAsPlayers.getState().set(false);
  useSessionStore.setState({
    you: dm,
    session: session(),
    mapData: { frame: { minX: 0, minY: 0, maxX: 4, maxY: 4 }, layers: [] },
    client: { send: (m: Sent) => sent.push(m) } as unknown as WebSocketClient,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * A slider's range input, found by its row's label or its own aria-label. The role query cannot
 * see it: the thumb stays hidden until it is measured, which jsdom never does.
 */
const slider = (name: string): HTMLElement => {
  const labelled = document.querySelector(`[aria-label="${name}"]`);
  const row = labelled ?? screen.getByText(name).closest('[data-composite="slider-row"]');
  const input = row instanceof HTMLInputElement ? row : row?.querySelector('input[type="range"]');
  if (!input) throw new Error(`no slider named ${name}`);
  return input as HTMLElement;
};

describe('the Look sheet', () => {
  it('sends several drags inside 150 ms as one merged patch', () => {
    vi.useFakeTimers();
    render(<FogLookSheet />);
    fireEvent.keyDown(slider('Wind'), { key: 'ArrowRight' });
    act(() => vi.advanceTimersByTime(60));
    fireEvent.keyDown(slider('Torch glow'), { key: 'ArrowLeft' });
    act(() => vi.advanceTimersByTime(60));
    fireEvent.keyDown(slider('Wind'), { key: 'ArrowRight' });
    expect(sent).toEqual([]);
    act(() => vi.advanceTimersByTime(150));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ module: 'fog', action: 'set-fog-look' });
    expect(sent[0]!.payload.look).toEqual({ wind: DEFAULT_FOG_LOOK.wind + 1, glow: DEFAULT_FOG_LOOK.glow - 0.05 });
  });

  it('changes a layer by sending all three, the others as they were', () => {
    vi.useFakeTimers();
    render(<FogLookSheet />);
    fireEvent.click(screen.getByText('Advanced'));
    fireEvent.keyDown(slider('Haze strength'), { key: 'ArrowLeft' });
    act(() => vi.advanceTimersByTime(150));
    const layers = (sent[0]!.payload.look as { layers: { strength: number }[] }).layers;
    expect(layers.map((l) => l.strength)).toEqual([
      DEFAULT_FOG_LOOK.layers[0].strength,
      DEFAULT_FOG_LOOK.layers[1].strength - 0.05,
      DEFAULT_FOG_LOOK.layers[2].strength,
    ]);
  });

  it('sends null for Back to default', () => {
    useSessionStore.setState({ session: session({ wind: 9 }) });
    render(<FogLookSheet />);
    fireEvent.click(screen.getByTestId('fog-look-reset'));
    expect(sent.at(-1)).toMatchObject({ action: 'set-fog-look', payload: { look: null } });
  });

  it('turns "As players see it" on while open and puts back what it was on close', () => {
    const { unmount } = render(<FogLookSheet />);
    expect(useAsPlayers.getState().on).toBe(true);
    unmount();
    expect(useAsPlayers.getState().on).toBe(false);

    useAsPlayers.getState().set(true);
    const again = render(<FogLookSheet />);
    again.unmount();
    expect(useAsPlayers.getState().on).toBe(true);
  });
});

describe('the Look zone', () => {
  it('names the default and offers Customise, with no way back to offer', () => {
    render(<FogBody />);
    expect(screen.getByTestId('fog-look-name').textContent).toBe('Default clouds');
    expect(screen.getByText('Unchanged')).toBeTruthy();
    expect(screen.queryByTestId('fog-look-default')).toBeNull();
    expect(screen.getByTestId('fog-look-customise')).toBeTruthy();
  });

  it('calls a changed look your mix, says what changed, and goes back to default', () => {
    useSessionStore.setState({ session: session({ base: '#5f6d64', wind: 6.5 }) });
    render(<FogBody />);
    expect(screen.getByTestId('fog-look-name').textContent).toBe('Your mix');
    expect(screen.getByText('Colour and wind changed')).toBeTruthy();
    fireEvent.click(screen.getByTestId('fog-look-default'));
    expect(sent.at(-1)).toMatchObject({ action: 'set-fog-look', payload: { look: null } });
  });

  it('words what changed in reading order', () => {
    const look = { ...DEFAULT_FOG_LOOK, base: '#000000', fade: 3, layers: [...DEFAULT_FOG_LOOK.layers] as typeof DEFAULT_FOG_LOOK.layers };
    expect(changedCaption(changedFields(look, DEFAULT_FOG_LOOK))).toBe('Colour and edge softness changed');
    expect(changedCaption(changedFields({ ...look, glow: 0 }, DEFAULT_FOG_LOOK))).toBe('Colour, edge softness and torch glow changed');
    expect(changedCaption([])).toBe('Unchanged');
  });
});
