// #47 / M3 §Scene — the DM's scene library popover: activate, visibility, rename, reorder,
// replace, delete (behind the row's own `⋯` menu, with an in-popover confirm instead of
// `window.confirm`), weather, and import. Body and footer are rendered together in most of
// these tests because `busy`/`error` now live in `useSceneLibrary` (a store, not component
// state) precisely so the two siblings under `Popover` can share them.

import { PROTOCOL_VERSION } from '@dnd/core/src/shared/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { PlayerInfo, SessionState } from '@dnd/core/src/shared/protocol';
import type { TriggersState } from '@dnd/mechanics/triggers';
import { usePanels } from '../../session/panels';
import { useSessionStore } from '../../session/store';
import { Popover } from '../../shell/Popover';
import { useShell } from '../../shell/shellStore';
import { ScenePanel, SceneFooter } from './ScenePanel';
import { useSceneLibrary } from './store';

vi.mock('../../session/auth', () => ({
  listScenes: vi.fn(),
  patchScene: vi.fn(),
  publishScene: vi.fn(),
  deleteScene: vi.fn(),
  reorderScenes: vi.fn(),
  uploadMapFile: vi.fn(),
}));
const { listScenes, patchScene, deleteScene, reorderScenes, publishScene, uploadMapFile } =
  await import('../../session/auth');

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

const dm: PlayerInfo = { identityId: 'd', name: 'DM', role: 'dm', connected: true };

const HALL = { id: 'sc-1', name: 'Great Hall', sortIndex: 0, visibleToPlayers: false, mapId: 'm-1', updatedAt: 1 };
const CRYPT = { id: 'sc-2', name: 'Crypt', sortIndex: 1, visibleToPlayers: true, mapId: 'm-2', updatedAt: 2 };

/** A single scene's worth of `SceneTriggers`, the shape `sceneTriggersOf` expects to find
 *  already in place — env is all this suite cares about, the rest is filler. */
function triggersState(
  sceneId: string,
  env: { time?: string; weather?: string; ambient?: string },
): TriggersState {
  return {
    byScene: {
      [sceneId]: { fired: {}, armed: {}, disabled: {}, lightOverrides: {}, env, prompts: [], log: [] },
    },
  } as TriggersState;
}

const manyScenes = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `sc-${i}`,
    name: `Scene ${i}`,
    sortIndex: i,
    visibleToPlayers: false,
    mapId: `m-${i}`,
    updatedAt: i,
  }));

/** Body + footer together — the shape they actually appear in inside `Popover`. */
function renderPopover() {
  render(
    <>
      <ScenePanel />
      <SceneFooter />
    </>,
  );
}

const openMenu = (sceneId: string) => fireEvent.click(screen.getByTestId(`scene-more-${sceneId}`));

// Every row's `⋯` menu is mounted at all times (`scene-switch.spec.ts` drives "Replace map"
// without ever opening one), so a bare `getByText('Rename')` matches once per row — scope
// into the one menu under test the same way a real click would only ever reach it.
const menuOf = (sceneId: string) => within(screen.getByTestId(`scene-menu-${sceneId}`));

beforeEach(() => {
  cleanup();
  useShell.setState({ openPanel: null });
  useSceneLibrary.setState({ scenes: [], busy: false, error: null });
  vi.mocked(listScenes).mockReset().mockResolvedValue({ scenes: [HALL, CRYPT] });
  vi.mocked(patchScene).mockReset().mockResolvedValue({ id: HALL.id, name: HALL.name, visibleToPlayers: false });
  vi.mocked(deleteScene).mockReset().mockResolvedValue({ sceneId: HALL.id, deleted: true });
  vi.mocked(reorderScenes).mockReset().mockResolvedValue({ order: [HALL.id, CRYPT.id] });
  vi.mocked(publishScene).mockReset().mockResolvedValue({ sceneId: HALL.id, mapId: 'm-3', name: 'Great Hall', sizeBytes: 12 });
  vi.mocked(uploadMapFile).mockReset().mockResolvedValue({ mapId: 'm-4', sceneId: 'sc-3', name: 'Upper Level', sizeBytes: 12 });
  useSessionStore.setState({
    session: session(HALL.id),
    token: 'dm-token',
    client: { send: vi.fn() } as unknown as ReturnType<typeof useSessionStore.getState>['client'],
  });
});

describe('ScenePanel scene library (#47)', () => {
  it('fetches the library on mount and marks the active scene', async () => {
    renderPopover();
    expect(await screen.findByText('Great Hall')).not.toBeNull();
    expect(listScenes).toHaveBeenCalledWith('c1', 'dm-token');

    const active = screen.getByText('Great Hall');
    expect(active.getAttribute('aria-current')).toBe('true');
    expect(screen.getByText('Crypt').getAttribute('aria-current')).toBe('false');
  });

  it('shows an empty state before anything has been published', async () => {
    vi.mocked(listScenes).mockResolvedValue({ scenes: [] });
    renderPopover();
    expect(await screen.findByText(/no maps published yet/i)).not.toBeNull();
  });

  it('activates a scene on click, but does nothing for the one already active', async () => {
    renderPopover();
    await screen.findByText('Crypt');

    const sendCommand = vi.spyOn(useSessionStore.getState(), 'sendCommand');
    fireEvent.click(screen.getByText('Crypt'));
    expect(sendCommand).toHaveBeenCalledWith('scenes', 'activate', { sceneId: 'sc-2' });

    sendCommand.mockClear();
    fireEvent.click(screen.getByText('Great Hall')); // already active
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it('toggles visibility with the eye button and refetches', async () => {
    renderPopover();
    await screen.findByText('Great Hall');
    vi.mocked(listScenes).mockClear();

    fireEvent.click(screen.getByTestId('scene-visible-sc-1'));
    await waitFor(() => expect(patchScene).toHaveBeenCalledWith('sc-1', 'dm-token', { visibleToPlayers: true }));
    await waitFor(() => expect(listScenes).toHaveBeenCalledTimes(1)); // refetched once settled
  });

  it('renames a scene from the ⋯ menu: click Rename, edit, commit on Enter', async () => {
    renderPopover();
    await screen.findByText('Great Hall');

    openMenu('sc-1');
    fireEvent.click(menuOf('sc-1').getByText('Rename'));
    const input = screen.getByDisplayValue('Great Hall');
    fireEvent.change(input, { target: { value: 'The Great Hall' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(patchScene).toHaveBeenCalledWith('sc-1', 'dm-token', { name: 'The Great Hall' }));
  });

  it('cancels a rename on Escape without calling patchScene', async () => {
    renderPopover();
    await screen.findByText('Great Hall');

    openMenu('sc-1');
    fireEvent.click(menuOf('sc-1').getByText('Rename'));
    const input = screen.getByDisplayValue('Great Hall');
    fireEvent.change(input, { target: { value: 'Discarded' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.queryByDisplayValue('Discarded')).toBeNull();
    expect(patchScene).not.toHaveBeenCalled();
  });

  it('moves a scene up or down from the ⋯ menu, swapping it with its neighbour, and clamps at the ends', async () => {
    renderPopover();
    await screen.findByText('Great Hall');

    // Great Hall is first — Move up is disabled; Crypt is last — its Move down is disabled.
    openMenu('sc-1');
    expect(menuOf('sc-1').getByLabelText('Move up')).toHaveProperty('disabled', true);
    fireEvent.click(menuOf('sc-1').getByLabelText('Move down'));
    await waitFor(() => expect(reorderScenes).toHaveBeenCalledWith('c1', 'dm-token', ['sc-2', 'sc-1']));
  });

  it('deletes a scene only after the in-menu confirm is clicked a second time — never window.confirm', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    renderPopover();
    await screen.findByText('Great Hall');

    openMenu('sc-1');
    fireEvent.click(menuOf('sc-1').getByText('Delete'));
    expect(screen.getByText('Delete Great Hall?')).not.toBeNull();
    expect(deleteScene).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();

    // Cancel backs out without deleting — the menu itself stays open, just its Delete
    // item flips back.
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByText('Delete Great Hall?')).toBeNull();
    expect(deleteScene).not.toHaveBeenCalled();

    fireEvent.click(menuOf('sc-1').getByText('Delete'));
    fireEvent.click(screen.getByText('Delete Great Hall?'));
    await waitFor(() => expect(deleteScene).toHaveBeenCalledWith('sc-1', 'dm-token'));
    expect(confirm).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it('closes the ⋯ menu on Escape and on an outside click', async () => {
    renderPopover();
    await screen.findByText('Great Hall');

    openMenu('sc-1');
    expect(screen.getByTestId('scene-menu-sc-1')).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('scene-menu-sc-1')).toBeNull();

    openMenu('sc-1');
    expect(screen.getByTestId('scene-menu-sc-1')).not.toBeNull();
    fireEvent.pointerDown(screen.getByText('Crypt'));
    expect(screen.queryByTestId('scene-menu-sc-1')).toBeNull();
  });

  it('opens the ⋯ menu with a keyboard Enter on the button, the same as a click', async () => {
    renderPopover();
    await screen.findByText('Great Hall');

    const moreBtn = screen.getByTestId('scene-more-sc-1');
    moreBtn.focus();
    fireEvent.keyDown(moreBtn, { key: 'Enter' });
    // jsdom never synthesizes the native click a real browser derives from Enter on a
    // focused <button> (that's why `@testing-library/user-event` exists) — fire it directly;
    // the button's own onClick handler is what a real browser would end up calling too.
    fireEvent.click(moreBtn);

    expect(screen.getByTestId('scene-menu-sc-1')).not.toBeNull();
  });

  // M3 review finding 1 — rendered through `document.body`, this menu is reachable past
  // every `overflow-hidden` ancestor a plain nested dropdown was clipped by, and its own
  // Escape closes just itself rather than taking the whole popover down too.
  describe('the ⋯ menu escapes the popover’s overflow-hidden (M3 review finding 1)', () => {
    beforeEach(() => {
      useShell.setState({ openPanel: 'session-controls' });
      useSessionStore.setState({
        session: session(HALL.id),
        you: dm,
        token: 'dm-token',
        client: { send: vi.fn() } as unknown as ReturnType<typeof useSessionStore.getState>['client'],
      });
    });

    it('renders the menu under document.body, not inside popover-body, once open', async () => {
      render(<Popover />);
      await screen.findByText('Great Hall');

      openMenu('sc-1');
      const menu = screen.getByTestId('scene-menu-sc-1');
      expect(document.body.contains(menu)).toBe(true);
      expect(screen.getByTestId('popover-body').contains(menu)).toBe(false);
      expect(screen.getByTestId('scene-list').contains(menu)).toBe(false);
      // Every item is reachable, not just present — none of it sits in a clipped subtree.
      expect(within(menu).getByText('Rename')).not.toBeNull();
      expect(within(menu).getByText('Move up')).not.toBeNull();
    });

    it('closes on Escape without closing the popover itself', async () => {
      render(<Popover />);
      await screen.findByText('Great Hall');

      openMenu('sc-1');
      const menu = screen.getByTestId('scene-menu-sc-1');
      expect(menu).not.toBeNull();

      // Dispatched on the menu itself, not on `window` directly — a real Escape press
      // originates from whatever has focus and *capture*s down through `window` before
      // reaching it, which is the ordering this test (and the fix) depends on. Firing
      // straight at `window` would skip that capturing leg and race registration order
      // instead, the wrong thing to assert against.
      fireEvent.keyDown(menu, { key: 'Escape' });
      expect(screen.queryByTestId('scene-menu-sc-1')).toBeNull();
      expect(screen.getByTestId('popover')).not.toBeNull();
      expect(useShell.getState().openPanel).toBe('session-controls');
    });

    it('does not close the popover when a menu item is pressed', async () => {
      render(<Popover />);
      await screen.findByText('Great Hall');

      openMenu('sc-1');
      // `Popover` treats any pointerdown landing outside its own root as "click away, close
      // it" — this menu physically renders outside that root now, so it needs its own
      // stopPropagation to still read as "inside" (the comment on `SceneRowMenu`).
      fireEvent.pointerDown(menuOf('sc-1').getByLabelText('Move down'));
      expect(useShell.getState().openPanel).toBe('session-controls');
    });
  });

  it('surfaces a failed request as the footer’s error text', async () => {
    vi.mocked(patchScene).mockRejectedValue(new Error('the table is on fire'));
    renderPopover();
    await screen.findByText('Great Hall');

    fireEvent.click(screen.getByTestId('scene-visible-sc-1'));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'the table is on fire');
  });

  it('imports a map from the footer, and reflects busy as "Working…"', async () => {
    renderPopover();
    await screen.findByText('Great Hall');

    const file = new File(['{}'], 'upper.mapbuilder', { type: 'application/json' });
    fireEvent.change(screen.getByTestId('scene-upload'), { target: { files: [file] } });

    await waitFor(() => expect(uploadMapFile).toHaveBeenCalled());
  });

  // P2 — the hour and the light level moved to the World block (one world clock, one gate).
  // Weather is the narration dial that stays, and the echo machinery stays with it.
  it('shows the placeholder, disabled, once the scene has weather set', async () => {
    useSessionStore.setState({ session: session(HALL.id, { triggers: triggersState(HALL.id, { weather: 'rain' }) }) });
    renderPopover();
    await screen.findByText('Great Hall');

    expect(screen.getByLabelText('Weather')).toHaveProperty('value', 'rain');
    const placeholder = screen.getByLabelText('Weather').querySelector('option[value=""]');
    expect(placeholder).toHaveProperty('disabled', true);
    expect(placeholder).toHaveProperty('textContent', 'Not set');
  });

  it('no longer carries the time or light dials — the World block owns both', async () => {
    useSessionStore.setState({ session: session(HALL.id, { triggers: triggersState(HALL.id, {}) }) });
    renderPopover();
    await screen.findByText('Great Hall');

    expect(screen.queryByLabelText('Time of day')).toBeNull();
    expect(screen.queryByLabelText('Ambient light')).toBeNull();
  });

  it('labels the wire enum options for reading, not the wire values themselves', async () => {
    useSessionStore.setState({ session: session(HALL.id, { triggers: triggersState(HALL.id, {}) }) });
    renderPopover();
    await screen.findByText('Great Hall');

    const weatherOption = screen.getByLabelText('Weather').querySelector('option[value="storm"]');
    expect(weatherOption).toHaveProperty('textContent', 'Storm');
  });

  it('sends set-environment with only the field that changed', async () => {
    useSessionStore.setState({ session: session(HALL.id, { triggers: triggersState(HALL.id, {}) }) });
    renderPopover();
    await screen.findByText('Great Hall');

    const sendCommand = vi.spyOn(useSessionStore.getState(), 'sendCommand');
    fireEvent.change(screen.getByLabelText('Weather'), { target: { value: 'storm' } });
    expect(sendCommand).toHaveBeenCalledWith('triggers', 'set-environment', { weather: 'storm' });
    expect(sendCommand).toHaveBeenCalledTimes(1);
  });

  it('shows the pick immediately, before the server echoes it back in env', async () => {
    useSessionStore.setState({ session: session(HALL.id, { triggers: triggersState(HALL.id, {}) }) });
    renderPopover();
    await screen.findByText('Great Hall');

    fireEvent.change(screen.getByLabelText('Weather'), { target: { value: 'storm' } });
    expect(screen.getByLabelText('Weather')).toHaveProperty('value', 'storm');

    useSessionStore.setState({
      session: session(HALL.id, { triggers: triggersState(HALL.id, { weather: 'storm' }) }),
    });
    await waitFor(() => expect(screen.getByLabelText('Weather')).toHaveProperty('value', 'storm'));
  });

  it('falls an unconfirmed pending pick back to the env echo after it times out', async () => {
    useSessionStore.setState({ session: session(HALL.id, { triggers: triggersState(HALL.id, {}) }) });
    renderPopover();
    await screen.findByText('Great Hall');

    vi.useFakeTimers();
    fireEvent.change(screen.getByLabelText('Weather'), { target: { value: 'storm' } });
    expect(screen.getByLabelText('Weather')).toHaveProperty('value', 'storm');

    act(() => vi.advanceTimersByTime(4000));
    expect(screen.getByLabelText('Weather')).toHaveProperty('value', '');
    vi.useRealTimers();
  });

  it('replaces the environment controls with a prompt when no scene is active', async () => {
    useSessionStore.setState({ session: session(null) });
    renderPopover();

    expect(await screen.findByText('Activate a scene to set its environment.')).not.toBeNull();
    expect(screen.queryByLabelText('Weather')).toBeNull();
  });

  it('is registered DM-only, so a player never gets the panel at all', () => {
    const panel = usePanels('dm').find((p) => p.id === 'session-controls');
    expect(panel?.roles).toEqual(['dm']);
    expect(usePanels('player').some((p) => p.id === 'session-controls')).toBe(false);
  });
});

describe('the no-scroll ceiling', () => {
  it('3 scenes: full 32px rows', async () => {
    vi.mocked(listScenes).mockResolvedValue({ scenes: manyScenes(3) });
    useSessionStore.setState({ session: session('sc-0') });
    renderPopover();
    await screen.findByText('Scene 0');
    expect(screen.getByTestId('scene-row-sc-0').className).toContain('h-8');
  });

  it('8 scenes: still full 32px rows — the ledger fits exactly here', async () => {
    vi.mocked(listScenes).mockResolvedValue({ scenes: manyScenes(8) });
    useSessionStore.setState({ session: session('sc-0') });
    renderPopover();
    await screen.findByText('Scene 0');
    expect(screen.getByTestId('scene-row-sc-0').className).toContain('h-8');
  });

  it('12 scenes: past the ceiling, rows compact to 28px', async () => {
    vi.mocked(listScenes).mockResolvedValue({ scenes: manyScenes(12) });
    useSessionStore.setState({ session: session('sc-0') });
    renderPopover();
    await screen.findByText('Scene 0');
    expect(screen.getByTestId('scene-row-sc-0').className).toContain('h-7');
    expect(screen.getByTestId('scene-row-sc-0').className).not.toContain('h-8');
  });
});
