// #47 — the DM's scene library panel: the parts that are actual logic (fetch-on-mount,
// reorder swap math, the confirm-gated delete, republish targeting the right scene) rather
// than markup. The click-to-activate half is unchanged from before #47 and stays covered by
// existing wiring; this file is additive.

import { PROTOCOL_VERSION } from '@dnd/core/src/shared/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SessionState } from '@dnd/core/src/shared/protocol';
import { useSessionStore } from '../session/store';
import { SessionControls } from './SessionControls';

vi.mock('../session/auth', () => ({
  listScenes: vi.fn(),
  patchScene: vi.fn(),
  publishScene: vi.fn(),
  deleteScene: vi.fn(),
  reorderScenes: vi.fn(),
  uploadMapFile: vi.fn(),
}));
const { listScenes, patchScene, deleteScene, reorderScenes, publishScene } =
  await import('../session/auth');

function session(activeSceneId: string | null): SessionState {
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionId: 's1',
    campaignId: 'c1',
    activeSceneId,
    scenes: [],
    players: [],
    modules: {},
  };
}

const HALL = { id: 'sc-1', name: 'Great Hall', sortIndex: 0, visibleToPlayers: false, mapId: 'm-1', updatedAt: 1 };
const CRYPT = { id: 'sc-2', name: 'Crypt', sortIndex: 1, visibleToPlayers: true, mapId: 'm-2', updatedAt: 2 };

beforeEach(() => {
  cleanup();
  vi.mocked(listScenes).mockReset().mockResolvedValue({ scenes: [HALL, CRYPT] });
  vi.mocked(patchScene).mockReset().mockResolvedValue({ id: HALL.id, name: HALL.name, visibleToPlayers: false });
  vi.mocked(deleteScene).mockReset().mockResolvedValue({ sceneId: HALL.id, deleted: true });
  vi.mocked(reorderScenes).mockReset().mockResolvedValue({ order: [HALL.id, CRYPT.id] });
  vi.mocked(publishScene).mockReset().mockResolvedValue({ sceneId: HALL.id, mapId: 'm-3', name: 'Great Hall', sizeBytes: 12 });
  useSessionStore.setState({
    session: session(HALL.id),
    token: 'dm-token',
    client: { send: vi.fn() } as unknown as ReturnType<typeof useSessionStore.getState>['client'],
  });
});

describe('SessionControls scene library (#47)', () => {
  it('fetches the library on mount and marks the active scene', async () => {
    render(<SessionControls />);
    expect(await screen.findByText('Great Hall')).not.toBeNull();
    expect(listScenes).toHaveBeenCalledWith('c1', 'dm-token');

    const active = screen.getByText('Great Hall');
    expect(active.getAttribute('aria-current')).toBe('true');
    expect(screen.getByText('Crypt').getAttribute('aria-current')).toBe('false');
  });

  it('shows an empty state before anything has been published', async () => {
    vi.mocked(listScenes).mockResolvedValue({ scenes: [] });
    render(<SessionControls />);
    expect(await screen.findByText(/no maps published yet/i)).not.toBeNull();
  });

  it('activates a scene on click, but does nothing for the one already active', async () => {
    render(<SessionControls />);
    await screen.findByText('Crypt');

    const sendCommand = vi.spyOn(useSessionStore.getState(), 'sendCommand');
    fireEvent.click(screen.getByText('Crypt'));
    expect(sendCommand).toHaveBeenCalledWith('scenes', 'activate', { sceneId: 'sc-2' });

    sendCommand.mockClear();
    fireEvent.click(screen.getByText('Great Hall')); // already active
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it('toggles visibility with the checkbox and refetches', async () => {
    render(<SessionControls />);
    await screen.findByText('Great Hall');
    vi.mocked(listScenes).mockClear();

    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]!); // Great Hall: false -> true
    await waitFor(() => expect(patchScene).toHaveBeenCalledWith('sc-1', 'dm-token', { visibleToPlayers: true }));
    await waitFor(() => expect(listScenes).toHaveBeenCalledTimes(1)); // refetched once settled
  });

  it('renames a scene: click Rename, edit, commit on Enter', async () => {
    render(<SessionControls />);
    await screen.findByText('Great Hall');

    fireEvent.click(screen.getAllByText('Rename')[0]!);
    const input = screen.getByDisplayValue('Great Hall');
    fireEvent.change(input, { target: { value: 'The Great Hall' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(patchScene).toHaveBeenCalledWith('sc-1', 'dm-token', { name: 'The Great Hall' }));
  });

  it('cancels a rename on Escape without calling patchScene', async () => {
    render(<SessionControls />);
    await screen.findByText('Great Hall');

    fireEvent.click(screen.getAllByText('Rename')[0]!);
    const input = screen.getByDisplayValue('Great Hall');
    fireEvent.change(input, { target: { value: 'Discarded' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.queryByDisplayValue('Discarded')).toBeNull();
    expect(patchScene).not.toHaveBeenCalled();
  });

  it('moves a scene up or down, swapping it with its neighbour, and clamps at the ends', async () => {
    render(<SessionControls />);
    await screen.findByText('Great Hall');

    // Great Hall is first — Move up is disabled, Move down reorders it past Crypt.
    expect(screen.getAllByLabelText('Move up')[0]).toHaveProperty('disabled', true);
    expect(screen.getAllByLabelText('Move down')[1]).toHaveProperty('disabled', true); // Crypt is last

    fireEvent.click(screen.getAllByLabelText('Move down')[0]!);
    await waitFor(() => expect(reorderScenes).toHaveBeenCalledWith('c1', 'dm-token', ['sc-2', 'sc-1']));
  });

  it('deletes a scene only after the confirm dialog is accepted', async () => {
    render(<SessionControls />);
    await screen.findByText('Great Hall');

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    vi.mocked(listScenes).mockClear();
    fireEvent.click(screen.getAllByText('Delete')[0]!);
    // Settles (via the panel's own refetch) before the button is clickable again — a
    // click while `busy` is still true from the declined confirm would silently no-op.
    await waitFor(() => expect(listScenes).toHaveBeenCalledTimes(1));
    expect(deleteScene).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getAllByText('Delete')[0]!);
    await waitFor(() => expect(deleteScene).toHaveBeenCalledWith('sc-1', 'dm-token'));
    confirm.mockRestore();
  });

  it('surfaces a failed request as the panel’s error text', async () => {
    vi.mocked(patchScene).mockRejectedValue(new Error('the table is on fire'));
    render(<SessionControls />);
    await screen.findByText('Great Hall');

    fireEvent.click(screen.getAllByRole('checkbox')[0]!);
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'the table is on fire');
  });
});
