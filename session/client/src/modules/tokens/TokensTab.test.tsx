import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { closeSheet, openSheetNow } from '../../shell/sheets/registry';
import { TOKEN_DEF_DRAG, useTokenInteraction } from './drag';
import { TokensBody, TokensStrip } from './TokensTab';
import { BRAM, def, seat, sent, token, tokensState } from './playTestSeat';
import { filterLibrary, placedCounts, tokensContext } from './play';

beforeEach(() => {
  useTokenInteraction.setState({ selectedId: null, selectedIds: [], placingDefId: null, placeHidden: false });
  closeSheet();
});
afterEach(cleanup);

const library = [
  def({ id: 'bram', name: 'Bram', kind: 'pc' }),
  def({ id: 'yara', name: 'Yara', kind: 'pc' }),
  def({ id: 'mayor', name: 'Mayor Tolm', kind: 'npc' }),
  def({ id: 'gob', name: 'Goblin', kind: 'monster' }),
];
const onMap = [
  token({ id: 'g1', defId: 'gob', name: 'Goblin 1' }),
  token({ id: 'g2', defId: 'gob', name: 'Goblin 2', hidden: true }),
  token({ id: 'b', defId: 'bram', name: 'Bram', kind: 'pc', ownerId: BRAM.identityId, x: 4.5, y: 4.5 }),
];

describe('Tokens tab body', () => {
  it('Hide all NPCs hides every visible non-PC token, Show all shows the hidden ones', () => {
    const spy = seat({ tokens: tokensState(onMap, library) });
    render(<TokensBody />);
    fireEvent.click(screen.getByTestId('tokens-hide-npcs'));
    expect(sent(spy)).toEqual([['tokens', 'hide', { id: 'g1', hidden: true }]]);
    spy.mockClear();
    fireEvent.click(screen.getByTestId('tokens-show-all'));
    expect(sent(spy)).toEqual([['tokens', 'hide', { id: 'g2', hidden: false }]]);
  });

  it('Gather party sends the PCs to the selected token', () => {
    const spy = seat({ tokens: tokensState(onMap, library) });
    useTokenInteraction.getState().select('g1');
    render(<TokensBody />);
    fireEvent.click(screen.getByTestId('tokens-gather'));
    expect(sent(spy)).toEqual([['tokens', 'gather', { targets: ['b'], x: 1.5, y: 1.5 }]]);
  });

  it('Lock movement toggles the table lock', () => {
    const spy = seat({ tokens: tokensState(onMap, library), table: { paused: false, movementLocked: true } });
    render(<TokensBody />);
    expect(screen.getByTestId('tokens-lock-movement').textContent).toContain('Movement locked');
    fireEvent.click(screen.getByTestId('tokens-lock-movement'));
    expect(sent(spy)).toEqual([['table', 'lock-movement', { on: false }]]);
  });
});

describe('Tokens tab strip', () => {
  it('lists the library with counts placed, and the filter chips narrow it', () => {
    seat({ tokens: tokensState(onMap, library) });
    render(<TokensStrip />);
    const names = () => screen.getAllByTestId('token-tile').map((t) => t.getAttribute('data-def'));
    expect(names()).toEqual(['bram', 'gob', 'mayor', 'yara']);
    const goblin = screen.getAllByTestId('token-tile')[1];
    expect(goblin.querySelector('[data-testid="token-tile-count"]')?.textContent).toBe('2');
    fireEvent.click(screen.getByTestId('tokens-filter-pc'));
    expect(names()).toEqual(['bram', 'yara']);
    fireEvent.change(screen.getByTestId('tokens-search'), { target: { value: 'ya' } });
    expect(names()).toEqual(['yara']);
  });

  it('a tile carries its def for a drop on the map, and a click arms placing (Alt: hidden)', () => {
    seat({ tokens: tokensState(onMap, library) });
    render(<TokensStrip />);
    const tile = screen.getAllByTestId('token-tile')[0];
    const data = new Map<string, string>();
    fireEvent.dragStart(tile, { dataTransfer: { setData: (k: string, v: string) => data.set(k, v), effectAllowed: '' } });
    expect(data.get(TOKEN_DEF_DRAG)).toBe('bram');
    fireEvent.click(tile, { altKey: true });
    expect(useTokenInteraction.getState()).toMatchObject({ placingDefId: 'bram', placeHidden: true });
  });

  it('New token opens the Token type sheet', () => {
    seat({ tokens: tokensState(onMap, library) });
    render(<TokensStrip />);
    fireEvent.click(screen.getByTestId('token-new'));
    expect(openSheetNow()?.id).toBe('token-type');
  });
});

describe('play helpers', () => {
  it('filterLibrary keeps a kind and matches the search; placedCounts counts by def', () => {
    const lib = Object.fromEntries(library.map((d) => [d.id, d]));
    expect(filterLibrary(lib, 'npc', '').map((d) => d.id)).toEqual(['mayor']);
    expect(filterLibrary(lib, 'all', 'gob').map((d) => d.id)).toEqual(['gob']);
    expect(placedCounts(onMap).get('gob')).toBe(2);
  });

  it('tokensContext says how many are on the map and hidden', () => {
    seat({ tokens: tokensState(onMap, library) });
    expect(tokensContext()).toBe('3 on the map, 1 hidden');
  });
});
