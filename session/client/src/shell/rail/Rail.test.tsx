import { beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PlayerInfo } from '@dnd/core/src/shared/protocol';
import { useSessionStore } from '../../session/store';
import { useActiveTool } from '../../session/tools';
import { CLEAR_DRAWINGS, CLEAR_TEMPLATES, useMarks, useTemplateShape } from '../marks/marks';
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
    expect(screen.queryByTestId('tool-strip')).toBeNull();
  });
});

describe('the options strip', () => {
  beforeEach(() => {
    useMarks.setState({ marks: [] });
    useTemplateShape.setState({ shape: 'circle' });
  });

  it('names the armed tool and says what a click does, and is gone with Select in hand', () => {
    useSessionStore.setState({ you: player });
    render(<TableRail />);
    expect(screen.queryByTestId('tool-strip')).toBeNull();
    fireEvent.click(screen.getByTestId('rail-measure'));
    expect(screen.getByTestId('tool-strip').textContent).toContain('Measure');
    expect(screen.getByTestId('tool-strip-hint').textContent).toContain('Alt');
    fireEvent.click(screen.getByTestId('rail-ping'));
    // A player has no pull.
    expect(screen.queryByTestId('strip-pull')).toBeNull();
  });

  it('gives the DM the pull, the template shapes and both clear buttons', () => {
    const sent: unknown[] = [];
    const real = useSessionStore.getState().sendMark;
    useSessionStore.setState({ you: dm, sendMark: (m) => sent.push(m) });
    render(<TableRail />);
    fireEvent.click(screen.getByTestId('rail-ping'));
    expect(screen.getByTestId('tool-strip-hint').textContent).toContain('Shift+Alt+click');
    expect(screen.getByTestId('strip-pull')).toBeTruthy();

    fireEvent.click(screen.getByTestId('rail-template'));
    fireEvent.click(screen.getByTestId('template-shape-cone'));
    expect(useTemplateShape.getState().shape).toBe('cone');
    expect(screen.getByTestId('strip-clear-templates').hasAttribute('disabled')).toBe(true);
    act(() => useMarks.getState().put({ id: 't1', by: 'd', sceneId: null, msg: { kind: 'template', shape: 'cone', origin: { x: 0, y: 0 }, size: 3 }, expiresAt: Infinity }));
    fireEvent.click(screen.getByTestId('strip-clear-templates'));
    expect(sent).toEqual([{ kind: 'clear', id: CLEAR_TEMPLATES }]);

    fireEvent.click(screen.getByTestId('rail-draw'));
    act(() => useMarks.getState().put({ id: 'd1', by: 'd', sceneId: null, msg: { kind: 'draw', points: [[0, 0], [1, 1]], ttl: 10_000 }, expiresAt: Date.now() + 10_000 }));
    fireEvent.click(screen.getByTestId('strip-clear-drawings'));
    expect(sent.at(-1)).toEqual({ kind: 'clear', id: CLEAR_DRAWINGS });
    useSessionStore.setState({ sendMark: real });
  });
});
