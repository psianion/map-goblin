// #47 — the DM's scene library panel: the parts that are actual logic (fetch-on-mount,
// reorder swap math, the confirm-gated delete, republish targeting the right scene) rather
// than markup. The click-to-activate half is unchanged from before #47 and stays covered by
// existing wiring; this file is additive.

import { PROTOCOL_VERSION } from '@dnd/core/src/shared/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SessionState } from '@dnd/core/src/shared/protocol';
import type { TriggersState } from '@dnd/mechanics/triggers';
import { useSessionStore } from '../session/store';
import { usePanels } from '../session/panels';
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

function session(activeSceneId: string | null, modules: SessionState['modules'] = {}): SessionState {
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionId: 's1',
    campaignId: 'c1',
    activeSceneId,
    scenes: [],
    players: [],
    modules,
  };
}

const HALL = { id: 'sc-1', name: 'Great Hall', sortIndex: 0, visibleToPlayers: false, mapId: 'm-1', updatedAt: 1 };
const CRYPT = { id: 'sc-2', name: 'Crypt', sortIndex: 1, visibleToPlayers: true, mapId: 'm-2', updatedAt: 2 };

/** A single scene's worth of `SceneTriggers`, the shape `sceneTriggersOf` expects to find
 *  already in place — env is all this suite cares about, the rest is filler. */
function triggersState(sceneId: string, env: { time?: string; weather?: string }): TriggersState {
  return {
    byScene: {
      [sceneId]: { fired: {}, armed: {}, disabled: {}, lightOverrides: {}, env, prompts: [], log: [] },
    },
  } as TriggersState;
}

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

  it('shows the placeholder, disabled, once the scene has an environment set', async () => {
    useSessionStore.setState({ session: session(HALL.id, { triggers: triggersState(HALL.id, { time: 'dusk' }) }) });
    render(<SessionControls />);
    await screen.findByText('Great Hall');

    expect(screen.getByLabelText('Time of day')).toHaveProperty('value', 'dusk');
    const timePlaceholder = screen.getByLabelText('Time of day').querySelector('option[value=""]');
    expect(timePlaceholder).toHaveProperty('disabled', true);
    expect(timePlaceholder).toHaveProperty('textContent', 'Not set');

    // Weather is still unset on this scene — its own placeholder stays selected and open.
    expect(screen.getByLabelText('Weather')).toHaveProperty('value', '');
    const weatherPlaceholder = screen.getByLabelText('Weather').querySelector('option[value=""]');
    expect(weatherPlaceholder).toHaveProperty('disabled', false);
    expect(weatherPlaceholder).toHaveProperty('textContent', 'Not set');
  });

  it('labels the wire enum options for reading, not the wire values themselves', async () => {
    useSessionStore.setState({ session: session(HALL.id, { triggers: triggersState(HALL.id, {}) }) });
    render(<SessionControls />);
    await screen.findByText('Great Hall');

    const timeOption = screen.getByLabelText('Time of day').querySelector('option[value="dusk"]');
    expect(timeOption).toHaveProperty('textContent', 'Dusk');
    const weatherOption = screen.getByLabelText('Weather').querySelector('option[value="storm"]');
    expect(weatherOption).toHaveProperty('textContent', 'Storm');
  });

  it('sends set-environment with only the field that changed', async () => {
    useSessionStore.setState({ session: session(HALL.id, { triggers: triggersState(HALL.id, {}) }) });
    render(<SessionControls />);
    await screen.findByText('Great Hall');

    const sendCommand = vi.spyOn(useSessionStore.getState(), 'sendCommand');
    fireEvent.change(screen.getByLabelText('Time of day'), { target: { value: 'night' } });
    expect(sendCommand).toHaveBeenCalledWith('triggers', 'set-environment', { time: 'night' });

    sendCommand.mockClear();
    fireEvent.change(screen.getByLabelText('Weather'), { target: { value: 'storm' } });
    expect(sendCommand).toHaveBeenCalledWith('triggers', 'set-environment', { weather: 'storm' });
    expect(sendCommand).toHaveBeenCalledTimes(1);
  });

  it('shows the pick immediately, before the server echoes it back in env', async () => {
    useSessionStore.setState({ session: session(HALL.id, { triggers: triggersState(HALL.id, {}) }) });
    render(<SessionControls />);
    await screen.findByText('Great Hall');

    fireEvent.change(screen.getByLabelText('Time of day'), { target: { value: 'night' } });
    // Nothing echoed `env` yet — the select still reads the optimistic pick, not the blank.
    expect(screen.getByLabelText('Time of day')).toHaveProperty('value', 'night');

    // The server catches up: env now carries what was picked, and the pending echo clears
    // (a no-op for what's on screen, but stale pending state doesn't leak into a re-pick).
    useSessionStore.setState({
      session: session(HALL.id, { triggers: triggersState(HALL.id, { time: 'night' }) }),
    });
    await waitFor(() => expect(screen.getByLabelText('Time of day')).toHaveProperty('value', 'night'));
  });

  it('falls an unconfirmed pending pick back to the env echo after it times out', async () => {
    useSessionStore.setState({ session: session(HALL.id, { triggers: triggersState(HALL.id, {}) }) });
    render(<SessionControls />);
    await screen.findByText('Great Hall');

    vi.useFakeTimers();
    fireEvent.change(screen.getByLabelText('Time of day'), { target: { value: 'night' } });
    expect(screen.getByLabelText('Time of day')).toHaveProperty('value', 'night');

    // The module state never confirms it (dropped command, disconnect) — after ~4s the
    // field falls back to the env echo rather than showing the untaken pick forever.
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.getByLabelText('Time of day')).toHaveProperty('value', '');

    vi.useRealTimers();
  });

  it('replaces the environment controls with a prompt when no scene is active', async () => {
    useSessionStore.setState({ session: session(null) });
    render(<SessionControls />);

    expect(await screen.findByText('Activate a scene to set its environment.')).not.toBeNull();
    expect(screen.queryByLabelText('Time of day')).toBeNull();
    expect(screen.queryByLabelText('Weather')).toBeNull();
  });

  it('is registered DM-only, so a player never gets the panel at all', () => {
    const panel = usePanels('dm').find((p) => p.id === 'session-controls');
    expect(panel?.roles).toEqual(['dm']);
    expect(usePanels('player').some((p) => p.id === 'session-controls')).toBe(false);
  });
});
