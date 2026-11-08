import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { useSessionStore } from '../session/store';
import { showToast, useToasts } from '../session/toasts';
import { BANNER_AFTER_S, ConnectionNotice } from './Connection';
import { DiagnosticsChip } from './DiagnosticsChip';
import { useTableShell } from './tableShell';
import { TableToaster } from './TableToaster';
import { applyUiScale, readUiScale } from './uiScale';
import { ZoomPill } from './ZoomPill';

beforeEach(() => {
  cleanup();
  useSessionStore.setState({ connection: 'open', sessionEnded: false });
});
afterEach(() => vi.useRealTimers());

describe('connection notice', () => {
  it('says nothing while healthy, counts while reconnecting, then shows the banner', () => {
    vi.useFakeTimers();
    render(<ConnectionNotice />);
    expect(screen.queryByTestId('connection-chip')).toBeNull();
    act(() => useSessionStore.setState({ connection: 'reconnecting' }));
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.getByTestId('connection-chip').textContent).toBe('Reconnecting… 4s');
    act(() => vi.advanceTimersByTime(BANNER_AFTER_S * 1000));
    expect(screen.getByTestId('connection-banner').textContent).toContain('Connection lost. Trying again…');
    act(() => useSessionStore.setState({ connection: 'open' }));
    expect(screen.queryByTestId('connection-banner')).toBeNull();
  });

  it('says the session has ended', () => {
    useSessionStore.setState({ sessionEnded: true, connection: 'closed' });
    render(<ConnectionNotice />);
    expect(screen.getByTestId('session-ended')).toBeTruthy();
  });
});

describe('diagnostics', () => {
  it('shows only when switched on', () => {
    useTableShell.setState({ diagnostics: false });
    const { rerender } = render(<DiagnosticsChip />);
    expect(screen.queryByTestId('diagnostics')).toBeNull();
    act(() => useTableShell.setState({ diagnostics: true }));
    rerender(<DiagnosticsChip />);
    expect(screen.getByTestId('diagnostics').textContent).toContain('FPS');
  });
});

describe('toasts', () => {
  it('hands the table toast slot to Sonner and clears it when its time is up', async () => {
    vi.useFakeTimers();
    render(<TableToaster />);
    act(() => {
      showToast({ message: 'That door is locked.', durationMs: 1000 });
    });
    act(() => vi.advanceTimersByTime(1100));
    expect(useToasts.getState().toast).toBeNull();
  });
});

describe('zoom pill and UI scale', () => {
  it('renders the zoom controls', () => {
    render(<ZoomPill />);
    expect(screen.getByTestId('zoom-controls')).toBeTruthy();
  });

  it('scales the root text size and remembers it', () => {
    applyUiScale(115);
    expect(document.documentElement.style.fontSize).toBe('115%');
    expect(readUiScale()).toBe(115);
    applyUiScale(100);
    expect(document.documentElement.style.fontSize).toBe('');
  });
});
