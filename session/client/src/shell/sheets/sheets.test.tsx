import { beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PlayerInfo } from '@dnd/core/src/shared/protocol';
import { useSessionStore } from '../../session/store';
import { closeSheet, openSheet, openSheetNow, registerSheet, toggleSheet } from './registry';
import { SheetFrame } from './SheetFrame';
import { SheetHost } from './SheetHost';
import '../dock/tabs';
import '../rail/tools';
import './index';

const dm: PlayerInfo = { identityId: 'd', name: 'DM', role: 'dm', connected: true };
const player: PlayerInfo = { identityId: 'p', name: 'Pia', role: 'player', connected: true };

function NoteSheet({ text }: { text: string }) {
  return (
    <SheetFrame title="Note" onClose={closeSheet} testId="note-sheet">
      <p>{text}</p>
    </SheetFrame>
  );
}
registerSheet({ id: 'note', Component: NoteSheet });
registerSheet({ id: 'dm-note', Component: NoteSheet, roles: ['dm'] });

beforeEach(() => {
  cleanup();
  closeSheet();
  useSessionStore.setState({ you: dm });
});

describe('sheets', () => {
  it('renders the open sheet with its props, one at a time', () => {
    render(<SheetHost />);
    act(() => openSheet('note', { text: 'first' }));
    expect(screen.getByText('first')).toBeTruthy();
    act(() => openSheet('note', { text: 'second' }));
    expect(screen.queryByText('first')).toBeNull();
    expect(screen.getByText('second')).toBeTruthy();
  });

  it('closes from the frame and toggles from a button', () => {
    render(<SheetHost />);
    act(() => toggleSheet('note', { text: 'x' }));
    fireEvent.click(screen.getByLabelText('Close Note'));
    expect(openSheetNow()).toBeNull();
    act(() => toggleSheet('note', { text: 'x' }));
    act(() => toggleSheet('note', { text: 'x' }));
    expect(openSheetNow()).toBeNull();
  });

  it('keeps a DM-only sheet from a player', () => {
    useSessionStore.setState({ you: player });
    render(<SheetHost />);
    act(() => openSheet('dm-note', { text: 'secret' }));
    expect(screen.queryByText('secret')).toBeNull();
  });

  it('lists shortcuts from the registries, dock tabs for the DM only', () => {
    const { unmount } = render(<SheetHost />);
    act(() => openSheet('shortcuts'));
    const sheet = screen.getByTestId('shortcuts-sheet');
    expect(sheet.querySelector('[data-key-row="rail:template"]')).toBeTruthy();
    expect(sheet.querySelector('[data-key-row="dock:dice"]')).toBeTruthy();
    expect(sheet.querySelector('[data-key-row="key:shift+r"]')).toBeTruthy();
    expect(sheet.querySelector('[data-key-row="camera:0"]')).toBeTruthy();
    unmount();
    useSessionStore.setState({ you: player });
    render(<SheetHost />);
    const playerSheet = screen.getByTestId('shortcuts-sheet');
    expect(playerSheet.querySelector('[data-key-row="dock:dice"]')).toBeNull();
    expect(playerSheet.querySelector('[data-key-row="rail:template"]')).toBeNull();
    expect(playerSheet.querySelector('[data-key-row="key:f"]')).toBeTruthy();
  });
});
