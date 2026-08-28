import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { PROTOCOL_VERSION, type PlayerInfo, type SessionState } from '@dnd/core/src/shared/protocol';
import type { ScenePrep, TriggerDef } from '@dnd/core/src/shared/prep';
import type { Layer } from '@dnd/core/src/store/types';
import { useStore } from '@dnd/core/src/store/store';
import type { SceneTriggers, TriggersState } from '@dnd/mechanics/triggers';
import { getScenePrep } from '../../session/auth';
import type { WebSocketClient } from '../../session/WebSocketClient';
import { usePanel } from '../../session/panels';
import { useSessionStore } from '../../session/store';
import { TriggerPanel } from './TriggerPanel';

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

const prepOf = (triggers: TriggerDef[], notes: ScenePrep['notes'] = []): ScenePrep => ({ version: 2, triggers, notes });

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
      shape: { kind: 'point', x: 0, y: 0 },
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

/** Waits for the panel's REST fetch (mocked, resolved synchronously) to land. */
const settled = () => screen.findByTestId('trigger-list');

const rows = () => Array.from(screen.getByTestId('trigger-list').children) as HTMLLIElement[];

beforeEach(() => {
  cleanup();
  fetchPrep.mockReset();
  useSessionStore.setState({ session: null, you: null, client: null, lastError: null, token: 'tok' });
  useStore.setState({ layers: [] });
});

describe('the trigger list', () => {
  it('shows each trigger with its condition resolved off the loaded zone, and fires on click', async () => {
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
    render(<TriggerPanel />);
    await settled();

    expect(screen.getByText('Pit trap')).not.toBeNull();
    expect(screen.getByText('Enters region · Barrack Rows')).not.toBeNull();
    expect(screen.getByText('Room revealed · Sealed Vault')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Fire: Pit trap' }));
    expect(sent).toContainEqual(
      expect.objectContaining({ module: 'triggers', action: 'fire', payload: { triggerId: 't1' } }),
    );
  });

  it('drops the zone half of the condition line when the anchor zone is gone', async () => {
    fetchPrep.mockResolvedValue({ prep: prepOf([trigger()]), resolved: [{ id: 't1' }], resolvedNotes: [] });
    useSessionStore.setState({ session: session({}), you: dm });
    render(<TriggerPanel />);
    await settled();
    expect(screen.getByText('Enters region')).not.toBeNull();
  });

  it('disables the switch for a trigger authored off, with the reason as its title', async () => {
    fetchPrep.mockResolvedValue({
      prep: prepOf([trigger({ enabled: false })]),
      resolved: [{ id: 't1' }],
      resolvedNotes: [],
    });
    useSessionStore.setState({ session: session({}), you: dm });
    render(<TriggerPanel />);
    await settled();

    const sw = screen.getByTestId('trigger-enabled-t1');
    expect(sw).toHaveProperty('disabled', true);
    expect(sw.getAttribute('title')).toBe('Off in prep');
    expect(sw.getAttribute('aria-checked')).toBe('false');
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
    render(<TriggerPanel />);
    await settled();

    const sw = screen.getByTestId('trigger-enabled-t1');
    expect(sw).toHaveProperty('disabled', false);
    expect(sw.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw);
    expect(sent).toContainEqual(
      expect.objectContaining({
        action: 'set-enabled',
        payload: { triggerId: 't1', enabled: true },
      }),
    );
  });

  it('reads "Fired" and disables Fire once the scene has fired it this session', async () => {
    fetchPrep.mockResolvedValue({ prep: prepOf([trigger()]), resolved: [{ id: 't1' }], resolvedNotes: [] });
    useSessionStore.setState({
      session: session({
        triggers: { byScene: { 'scene-1': sceneOf({ fired: { t1: 123 } }) } } as TriggersState,
      }),
      you: dm,
    });
    render(<TriggerPanel />);
    await settled();

    const fire = screen.getByRole('button', { name: 'Fire: Pit trap' });
    expect(fire.textContent).toBe('Fired');
    expect(fire).toHaveProperty('disabled', true);
  });

  it('marks an inert trigger with a muted tag carrying the reason', async () => {
    fetchPrep.mockResolvedValue({
      prep: prepOf([trigger()]),
      resolved: [{ id: 't1', inert: 'zone was deleted' }],
      resolvedNotes: [],
    });
    useSessionStore.setState({ session: session({}), you: dm });
    render(<TriggerPanel />);
    await settled();

    const tag = screen.getByText('Inert');
    expect(tag.getAttribute('title')).toBe('zone was deleted');
  });

  it('shows the empty state pointing at the Editor when the scene has no triggers', async () => {
    fetchPrep.mockResolvedValue({ prep: prepOf([]), resolved: [], resolvedNotes: [] });
    useSessionStore.setState({ session: session({}), you: dm });
    render(<TriggerPanel />);
    await screen.findByText('No prep authored for this scene.');
    expect(screen.getByText('Author triggers and notes in the Editor.')).not.toBeNull();
  });
});

describe('the no-scroll ceiling', () => {
  const triggersOf = (n: number): TriggerDef[] =>
    Array.from({ length: n }, (_, i) =>
      trigger({ id: `t${i}`, name: `Trigger ${i}`, when: { kind: 'enter-region', zoneId: `z${i}` } }),
    );

  it('2 triggers: full 40px rows, the condition line visible', async () => {
    fetchPrep.mockResolvedValue({ prep: prepOf(triggersOf(2)), resolved: [], resolvedNotes: [] });
    useSessionStore.setState({ session: session({}), you: dm });
    render(<TriggerPanel />);
    await settled();
    const first = rows()[0]!;
    expect(first.className).toContain('h-10');
    expect(first.getAttribute('title')).toBeNull();
    expect(within(first).getByText('Enters region')).not.toBeNull();
  });

  it('10 triggers: still fits, still 40px rows', async () => {
    fetchPrep.mockResolvedValue({ prep: prepOf(triggersOf(10)), resolved: [], resolvedNotes: [] });
    useSessionStore.setState({ session: session({}), you: dm });
    render(<TriggerPanel />);
    await settled();
    expect(rows()).toHaveLength(10);
    expect(rows()[0]!.className).toContain('h-10');
  });

  it('14 triggers: compacts to 32px rows, condition moves into the row title', async () => {
    fetchPrep.mockResolvedValue({ prep: prepOf(triggersOf(14)), resolved: [], resolvedNotes: [] });
    useSessionStore.setState({ session: session({}), you: dm });
    render(<TriggerPanel />);
    await settled();
    const all = rows();
    expect(all).toHaveLength(14);
    const first = all[0]!;
    expect(first.className).toContain('h-8');
    expect(first.getAttribute('title')).toBe('Enters region');
    expect(within(first).queryByText('Enters region')).toBeNull();

    const body = screen.getByTestId('trigger-list').parentElement as HTMLElement;
    Object.defineProperty(body, 'scrollHeight', { value: 14 * 32, configurable: true });
    Object.defineProperty(body, 'clientHeight', { value: 460, configurable: true });
    expect(body.scrollHeight).toBeLessThanOrEqual(460);
  });
});

describe('the header chrome', () => {
  it('reads the trigger count once loaded, and null on an empty scene', async () => {
    const def = usePanel('triggers')!;
    fetchPrep.mockResolvedValue({
      prep: prepOf([trigger(), trigger({ id: 't2', name: 'Vault whisper' })]),
      resolved: [],
      resolvedNotes: [],
    });
    useSessionStore.setState({ session: session({}), you: dm });
    render(<TriggerPanel />);
    await settled();
    expect(def.subtitle?.()).toBe('2 on this scene');

    cleanup();
    fetchPrep.mockResolvedValue({ prep: prepOf([]), resolved: [], resolvedNotes: [] });
    render(<TriggerPanel />);
    await screen.findByText('No prep authored for this scene.');
    expect(def.subtitle?.()).toBeNull();
  });
});

describe('the notes section (prep v2)', () => {
  const note = (over: Partial<ScenePrep['notes'][number]> = {}): ScenePrep['notes'][number] => ({
    id: 'n1',
    zoneId: 'z1',
    title: 'Kitchens',
    body: 'The cook is a spy.',
    imageKeys: [],
    showOnReveal: false,
    ...over,
  });

  it('lists notes under their own header and expands one to its body', async () => {
    fetchPrep.mockResolvedValue({
      prep: prepOf([trigger()], [note()]),
      resolved: [],
      resolvedNotes: [],
    });
    useStore.setState({ layers: [zoneLayer([{ id: 'z1', name: 'Barrack Rows' }])] });
    useSessionStore.setState({ session: session({}), you: dm });
    render(<TriggerPanel />);
    await settled();

    expect(screen.getByText('Notes')).not.toBeNull();
    const row = screen.getByRole('button', { name: /Kitchens/ });
    expect(screen.queryByText('The cook is a spy.')).toBeNull();
    fireEvent.click(row);
    expect(screen.getByText('The cook is a spy.')).not.toBeNull();
    // The anchor zone's name rides the row, same lookup the condition line uses.
    expect(screen.getByText('Barrack Rows')).not.toBeNull();
  });

  it('badges an on-reveal note, swaps the badge for Inert when the server says it cannot pop', async () => {
    fetchPrep.mockResolvedValue({
      prep: prepOf([], [note({ showOnReveal: true }), note({ id: 'n2', title: 'Vault', showOnReveal: true })]),
      resolved: [],
      resolvedNotes: [{ id: 'n1' }, { id: 'n2', inert: 'zone is not inside a room' }],
    });
    useSessionStore.setState({ session: session({}), you: dm });
    render(<TriggerPanel />);
    await screen.findByTestId('note-list');

    expect(screen.getByText('On reveal')).not.toBeNull();
    const tag = screen.getByText('Inert');
    expect(tag.getAttribute('title')).toBe('zone is not inside a room');
  });

  it('counts notes into the header subtitle alongside triggers', async () => {
    const def = usePanel('triggers')!;
    fetchPrep.mockResolvedValue({
      prep: prepOf([trigger()], [note()]),
      resolved: [],
      resolvedNotes: [],
    });
    useSessionStore.setState({ session: session({}), you: dm });
    render(<TriggerPanel />);
    await settled();
    expect(def.subtitle?.()).toBe('2 on this scene');
  });
});
