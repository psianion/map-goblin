import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PROTOCOL_VERSION, type PlayerInfo, type SessionState } from '@dnd/core/src/shared/protocol';
import type { WebSocketClient } from '../../session/WebSocketClient';
import { useSessionStore } from '../../session/store';
import { useStoryAudience } from './audience';
import { JournalSheet } from './JournalSheet';
import { StoryOverlay } from './StoryOverlay';
import { StoryBody, StoryStrip } from './StoryTab';

vi.mock('../triggers/scenePrep', () => ({
  useScenePrep: () => ({ prep: { rooms: [{ roomId: 'r1', readAloud: 'Webs hang thick.', notes: '', treasure: '', traps: [], checks: [] }] }, inertById: {}, roomVerdicts: {}, error: null }),
  useMapRooms: () => new Map([['r1', { id: 'r1', name: 'Gallery' }]]),
}));

const dm: PlayerInfo = { identityId: 'd', name: 'Dana', role: 'dm', connected: true };
const pia: PlayerInfo = { identityId: 'p1', name: 'Pia', role: 'player', connected: true };

const story = {
  handouts: [{ id: 'h1', caption: 'Letter', text: 'Meet at dusk.' }],
  shown: null as unknown,
  titleCard: null as unknown,
  journal: [{ id: 'j1', sharedAt: 0, kind: 'handout', ref: 'h1' }],
};

function session(s = story): SessionState {
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionId: 's1',
    campaignId: 'c1',
    activeSceneId: 'a',
    scenes: [],
    players: [dm, pia],
    modules: { story: s },
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
  useStoryAudience.setState({ mode: 'all', chosen: [] });
  useSessionStore.setState({ you: dm, session: session() });
});

describe('Story tab', () => {
  it('shows the title card over the map and hides it', () => {
    const sent = capture();
    useSessionStore.setState({ session: session({ ...story, titleCard: { text: 'x', mode: 'over', shownAt: 1 } }) });
    render(<StoryBody />);
    fireEvent.change(screen.getByTestId('story-title'), { target: { value: 'Chapter two' } });
    fireEvent.click(screen.getByTestId('story-title-show'));
    fireEvent.click(screen.getByTestId('story-title-hide'));
    expect(sent).toEqual([
      expect.objectContaining({ module: 'story', action: 'title-show', payload: { text: 'Chapter two', mode: 'over' } }),
      expect.objectContaining({ module: 'story', action: 'title-hide' }),
    ]);
  });

  it('shares the read-aloud of a keyed room', () => {
    const sent = capture();
    render(<StoryBody />);
    fireEvent.click(screen.getByTestId('story-share'));
    expect(sent[0]).toMatchObject({ action: 'share-readaloud', payload: { roomId: 'r1', sceneId: 'a' } });
    expect(screen.getByTestId('story-journal').textContent).toContain('Letter');
  });

  it('shows a handout to chosen players and adds a new one', () => {
    const sent = capture();
    useStoryAudience.setState({ mode: 'chosen', chosen: ['p1'] });
    render(<StoryStrip />);
    fireEvent.click(screen.getByTestId('handout-show'));
    expect(sent[0]).toMatchObject({ action: 'show', payload: { handoutId: 'h1', audience: ['p1'], mode: 'card' } });
    fireEvent.click(screen.getByTestId('handout-add'));
    fireEvent.change(screen.getByLabelText('Handout caption'), { target: { value: 'Map' } });
    fireEvent.change(screen.getByLabelText('Handout text'), { target: { value: 'X marks it' } });
    fireEvent.click(screen.getByText('Add'));
    expect(sent[1]).toMatchObject({ action: 'handout-upsert', payload: { caption: 'Map', text: 'X marks it' } });
  });
});

describe('player side', () => {
  it('puts a shown handout up full screen and hides it for this seat only', () => {
    useSessionStore.setState({ you: pia, session: session({ ...story, shown: { handoutId: 'h1', audience: 'all', mode: 'full' } }) });
    render(<StoryOverlay />);
    expect(screen.getByTestId('story-handout').getAttribute('data-mode')).toBe('full');
    fireEvent.click(screen.getByTestId('story-hide-for-me'));
    expect(screen.queryByTestId('story-handout')).toBeNull();
  });

  it('keeps shown handouts and title cards in the Journal', () => {
    useSessionStore.setState({ you: pia, session: session({ ...story, journal: [...story.journal, { id: 'j2', sharedAt: 1, kind: 'title', ref: 'Night falls' }] }) });
    render(<JournalSheet />);
    expect(screen.getByTestId('journal-handout').textContent).toContain('Letter');
    expect(screen.getByTestId('journal-feed').textContent).toContain('Night falls');
  });
});
