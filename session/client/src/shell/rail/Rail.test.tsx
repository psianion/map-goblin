import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PlayerInfo } from '@dnd/core/src/shared/protocol';
import { useSessionStore } from '../../session/store';
import { useActiveTool } from '../../session/tools';
import { closeSheet, openSheetNow } from '../sheets/registry';
import { TableRail } from './Rail';
import './tools';

const dm: PlayerInfo = { identityId: 'd', name: 'DM', role: 'dm', connected: true };
const player: PlayerInfo = { identityId: 'p', name: 'Pia', role: 'player', connected: true };

beforeEach(() => {
  cleanup();
  closeSheet();
  useActiveTool.getState().setActiveTool(null);
});

describe('TableRail', () => {
  it('gives the DM all six tools with Select in hand', () => {
    useSessionStore.setState({ you: dm });
    render(<TableRail />);
    for (const id of ['select', 'ping', 'measure', 'template', 'draw', 'pin']) expect(screen.getByTestId(`rail-${id}`)).toBeTruthy();
    expect(screen.getByTestId('rail-select').getAttribute('aria-pressed')).toBe('true');
  });

  it('gives a player Select, Ping and Measure only', () => {
    useSessionStore.setState({ you: player });
    render(<TableRail />);
    expect(screen.getByTestId('rail-measure')).toBeTruthy();
    expect(screen.queryByTestId('rail-template')).toBeNull();
    expect(screen.queryByTestId('rail-pin')).toBeNull();
  });

  it('arms one tool at a time and opens the shortcuts sheet from the foot', () => {
    useSessionStore.setState({ you: dm });
    render(<TableRail />);
    fireEvent.click(screen.getByTestId('rail-ping'));
    expect(useActiveTool.getState().activeTool).toBe('ping');
    fireEvent.click(screen.getByTestId('rail-template'));
    expect(useActiveTool.getState().activeTool).toBe('template');
    expect(screen.getByTestId('rail-template').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('rail-ping').getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByTestId('rail-shortcuts'));
    expect(openSheetNow()?.id).toBe('shortcuts');
  });

  it('shows no rail tool in hand while the fog tool has the pointer', () => {
    useSessionStore.setState({ you: dm });
    useActiveTool.getState().setActiveTool('fog');
    render(<TableRail />);
    expect(screen.getByTestId('rail-select').getAttribute('aria-pressed')).toBe('false');
  });
});
