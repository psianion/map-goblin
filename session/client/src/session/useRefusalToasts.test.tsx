// The regression this file exists for: a refused move used to be invisible to the player.
// The server sent `{type:'error'}` and the store recorded it, but the only hooks reading
// `lastError` lived inside TokenPanel and DoorPanel — popovers, which render only while open.
// A player at the table has no panel open (the tokens rail icon is DM-only), so nothing was
// mounted to say the refusal out loud.
//
// So the mount test below deliberately renders *no panel at all* — just the ear and the toast
// host, which is what GameTable gives every seat.

import { beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { DOOR_CLOSED, DOOR_LOCKED, refusal } from '@dnd/mechanics/doors';
import { MOVE_BLOCKED, OUTSIDE_MAP, ROOM_UNEXPLORED } from '@dnd/mechanics/tokens';
import { ToastHost } from '../components/Toast';
import { useToasts } from './toasts';
import { useSessionStore } from './store';
import { refusalToast, useRefusalToasts } from './useRefusalToasts';

const OCCUPY = 'that space cannot be occupied';
const say = (cause: string, subjectId: string | null = null): string =>
  refusal(cause, subjectId, OCCUPY);

const IRON_DOOR = [{ door: { id: 'd-1', name: 'Iron Door' }, live: { open: false } }] as never;

beforeEach(() => {
  cleanup();
  useToasts.setState({ toast: null });
  useSessionStore.setState({ lastError: null });
});

describe('the words a refusal gets', () => {
  it('names the cause the server sent, one sentence each', () => {
    expect(refusalToast(say(OUTSIDE_MAP), [])).toBe('There is no ground there.');
    expect(refusalToast(say(ROOM_UNEXPLORED), [])).toBe('You have not been that way yet.');
    expect(refusalToast(say(MOVE_BLOCKED), [])).toBe('The way there is blocked.');
  });

  it('names the door when a door is what stopped the move', () => {
    expect(refusalToast(say(DOOR_LOCKED, 'd-1'), IRON_DOOR)).toBe('Iron Door is locked.');
    expect(refusalToast(say(DOOR_CLOSED, 'd-1'), IRON_DOOR)).toBe('Iron Door is closed.');
    // A door this seat does not hold still gets an answer, just a nameless one.
    expect(refusalToast(say(DOOR_LOCKED, 'd-9'), [])).toBe('The door is locked.');
  });

  it('says nothing for a refusal that is not the player’s business', () => {
    expect(refusalToast('no such token in that scene', [])).toBeNull();
    expect(refusalToast('x must be a finite number', [])).toBeNull();
  });
});

function Ear() {
  useRefusalToasts();
  return null;
}

describe('the cue a player actually sees', () => {
  it('toasts a refused move with no panel open at all', () => {
    render(
      <>
        <Ear />
        <ToastHost />
      </>,
    );
    expect(screen.queryByRole('status')).toBeNull();

    act(() => {
      useSessionStore.setState({
        lastError: { code: 'invalid-command', message: say(ROOM_UNEXPLORED), at: Date.now() },
      });
    });

    expect(screen.getByText('You have not been that way yet.')).toBeTruthy();
  });

  it('leaves the table alone for a refusal with no words for the player', () => {
    render(
      <>
        <Ear />
        <ToastHost />
      </>,
    );
    act(() => {
      useSessionStore.setState({
        lastError: { code: 'invalid-command', message: 'payload must be an object', at: Date.now() },
      });
    });
    expect(useToasts.getState().toast).toBeNull();
  });
});
