import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PROTOCOL_VERSION, type PlayerInfo, type SessionState } from '@dnd/core/src/shared/protocol';
import type { RoomKey, ScenePrep, TriggerDef } from '@dnd/core/src/shared/prep';
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
  version: 3,
  triggers,
  notes,
  rooms: [],
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

describe('room keys (prep v3)', () => {
  const KEY: RoomKey = {
    roomId: 'room-hall',
    readAloud: 'Smoke hangs under a low ceiling.',
    notes: 'The chief hides behind the tapestry.',
    treasure: '40 gp in a cracked urn',
    traps: [{ id: 'trap-1', text: 'Tripwire by the hearth', save: { ability: 'dex', dc: 13 }, damage: '1d6' }],
    checks: [{ id: 'check-1', ability: 'wis', dc: 12, text: 'Spot the loose flagstone' }],
    encounter: { name: 'Hearth guards', monsters: [{ id: 'm1', name: 'Goblin', count: 2 }] },
  };

  const roomLayer = (rooms: ReadonlyArray<{ id: string; name: string; number?: number }>): Layer =>
    ({
      id: 'l-rooms',
      type: 'dungeon',
      children: [],
      standaloneWalls: [],
      rooms: rooms.map((r) => ({ ...r, anchor: [5, 5] })),
    }) as unknown as Layer;

  const withKeys = (rooms: RoomKey[], over: Partial<ScenePrep> = {}): ScenePrep => ({ ...prepOf([]), rooms, ...over });

  const roomsSettled = () => screen.findByTestId('prep-rooms');

  beforeEach(() => {
    useStore.setState({
      layers: [
        roomLayer([
          { id: 'room-hall', name: 'Hall', number: 1 },
          { id: 'room-vault', name: 'Vault', number: 2 },
        ]),
      ],
    });
  });

  it('lists each keyed room by its table label, in number order', async () => {
    fetchPrep.mockResolvedValue({
      prep: withKeys([{ ...KEY, roomId: 'room-vault' }, KEY]),
      resolved: [],
      resolvedNotes: [],
      resolvedRooms: [],
    });
    useSessionStore.setState({ session: session({}), you: dm });
    render(<PrepSidebar />);
    await roomsSettled();

    const cards = screen.getAllByTestId('room-key-card');
    expect(cards.map((c) => c.getAttribute('data-room-id'))).toEqual(['room-hall', 'room-vault']);
    expect(screen.getByText('1 · Hall')).not.toBeNull();
    expect(screen.getByText('2 · Vault')).not.toBeNull();
    // A scene whose only prep is a key is not "no prep".
    expect(screen.queryByText('No prep for this scene.')).toBeNull();
  });

  it('gives each room a mood pill, Inherit until the DM pins one, sent as set-room', async () => {
    fetchPrep.mockResolvedValue({ prep: withKeys([KEY]), resolved: [], resolvedNotes: [], resolvedRooms: [] });
    useSessionStore.setState({ session: session({}), you: dm });
    const sent = captureCommands();
    render(<PrepSidebar />);
    await roomsSettled();

    const pill = screen.getByRole('combobox', { name: 'Mood: 1 · Hall' }) as HTMLSelectElement;
    expect(pill.value).toBe('');
    expect([...pill.options].map((o) => o.textContent)).toEqual(['Inherit', 'Lit', 'Dim', 'Dark']);
    fireEvent.change(pill, { target: { value: 'dark' } });
    expect(sent).toContainEqual(
      expect.objectContaining({
        module: 'triggers',
        action: 'set-room',
        payload: { sceneId: 'scene-1', roomId: 'room-hall', patch: { mood: 'dark' } },
      }),
    );
  });

  it('reads a pinned mood off the scene, and Inherit hands it back (null)', async () => {
    fetchPrep.mockResolvedValue({ prep: withKeys([KEY]), resolved: [], resolvedNotes: [], resolvedRooms: [] });
    useSessionStore.setState({
      session: session({ triggers: { byScene: { 'scene-1': sceneOf({ roomEdits: { 'room-hall': { mood: 'dim' } } }) } } as TriggersState }),
      you: dm,
    });
    const sent = captureCommands();
    render(<PrepSidebar />);
    await roomsSettled();

    const pill = screen.getByRole('combobox', { name: 'Mood: 1 · Hall' }) as HTMLSelectElement;
    expect(pill.value).toBe('dim');
    expect(pill.className).toContain('font-medium');
    fireEvent.change(pill, { target: { value: '' } });
    expect(sent).toContainEqual(
      expect.objectContaining({ action: 'set-room', payload: { sceneId: 'scene-1', roomId: 'room-hall', patch: { mood: null } } }),
    );
  });

  it('shares exactly the read-aloud by room id, and a receipt replaces Share', async () => {
    fetchPrep.mockResolvedValue({ prep: withKeys([KEY]), resolved: [], resolvedNotes: [], resolvedRooms: [] });
    useSessionStore.setState({ session: session({}), you: dm });
    const sent = captureCommands();
    const { rerender } = render(<PrepSidebar />);
    await roomsSettled();

    fireEvent.click(screen.getByRole('button', { name: 'Share read-aloud: 1 · Hall' }));
    expect(sent).toContainEqual(
      expect.objectContaining({
        module: 'triggers',
        action: 'share-card',
        payload: { sceneId: 'scene-1', roomId: 'room-hall' },
      }),
    );

    useSessionStore.setState({
      session: session({
        triggers: { byScene: {}, shareReceipts: { 'room:room-hall': { at: Date.now(), journalEntryId: 'j1' } } } as TriggersState,
      }),
      you: dm,
    });
    rerender(<PrepSidebar />);
    expect(screen.queryByRole('button', { name: 'Share read-aloud: 1 · Hall' })).toBeNull();
    expect(screen.getByText('Shared', { exact: false })).not.toBeNull();
  });

  it('expands to the whole key, and Spawn runs the encounter for the room', async () => {
    fetchPrep.mockResolvedValue({ prep: withKeys([KEY]), resolved: [], resolvedNotes: [], resolvedRooms: [] });
    useSessionStore.setState({ session: session({}), you: dm });
    const sent = captureCommands();
    render(<PrepSidebar />);
    await roomsSettled();

    expect(screen.queryByText(KEY.notes)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '1 · Hall' }));
    for (const text of [KEY.readAloud, KEY.notes, KEY.treasure, 'Tripwire by the hearth', 'Spot the loose flagstone']) {
      expect(screen.getByText(text, { exact: false })).not.toBeNull();
    }
    expect(screen.getByText('DEX DC 13 · 1d6', { exact: false })).not.toBeNull();
    expect(screen.getByText('2 × Goblin', { exact: false })).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Spawn encounter: 1 · Hall' }));
    expect(sent).toContainEqual(
      expect.objectContaining({
        module: 'triggers',
        action: 'spawn-encounter',
        payload: { sceneId: 'scene-1', roomId: 'room-hall' },
      }),
    );
  });

  it('offers a second wave once spawned, and refuses an encounter the server marked inert', async () => {
    fetchPrep.mockResolvedValue({
      prep: withKeys([KEY, { ...KEY, roomId: 'room-vault' }]),
      resolved: [],
      resolvedNotes: [],
      resolvedRooms: [{ roomId: 'room-vault', label: '2 · Vault', encounterInert: 'malformed monster HP formula' }],
    });
    useSessionStore.setState({
      session: session({ triggers: { byScene: { 'scene-1': sceneOf({ fired: { 'spawn:room-hall': Date.now() } }) } } as TriggersState }),
      you: dm,
    });
    render(<PrepSidebar />);
    await roomsSettled();
    fireEvent.click(screen.getByRole('button', { name: '1 · Hall' }));
    fireEvent.click(screen.getByRole('button', { name: '2 · Vault' }));

    expect(screen.getByRole('button', { name: 'Spawn encounter: 1 · Hall' }).textContent).toBe('Spawn again');
    const broken = screen.getByRole('button', { name: 'Spawn encounter: 2 · Vault' });
    expect(broken).toHaveProperty('disabled', true);
    expect(broken.getAttribute('title')).toBe('malformed monster HP formula');
  });

  it('flags a key whose room is gone from the map', async () => {
    fetchPrep.mockResolvedValue({
      prep: withKeys([{ ...KEY, roomId: 'room-gone' }]),
      resolved: [],
      resolvedNotes: [],
      resolvedRooms: [{ roomId: 'room-gone', inert: 'room was deleted' }],
    });
    useSessionStore.setState({ session: session({}), you: dm });
    render(<PrepSidebar />);
    await roomsSettled();
    expect(screen.getByText('Inert').getAttribute('title')).toBe('room was deleted');
  });

  it('groups room-anchored triggers and notes under the room, named as the table names it', async () => {
    fetchPrep.mockResolvedValue({
      prep: prepOf(
        [trigger({ id: 't-room', name: 'Hearth flares', when: { kind: 'room-revealed', roomId: 'room-vault' } })],
        [{ id: 'n-room', zoneId: '', roomId: 'room-vault', title: 'Vault lore', body: 'Cold.', imageKeys: [], showOnReveal: true }],
      ),
      resolved: [{ id: 't-room' }],
      resolvedNotes: [],
    });
    useSessionStore.setState({ session: session({}), you: dm });
    render(<PrepSidebar />);
    const groups = await settled();
    expect(groups).toHaveLength(1);
    expect(groups[0].getAttribute('data-zone-id')).toBe('room:room-vault');
    expect(screen.getByText('2 · Vault')).not.toBeNull();
    expect(screen.getByText('Hearth flares')).not.toBeNull();
    expect(screen.getByText('Vault lore')).not.toBeNull();
  });
});
