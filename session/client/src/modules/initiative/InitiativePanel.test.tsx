import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { PROTOCOL_VERSION, type PlayerInfo, type SessionState } from '@dnd/core/src/shared/protocol';
import type { InitiativeEntry, InitiativeState } from '@dnd/mechanics/initiative';
import type { Token, TokensState } from '@dnd/mechanics/tokens';
import type { WebSocketClient } from '../../session/WebSocketClient';
import { usePanel } from '../../session/panels';
import { useSessionStore } from '../../session/store';
import { InitiativeFooter, InitiativePanel } from './InitiativePanel';
import { useInitiativeSelection } from './selection';

const dm: PlayerInfo = { identityId: 'dm-1', name: 'Ayla', role: 'dm', connected: true };
const player: PlayerInfo = { identityId: 'p-1', name: 'Willow', role: 'player', connected: true };

const entry = (over: Partial<InitiativeEntry> = {}): InitiativeEntry => ({
  key: 'e1',
  name: 'Marra',
  kind: 'pc',
  initiative: null,
  ...over,
});

const stateOf = (over: Partial<InitiativeState> = {}): InitiativeState => ({
  status: 'gathering',
  sceneId: 'scene-1',
  round: 0,
  turn: 0,
  entries: [],
  log: [],
  ...over,
});

const token = (over: Partial<Token>): Token =>
  ({ id: 't1', name: 'Goblin', ownerId: null, x: 0, y: 0, ...over }) as Token;

const tokensOf = (tokens: Token[]): TokensState =>
  ({ library: {}, byScene: { 'scene-1': Object.fromEntries(tokens.map((t) => [t.id, t])) } }) as TokensState;

function session(modules: Record<string, unknown> = {}, activeSceneId: string | null = 'scene-1'): SessionState {
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionId: 's1',
    campaignId: 'c1',
    activeSceneId,
    scenes: activeSceneId ? [{ id: activeSceneId, name: 'Fieldstone Keep', mapId: activeSceneId }] : [],
    players: [dm, player],
    modules,
  };
}

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

beforeEach(() => {
  cleanup();
  useSessionStore.setState({ session: null, you: null, client: null, lastError: null });
  useInitiativeSelection.setState({ selectedKey: null, picked: {} });
});

describe('idle — the DM candidate checklist', () => {
  it('asks for a scene before it asks for combatants, inside the one panel root', () => {
    useSessionStore.setState({ session: session({}, null), you: dm });
    render(<InitiativePanel />);
    expect(screen.getByText('Activate a scene to start an encounter.')).not.toBeNull();
    expect(screen.getByTestId('initiative-panel')).not.toBeNull();
  });

  it('says there is nothing to fight yet, on an empty scene', () => {
    useSessionStore.setState({ session: session({ tokens: tokensOf([]) }), you: dm });
    render(<InitiativePanel />);
    expect(screen.getByText('No tokens on this scene yet.')).not.toBeNull();
  });

  it('pre-checks the party, leaves NPCs unchecked, and begins with exactly what is checked', () => {
    const tokens = tokensOf([
      token({ id: 't1', name: 'Goblin' }),
      token({ id: 't2', name: 'Marra', ownerId: 'p-1' }),
    ]);
    useSessionStore.setState({ session: session({ tokens }), you: dm });
    const sent = captureCommands();
    render(<InitiativePanel />);
    render(<InitiativeFooter />);

    const marraRow = screen.getByText('Marra').closest('label')!;
    const goblinRow = screen.getByText('Goblin').closest('label')!;
    expect(within(marraRow).getByRole('checkbox')).toHaveProperty('checked', true);
    expect(within(goblinRow).getByRole('checkbox')).toHaveProperty('checked', false);
    expect(screen.getByText('Player')).not.toBeNull();
    expect(screen.getByText('NPC')).not.toBeNull();

    fireEvent.click(within(goblinRow).getByRole('checkbox'));
    fireEvent.click(screen.getByTestId('initiative-begin'));

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      module: 'initiative',
      action: 'start',
      payload: {
        sceneId: 'scene-1',
        entries: [
          { tokenId: 't2', name: 'Marra', kind: 'pc', identityId: 'p-1' },
          { tokenId: 't1', name: 'Goblin', kind: 'npc' },
        ],
      },
    });
  });

  it('tells a player nothing is running, and gives them no controls', () => {
    useSessionStore.setState({ session: session({}), you: player });
    render(<InitiativePanel />);
    render(<InitiativeFooter />);
    expect(screen.getByText('No encounter running.')).not.toBeNull();
    expect(screen.queryByTestId('initiative-begin')).toBeNull();
  });
});

describe('gathering — bookkeeping on the selected row', () => {
  const initiative = stateOf({
    entries: [
      entry({ key: 'a', name: 'Marra', initiative: 8 }),
      entry({ key: 'b', name: 'Goblin', kind: 'npc', initiative: null }),
    ],
  });

  it('is a plain <li> with a dedicated select button — the initiative input never sits inside it (finding 13)', () => {
    useSessionStore.setState({ session: session({ initiative }), you: dm });
    render(<InitiativePanel />);

    const row = screen.getByTestId('initiative-row-a');
    expect(row.tagName).toBe('LI');
    expect(row.getAttribute('role')).toBeNull();

    const selectButton = within(row).getByRole('button');
    expect(selectButton.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(selectButton);
    expect(selectButton.getAttribute('aria-pressed')).toBe('true');

    const input = screen.getByLabelText('Initiative for Marra');
    expect(selectButton.contains(input)).toBe(false);
    expect(row.contains(input)).toBe(true);
  });

  it('opens the bookkeeping line on click, and applies damage on Enter', () => {
    useSessionStore.setState({ session: session({ initiative }), you: dm });
    const sent = captureCommands();
    render(<InitiativePanel />);

    fireEvent.click(within(screen.getByTestId('initiative-row-a')).getByRole('button'));
    const damage = screen.getByTestId('initiative-damage') as HTMLInputElement;
    // No pool yet — the damage field is disabled, "Set max HP" appears instead.
    expect(damage.disabled).toBe(true);
    const maxHp = screen.getByPlaceholderText('Set max HP');
    fireEvent.change(maxHp, { target: { value: '24' } });
    fireEvent.keyDown(maxHp, { key: 'Enter' });
    expect(sent).toContainEqual(
      expect.objectContaining({ module: 'initiative', action: 'hp', payload: { key: 'a', max: 24 } }),
    );
  });

  it('applies a typed damage number, negative included, and lets a chip toggle a condition off', () => {
    const withHp = stateOf({
      entries: [entry({ key: 'a', hp: { current: 20, max: 24 }, conditions: ['prone'] })],
    });
    useSessionStore.setState({ session: session({ initiative: withHp }), you: dm });
    const sent = captureCommands();
    render(<InitiativePanel />);

    fireEvent.click(within(screen.getByTestId('initiative-row-a')).getByRole('button'));
    const damage = screen.getByTestId('initiative-damage');
    fireEvent.change(damage, { target: { value: '5' } });
    fireEvent.keyDown(damage, { key: 'Enter' });
    expect(sent).toContainEqual(
      expect.objectContaining({ action: 'damage', payload: { key: 'a', amount: 5 } }),
    );

    // Two "Prone"s on screen once selected: the row's read-only chip and the bookkeeping
    // line's removable one — only the latter is a button.
    fireEvent.click(screen.getByRole('button', { name: 'Prone' }));
    expect(sent).toContainEqual(
      expect.objectContaining({ action: 'condition', payload: { key: 'a', name: 'prone', on: false } }),
    );
  });

  it('adds a condition from the "+" menu', () => {
    const withHp = stateOf({ entries: [entry({ key: 'a', hp: { current: 24, max: 24 } })] });
    useSessionStore.setState({ session: session({ initiative: withHp }), you: dm });
    const sent = captureCommands();
    render(<InitiativePanel />);

    fireEvent.click(within(screen.getByTestId('initiative-row-a')).getByRole('button'));
    fireEvent.click(screen.getByLabelText('Add a condition'));
    // Inline chips (finding 7), never an absolutely-positioned menu the popover's
    // `overflow-hidden` body could clip.
    const blinded = screen.getByText('Blinded');
    expect(blinded.closest('.absolute')).toBeNull();
    fireEvent.click(blinded);
    expect(sent).toContainEqual(
      expect.objectContaining({ action: 'condition', payload: { key: 'a', name: 'blinded', on: true } }),
    );
  });

  it('edits the initiative number on the selected row', () => {
    useSessionStore.setState({ session: session({ initiative }), you: dm });
    const sent = captureCommands();
    render(<InitiativePanel />);

    fireEvent.click(within(screen.getByTestId('initiative-row-b')).getByRole('button'));
    const input = screen.getByLabelText('Initiative for Goblin');
    fireEvent.change(input, { target: { value: '15' } });
    fireEvent.blur(input);
    expect(sent).toContainEqual(
      expect.objectContaining({ action: 'set', payload: { key: 'b', value: 15 } }),
    );
  });

  it('adds a combatant from the row under the list', () => {
    useSessionStore.setState({ session: session({ initiative }), you: dm });
    const sent = captureCommands();
    render(<InitiativePanel />);

    fireEvent.change(screen.getByLabelText('Add a combatant'), { target: { value: 'Bandit' } });
    fireEvent.click(screen.getByTestId('initiative-add'));
    expect(sent).toContainEqual(
      expect.objectContaining({ action: 'add', payload: { name: 'Bandit', kind: 'npc' } }),
    );
  });

  it('sends "begin" from the footer while gathering', () => {
    useSessionStore.setState({ session: session({ initiative }), you: dm });
    const sent = captureCommands();
    render(<InitiativeFooter />);
    fireEvent.click(screen.getByTestId('initiative-begin'));
    expect(sent).toContainEqual(expect.objectContaining({ module: 'initiative', action: 'begin' }));
  });

  it('offers "Roll initiative" to a player still owed a number, and focuses the prompt', () => {
    const mine = stateOf({ entries: [entry({ key: 'a', identityId: 'p-1', initiative: null })] });
    useSessionStore.setState({ session: session({ initiative: mine }), you: player });
    render(<InitiativeFooter />);

    const promptInput = document.createElement('input');
    const prompt = document.createElement('div');
    prompt.setAttribute('data-testid', 'initiative-prompt');
    prompt.appendChild(promptInput);
    document.body.appendChild(prompt);

    fireEvent.click(screen.getByText('Roll initiative'));
    expect(document.activeElement).toBe(promptInput);
    document.body.removeChild(prompt);
  });
});

describe('running — turn order, redaction and the footer', () => {
  it('marks the current row, and downed reads struck through and muted', () => {
    const running = stateOf({
      status: 'running',
      round: 2,
      turn: 0,
      entries: [
        entry({ key: 'a', name: 'Marra', hp: { current: 12, max: 24 } }),
        entry({ key: 'b', name: 'Goblin', kind: 'npc', hp: { current: 0, max: 7 } }),
      ],
    });
    useSessionStore.setState({ session: session({ initiative: running }), you: dm });
    render(<InitiativePanel />);

    const current = screen.getByTestId('initiative-row-a');
    expect(current.className).toContain('bg-surface-3');
    expect(current.textContent).toContain('▶');
    const down = screen.getByTestId('initiative-row-b');
    expect(down.querySelector('.line-through')).not.toBeNull();
    // The DM always reads the real numbers, downed or not.
    expect(down.textContent).toContain('0/7');
  });

  it('gives a player their own numbers, a bar only for anyone else, and "down" for a redacted NPC', () => {
    const running = stateOf({
      status: 'running',
      entries: [
        entry({ key: 'me', name: 'Willow', identityId: 'p-1', hp: { current: 30, max: 31 } }),
        entry({ key: 'ally', name: 'Karlach', identityId: 'other', hp: { current: 21, max: 24 } }),
        // Alive and redacted — the wire strips the pool entirely, not just the number.
        entry({ key: 'enemy', name: 'Goblin archer', kind: 'npc' }),
        entry({ key: 'downed', name: 'Goblin', kind: 'npc', hp: { current: 0, max: 0 } }),
      ],
    });
    useSessionStore.setState({ session: session({ initiative: running }), you: player });
    render(<InitiativePanel />);

    expect(screen.getByTestId('initiative-row-me').textContent).toContain('30/31');
    expect(screen.getByTestId('initiative-row-me').textContent).toContain('(you)');

    const ally = screen.getByTestId('initiative-row-ally');
    expect(ally.textContent).not.toContain('21/24');
    expect(ally.querySelector('.bg-surface-3.rounded-full')).not.toBeNull();

    const enemy = screen.getByTestId('initiative-row-enemy');
    expect(enemy.querySelector('.bg-surface-3.rounded-full')).toBeNull();
    expect(enemy.textContent).not.toContain('down');

    expect(screen.getByTestId('initiative-row-downed').textContent).toContain('down');
  });

  it('lets the DM end the encounter and advance the turn, with the N hint on the button', () => {
    const running = stateOf({ status: 'running', entries: [entry({ key: 'a' }), entry({ key: 'b' })] });
    useSessionStore.setState({ session: session({ initiative: running }), you: dm });
    const sent = captureCommands();
    render(<InitiativeFooter />);

    expect(screen.getByTestId('initiative-next').textContent).toContain('N');
    fireEvent.click(screen.getByTestId('initiative-next'));
    expect(sent).toContainEqual(expect.objectContaining({ module: 'initiative', action: 'next' }));

    fireEvent.click(screen.getByTestId('initiative-end'));
    expect(sent).toContainEqual(expect.objectContaining({ action: 'end' }));
  });

  it("tells a player it is their turn, or that they're up next", () => {
    const running = stateOf({
      status: 'running',
      turn: 0,
      entries: [entry({ key: 'a', identityId: 'p-1' }), entry({ key: 'b', identityId: 'other' })],
    });
    useSessionStore.setState({ session: session({ initiative: running }), you: player });
    render(<InitiativeFooter />);
    expect(screen.getByText('Your turn.')).not.toBeNull();

    cleanup();
    const next = stateOf({ ...running, turn: 1 });
    useSessionStore.setState({ session: session({ initiative: next }), you: player });
    render(<InitiativeFooter />);
    expect(screen.getByText("You're up next.")).not.toBeNull();
  });
});

describe('the no-scroll ceiling', () => {
  const running = (n: number) =>
    stateOf({
      status: 'running',
      entries: Array.from({ length: n }, (_, i) => entry({ key: `e${i}`, name: `Combatant ${i}` })),
    });

  it('14 rows: full height, one column, 320 wide', () => {
    useSessionStore.setState({ session: session({ initiative: running(14) }), you: dm });
    render(<InitiativePanel />);
    expect(screen.getByTestId('initiative-row-e0').className).toContain('h-9');
    expect(screen.getByTestId('initiative-rows').className).not.toContain('grid-cols-2');
    const def = usePanel('initiative')!;
    expect(typeof def.width === 'function' ? def.width() : def.width).toBe(320);
  });

  it('20 rows: compact rows, still one column, still 320 wide', () => {
    useSessionStore.setState({ session: session({ initiative: running(20) }), you: dm });
    render(<InitiativePanel />);
    expect(screen.getByTestId('initiative-row-e0').className).toContain('h-7');
    expect(screen.getByTestId('initiative-rows').className).not.toContain('grid-cols-2');
    const def = usePanel('initiative')!;
    expect(typeof def.width === 'function' ? def.width() : def.width).toBe(320);
  });

  it('30 rows: compact rows, two columns, widens to 360, caps overflow at 40', () => {
    useSessionStore.setState({ session: session({ initiative: running(30) }), you: dm });
    render(<InitiativePanel />);
    expect(screen.getByTestId('initiative-row-e0').className).toContain('h-7');
    expect(screen.getByTestId('initiative-rows').className).toContain('grid-cols-2');
    const def = usePanel('initiative')!;
    expect(typeof def.width === 'function' ? def.width() : def.width).toBe(360);
    expect(screen.queryByText(/more$/)).toBeNull();
  });

  it('past the hard cap of 40, shows the first 40 and counts the rest', () => {
    useSessionStore.setState({ session: session({ initiative: running(45) }), you: dm });
    render(<InitiativePanel />);
    expect(screen.queryByTestId('initiative-row-e40')).toBeNull();
    expect(screen.getByText('+5 more')).not.toBeNull();
  });
});

describe('the header chrome', () => {
  it('reads round and combatants while running, "Rolling" while gathering, and nothing idle', () => {
    const def = usePanel('initiative')!;
    useSessionStore.setState({ session: session({}) });
    expect(def.subtitle?.()).toBeNull();
    expect(def.badge?.()).toBeNull();

    useSessionStore.setState({
      session: session({ initiative: stateOf({ entries: [entry(), entry({ key: 'e2' })] }) }),
    });
    expect(def.subtitle?.()).toBe('Rolling · 2 combatants');
    expect(def.badge?.()).toBeNull();

    useSessionStore.setState({
      session: session({
        initiative: stateOf({ status: 'running', round: 3, entries: [entry(), entry({ key: 'e2' })] }),
      }),
    });
    expect(def.subtitle?.()).toBe('Round 3 · 2 combatants');
    expect(def.badge?.()).toBe('R3');
  });

  // M3 review finding 13: the round number is DM bookkeeping — a player's rail badge only
  // ever marks their own turn, the same glyph the row itself uses.
  it("badges the round for the DM, but only a player's own turn — never the round — for a player", () => {
    const def = usePanel('initiative')!;
    const running = stateOf({
      status: 'running',
      round: 5,
      turn: 0,
      entries: [entry({ key: 'a', identityId: 'p-1' }), entry({ key: 'b', identityId: 'other' })],
    });

    useSessionStore.setState({ session: session({ initiative: running }), you: dm });
    expect(def.badge?.()).toBe('R5');

    useSessionStore.setState({ session: session({ initiative: running }), you: player });
    expect(def.badge?.()).toBe('▶');

    useSessionStore.setState({
      session: session({ initiative: stateOf({ ...running, turn: 1 }) }),
      you: player,
    });
    expect(def.badge?.()).toBeNull();
  });
});
