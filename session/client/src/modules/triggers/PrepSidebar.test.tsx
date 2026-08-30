import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PROTOCOL_VERSION, type PlayerInfo, type SessionState } from '@dnd/core/src/shared/protocol';
import type { ScenePrep, TriggerDef } from '@dnd/core/src/shared/prep';
import type { Layer } from '@dnd/core/src/store/types';
import { useStore } from '@dnd/core/src/store/store';
import type { SceneTriggers, TriggersState } from '@dnd/mechanics/triggers';
import { getScenePrep } from '../../session/auth';
import type { WebSocketClient } from '../../session/WebSocketClient';
import { sidebarForRole } from '../../session/sidebars';
import { useSessionStore } from '../../session/store';
import { useShell } from '../../shell/shellStore';
import { __resetPrepBadgeForTests } from './prepActivity';
import { PrepSidebar } from './PrepSidebar';

vi.mock('../../session/auth', () => ({ getScenePrep: vi.fn() }));
const fetchPrep = vi.mocked(getScenePrep);

const dm: PlayerInfo = { identityId: 'dm-1', name: 'Ayla', role: 'dm', connected: true };

const trigger = (over: Partial<TriggerDef> = {}): TriggerDef => ({
  id: 't1',
  name: 'Pit trap',
  when: { kind: 'enter-region', zoneId: 'z1' },
  actions: [],
  once: true,
  enabled: true,
  ...over,
});

const prepOf = (triggers: TriggerDef[], notes: ScenePrep['notes'] = []): ScenePrep => ({
  version: 2,
  triggers,
  notes,
});

const sceneOf = (over: Partial<SceneTriggers> = {}): SceneTriggers => ({
  fired: {},
  armed: {},
  disabled: {},
  lightOverrides: {},
  lightEdits: {},
  env: {},
  prompts: [],
  log: [],
  ...over,
});

function session(modules: Record<string, unknown> = {}): SessionState {
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionId: 's1',
    campaignId: 'c1',
    activeSceneId: 'scene-1',
    scenes: [{ id: 'scene-1', name: 'Fieldstone Keep', mapId: 'scene-1' }],
    players: [dm],
    modules,
  };
}

const zoneLayer = (zones: ReadonlyArray<{ id: string; name: string }>): Layer =>
  ({
    id: 'l1',
    type: 'dungeon',
    children: zones.map((z) => ({
      id: z.id,
      name: z.name,
      childType: 'zone',
      visible: true,
      shape: { kind: 'point', position: { x: 0, y: 0 } },
    })),
    standaloneWalls: [],
    rooms: [],
  }) as unknown as Layer;

interface Sent {
  module: string;
  action: string;
  payload: unknown;
}
function captureCommands(): Sent[] {
  const sent: Sent[] = [];
  useSessionStore.setState({ client: { send: (msg: Sent) => sent.push(msg) } as unknown as WebSocketClient });
  return sent;
}

/** Waits for the panel's REST fetch (mocked, resolved synchronously) to land — at least one
 *  zone group is rendered (there may be more than one, hence findAllBy over findBy). */
const settled = () => screen.findAllByTestId('prep-zone-group');

const rows = () => screen.getAllByTestId('trigger-row') as HTMLLIElement[];

beforeEach(() => {
  cleanup();
  fetchPrep.mockReset();
  useSessionStore.setState({ session: null, you: null, client: null, lastError: null, token: 'tok' });
  useStore.setState({ layers: [] });
  useShell.setState({ sidebarOpen: false });
  __resetPrepBadgeForTests();
});

describe('zone grouping', () => {
  it('groups a trigger under its zone header with the condition resolved, and fires on click', async () => {
    fetchPrep.mockResolvedValue({
      prep: prepOf([
        trigger({ id: 't1', name: 'Pit trap', when: { kind: 'enter-region', zoneId: 'z1' } }),
        trigger({
          id: 't2',
          name: 'Vault whisper',
          when: { kind: 'room-revealed', zoneId: 'z2' },
          enabled: false,
        }),
      ]),
      resolved: [{ id: 't1' }, { id: 't2' }],
      resolvedNotes: [],
    });
    useStore.setState({
      layers: [
        zoneLayer([
          { id: 'z1', name: 'Barrack Rows' },
          { id: 'z2', name: 'Sealed Vault' },
        ]),
      ],
    });
    useSessionStore.setState({ session: session({}), you: dm });
    const sent = captureCommands();
    render(<PrepSidebar />);
    await settled();

    expect(screen.getByText('Barrack Rows')).not.toBeNull();
    expect(screen.getByText('Sealed Vault')).not.toBeNull();
    expect(screen.getByText('Pit trap')).not.toBeNull();
    expect(screen.getByText('Enters region')).not.toBeNull();
    expect(screen.getByText('Room revealed')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Fire: Pit trap' }));
    expect(sent).toContainEqual(
      expect.objectContaining({ module: 'triggers', action: 'fire', payload: { triggerId: 't1' } }),
    );
  });

  it('groups a trigger whose zone was deleted from the map under its own "Deleted zone" group', async () => {
    fetchPrep.mockResolvedValue({ prep: prepOf([trigger()]), resolved: [{ id: 't1' }], resolvedNotes: [] });
    // The map is loaded and has zones — just not this trigger's. That is a real deletion.
    useStore.setState({ layers: [zoneLayer([{ id: 'z9', name: 'Cistern' }])] });
    useSessionStore.setState({ session: session({}), you: dm });
    render(<PrepSidebar />);
    await settled();
    expect(screen.getByText('Deleted zone')).not.toBeNull();
  });

  it('says nothing at all about a zone while the map is still loading — no "Deleted zone" flash', async () => {
    fetchPrep.mockResolvedValue({ prep: prepOf([trigger()]), resolved: [{ id: 't1' }], resolvedNotes: [] });
    // Prep lands over REST before the map document reaches the editor store: no zones yet.
    useStore.setState({ layers: [] });
    useSessionStore.setState({ session: session({}), you: dm });
    render(<PrepSidebar />);
    await settled();
    expect(screen.queryByText('Deleted zone')).toBeNull();
    expect(screen.getByTestId('zone-name-loading')).not.toBeNull();

    // …and the moment the map arrives, the real name replaces the placeholder.
    useStore.setState({ layers: [zoneLayer([{ id: 'z1', name: 'Barrack Rows' }])] });
    expect(await screen.findByText('Barrack Rows')).not.toBeNull();
    expect(screen.queryByTestId('zone-name-loading')).toBeNull();
  });

  it('shows the empty state pointing at the Editor, and still offers Quick actions', async () => {
    fetchPrep.mockResolvedValue({ prep: prepOf([]), resolved: [], resolvedNotes: [] });
    useSessionStore.setState({ session: session({}), you: dm });
    render(<PrepSidebar />);
    await screen.findByText('No prep for this scene.');
    expect(screen.getByText('Author triggers and notes in the Editor, or send a card on the fly.')).not.toBeNull();
    expect(screen.getByText('Send a card')).not.toBeNull();
  });
});

describe('row state', () => {
  it('disables the switch for a trigger authored off, with the reason as its title', async () => {
    fetchPrep.mockResolvedValue({
      prep: prepOf([trigger({ enabled: false })]),
      resolved: [{ id: 't1' }],
      resolvedNotes: [],
    });
    useSessionStore.setState({ session: session({}), you: dm });
    render(<PrepSidebar />);
    await settled();

    const sw = screen.getByTestId('trigger-enabled-t1');
    expect(sw).toHaveProperty('disabled', true);
    expect(sw.getAttribute('title')).toBe('Off in prep');
  });

  it('lets the DM re-enable a trigger switched off at the table, without touching prep', async () => {
    fetchPrep.mockResolvedValue({ prep: prepOf([trigger()]), resolved: [{ id: 't1' }], resolvedNotes: [] });
    useSessionStore.setState({
      session: session({
        triggers: { byScene: { 'scene-1': sceneOf({ disabled: { t1: true } }) } } as TriggersState,
      }),
      you: dm,
    });
    const sent = captureCommands();
    render(<PrepSidebar />);
    await settled();

    fireEvent.click(screen.getByTestId('trigger-enabled-t1'));
    expect(sent).toContainEqual(
      expect.objectContaining({ action: 'set-enabled', payload: { triggerId: 't1', enabled: true } }),
    );
  });

  it('reads "Fired" with a timestamp and disables Fire once the scene has fired it this session', async () => {
    fetchPrep.mockResolvedValue({ prep: prepOf([trigger()]), resolved: [{ id: 't1' }], resolvedNotes: [] });
    useSessionStore.setState({
      session: session({
        triggers: { byScene: { 'scene-1': sceneOf({ fired: { t1: Date.now() } }) } } as TriggersState,
      }),
      you: dm,
    });
    render(<PrepSidebar />);
    await settled();

    const fire = screen.getByRole('button', { name: 'Fire: Pit trap' });
    expect(fire.textContent).toContain('Fired');
    expect(fire).toHaveProperty('disabled', true);
  });

  it('marks an inert trigger with a tag carrying the reason', async () => {
    fetchPrep.mockResolvedValue({
      prep: prepOf([trigger()]),
      resolved: [{ id: 't1', inert: 'zone was deleted' }],
      resolvedNotes: [],
    });
    useSessionStore.setState({ session: session({}), you: dm });
    render(<PrepSidebar />);
    await settled();

    const tag = screen.getByText('Inert');
    expect(tag.getAttribute('title')).toBe('zone was deleted');
  });

  it('compacts past the no-scroll ceiling: 14 triggers move the condition into the row title', async () => {
    const many = Array.from({ length: 14 }, (_, i) =>
      trigger({ id: `t${i}`, name: `Trigger ${i}`, when: { kind: 'enter-region', zoneId: `z${i}` } }),
    );
    fetchPrep.mockResolvedValue({ prep: prepOf(many), resolved: [], resolvedNotes: [] });
    useSessionStore.setState({ session: session({}), you: dm });
    render(<PrepSidebar />);
    await settled();
    expect(rows()).toHaveLength(14);
    const first = rows()[0]!;
    expect(first.className).toContain('h-8');
    expect(first.getAttribute('title')).toBe('Enters region');
  });
});

describe('notes and sharing', () => {
  const note = (over: Partial<ScenePrep['notes'][number]> = {}): ScenePrep['notes'][number] => ({
    id: 'n1',
    zoneId: 'z1',
    title: 'Kitchens',
    body: 'The cook is a spy.',
    imageKeys: [],
    showOnReveal: false,
    ...over,
  });

  it('lists a note under its zone and expands it to its body', async () => {
    fetchPrep.mockResolvedValue({ prep: prepOf([], [note()]), resolved: [], resolvedNotes: [] });
    useSessionStore.setState({ session: session({}), you: dm });
    render(<PrepSidebar />);
    await settled();

    const row = screen.getByRole('button', { name: /Kitchens/ });
    expect(screen.queryByText('The cook is a spy.')).toBeNull();
    fireEvent.click(row);
    expect(screen.getByText('The cook is a spy.')).not.toBeNull();
  });

  it('shares a note on click, and a receipt replaces the Share button once it lands', async () => {
    fetchPrep.mockResolvedValue({ prep: prepOf([], [note()]), resolved: [], resolvedNotes: [] });
    useSessionStore.setState({ session: session({}), you: dm });
    const sent = captureCommands();
    const { rerender } = render(<PrepSidebar />);
    await settled();

    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(sent).toContainEqual(
      expect.objectContaining({ module: 'triggers', action: 'share-note', payload: { sceneId: 'scene-1', noteId: 'n1' } }),
    );

    const at = Date.now();
    useSessionStore.setState({
      session: session({
        triggers: {
          byScene: {},
          shareReceipts: { n1: { at, journalEntryId: 'j1' } },
        } as TriggersState,
      }),
      you: dm,
    });
    rerender(<PrepSidebar />);
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
    expect(screen.getByText('Shared', { exact: false })).not.toBeNull();
  });
});

describe('quick actions', () => {
  it('opens the card composer and disables Share until both fields are filled', async () => {
    fetchPrep.mockResolvedValue({ prep: prepOf([]), resolved: [], resolvedNotes: [] });
    useSessionStore.setState({ session: session({}), you: dm });
    const sent = captureCommands();
    render(<PrepSidebar />);
    await screen.findByText('No prep for this scene.');

    fireEvent.click(screen.getByText('Send a card'));
    const share = screen.getByRole('button', { name: 'Share' });
    expect(share).toHaveProperty('disabled', true);

    fireEvent.change(screen.getByLabelText('Card title'), { target: { value: 'A warning' } });
    expect(share).toHaveProperty('disabled', true); // body still empty

    fireEvent.change(screen.getByLabelText('Card text'), { target: { value: 'Turn back.' } });
    expect(share).toHaveProperty('disabled', false);

    fireEvent.click(share);
    expect(sent).toContainEqual(
      expect.objectContaining({
        module: 'triggers',
        action: 'share-card',
        payload: { sceneId: 'scene-1', kicker: 'missive', title: 'A warning', body: 'Turn back.' },
      }),
    );
  });

  it('lists this scene\'s encounter triggers as one-click spawns', async () => {
    fetchPrep.mockResolvedValue({
      prep: prepOf([
        trigger({
          id: 't1',
          name: 'Warren Ambush',
          when: { kind: 'enter-region', zoneId: 'z1' },
          actions: [
            { kind: 'encounter', name: 'Warren Ambush', monsters: [], spawn: true, seedInitiative: true },
          ],
        }),
      ]),
      resolved: [],
      resolvedNotes: [],
    });
    useSessionStore.setState({ session: session({}), you: dm });
    const sent = captureCommands();
    render(<PrepSidebar />);
    await settled();

    expect(screen.getByText('Spawn encounter')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Spawn' }));
    expect(sent).toContainEqual(
      expect.objectContaining({ module: 'triggers', action: 'fire', payload: { triggerId: 't1' } }),
    );
  });
});

describe('the activity badge', () => {
  it('counts unseen log entries while closed, and clears once the sidebar opens', async () => {
    fetchPrep.mockResolvedValue({ prep: prepOf([]), resolved: [], resolvedNotes: [] });
    useSessionStore.setState({
      session: session({
        triggers: {
          byScene: {
            'scene-1': sceneOf({
              log: [{ id: 'l1', at: Date.now(), kind: 'show-text', text: 'hi', toPlayers: true }],
            }),
          },
        } as TriggersState,
      }),
      you: dm,
    });
    render(<PrepSidebar />);
    await screen.findByText('No prep for this scene.');

    const def = sidebarForRole('dm')!;
    expect(def.badge?.()).toBeNull(); // seeded silently on first look — history isn't news

    useSessionStore.setState((s) => ({
      session: {
        ...s.session!,
        modules: {
          triggers: {
            byScene: {
              'scene-1': sceneOf({
                log: [
                  { id: 'l1', at: Date.now(), kind: 'show-text', text: 'hi', toPlayers: true },
                  { id: 'l2', at: Date.now(), kind: 'show-text', text: 'new', toPlayers: true },
                ],
              }),
            },
          } as TriggersState,
        },
      },
    }));
    expect(def.badge?.()).toBe(1);

    useShell.setState({ sidebarOpen: true });
    render(<PrepSidebar />);
    expect(def.badge?.()).toBeNull();
  });
});
