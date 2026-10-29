import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import type { AssetChild, DungeonLayer } from '@/store/types';
import { PropBrowser, PropBrowserHead } from './PropBrowser';

vi.mock('@/components/shared/PackThumbnailCanvas', () => ({
  PackThumbnailCanvas: ({ textureId }: { textureId: string }) => <i data-testid={`thumb-${textureId}`} />,
}));

const ENTRIES = [
  { id: 'p:barrel_1', material: 'barrel_1', family: 'barrel', set: 'demo-storage', gridSize: '2x2', tags: ['storage'] },
  { id: 'p:barrel_2', material: 'barrel_2', family: 'barrel', set: 'demo-storage', gridSize: '2x2', tags: ['storage'] },
  { id: 'p:barrel_3', material: 'barrel_3', family: 'barrel', set: 'demo-storage', gridSize: '2x2', tags: ['storage'] },
  { id: 'p:crate_1', material: 'crate_1', set: 'demo-storage', gridSize: '1x1', tags: ['storage'] },
  { id: 'p:rubble_small', material: 'rubble_small', set: 'demo-clutter', gridSize: '1x1', tags: ['clutter'] },
  { id: 'p:anvil', material: 'anvil', set: 'demo-gear', gridSize: '1x1', tags: ['gear'] },
].map((e) => ({ ...e, packId: 'p', type: 'object', label: e.material.replace(/_/g, ' '), naturalWidth: 200, naturalHeight: 200 }));

vi.mock('@dnd/core/src/assets/packCatalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd/core/src/assets/packCatalog')>();
  const byId = (id: string) => ENTRIES.find((e) => e.id === id);
  return {
    ...actual,
    propEntries: () => ENTRIES,
    getCatalogEntry: byId,
    familyMembers: (id: string) => {
      const e = byId(id);
      return e?.family ? ENTRIES.filter((x) => x.family === e.family) : e ? [e] : [];
    },
  };
});

const swaps: unknown[][] = [];
vi.mock('@dnd/core/src/store/propEdits', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd/core/src/store/propEdits')>();
  return {
    ...actual,
    createSwapPropCommand: (...args: unknown[]) => {
      swaps.push(args);
      return { label: 'Swap', execute: () => {}, undo: () => {} };
    },
  };
});

function dungeon(): DungeonLayer {
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon');
  if (!l) throw new Error('no dungeon layer');
  return l;
}

function placed(id: string, assetId: string): AssetChild {
  return {
    id,
    name: id,
    childType: 'asset',
    visible: true,
    objectType: 'asset',
    assetId,
    position: { x: 1, y: 1 },
    rotation: 0,
    scale: 1,
    width: 1,
    height: 1,
    tint: '#ffffff',
    flipX: false,
    flipY: false,
  };
}

const brush = () => useStore.getState().tools.settings.scatterBrush;
const tileNamed = (name: RegExp) => screen.getByRole('button', { name });

beforeEach(() => {
  swaps.length = 0;
  undoManager.clear();
  useStore.getState().resetToDefault();
  useStore.setState((s) => {
    s.assets.favourites = [];
    s.assets.recentlyUsed = [];
  });
});

afterEach(cleanup);

describe('PropBrowser', () => {
  it('counts every prop in the header and lists the categories with their counts, biggest first', () => {
    render(
      <>
        <PropBrowserHead onClose={vi.fn()} />
        <PropBrowser />
      </>,
    );
    expect(screen.getByRole('heading').textContent).toBe('Props 6');
    const cats = within(screen.getByRole('list', { name: 'Categories' })).getAllByRole('button');
    expect(cats.map((c) => c.textContent)).toEqual(['All6', 'Storage4', 'Clutter1', 'Gear1']);
  });

  it('folds a family into one tile with ×N that opens its members, and a member click stamps it', () => {
    render(<PropBrowser />);
    expect(screen.getAllByTestId('v2-prop-tile')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: /^Open barrel family, 3 variants/ }));
    const band = screen.getByTestId('v2-prop-family');
    expect(within(band).getByText('barrel · 3 variants, 2x2')).toBeTruthy();
    fireEvent.click(within(band).getByRole('button', { name: 'barrel 2' }));
    expect(brush().assetIds).toEqual(['p:barrel_2']);
    expect(brush().stampMode).toBe(true);
  });

  it('a category narrows the grid; typing searches everything, best first', () => {
    render(<PropBrowser />);
    fireEvent.click(screen.getByRole('button', { name: /^Gear/ }));
    expect(screen.getAllByTestId('v2-prop-tile')).toHaveLength(1);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search props' }), { target: { value: 'barel' } });
    expect(screen.getByText(/1 family matches “barel”/)).toBeTruthy();
    expect(tileNamed(/^barrel, 3 in family/)).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search props' }), { target: { value: 'zzz' } });
    expect(screen.getByText('No props match “zzz”.')).toBeTruthy();
  });

  it('stars a prop, which then shows under Favourites', () => {
    render(<PropBrowser />);
    const anvil = screen.getAllByTestId('v2-prop-tile').find((t) => t.textContent?.includes('anvil'))!;
    fireEvent.click(within(anvil).getByRole('button', { name: 'Add to favourites' }));
    expect(useStore.getState().assets.favourites).toEqual(['p:anvil']);
    fireEvent.click(screen.getByRole('button', { name: 'Favourites' }));
    expect(screen.getAllByTestId('v2-prop-tile').map((t) => t.textContent)).toEqual(['anvil']);
  });

  it('a star on a family tile keeps the family, shown under Favourites as that tile with its ×N; a member starred inside it is kept alone', () => {
    render(<PropBrowser />);
    const barrel = screen.getAllByTestId('v2-prop-tile').find((t) => t.querySelector('.v2-ptile__nm')?.textContent === 'barrel')!;
    fireEvent.click(within(barrel).getByRole('button', { name: 'Add to favourites' }));
    expect(useStore.getState().assets.favourites).toEqual(['p:demo-storage:barrel']);
    expect(within(barrel).getByRole('button', { name: 'Remove from favourites' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^Open barrel family/ }));
    const band = screen.getByTestId('v2-prop-family');
    const second = within(band).getAllByTestId('v2-prop-tile')[1];
    fireEvent.click(within(second).getByRole('button', { name: 'Add to favourites' }));
    expect(useStore.getState().assets.favourites).toEqual(['p:barrel_2', 'p:demo-storage:barrel']);

    fireEvent.click(screen.getByRole('button', { name: 'Favourites' }));
    const names = screen.getAllByTestId('v2-prop-tile').map((t) => t.querySelector('.v2-ptile__nm')?.textContent);
    expect(names).toEqual(['barrel 2', 'barrel']);
    expect(screen.getByRole('button', { name: /^Open barrel family, 3 variants/ }).textContent).toBe('×3');
  });

  it('says how Favourites work while there are none', () => {
    render(<PropBrowser />);
    fireEvent.click(screen.getByRole('button', { name: 'Favourites' }));
    expect(screen.getByText(/Favourites are kept in this browser/)).toBeTruthy();
  });

  it('counts the props used on this map, most used first, with a used badge', () => {
    const id = dungeon().id;
    useStore.getState().addChild(id, placed('a', 'p:rubble_small'));
    useStore.getState().addChild(id, placed('b', 'p:rubble_small'));
    useStore.getState().addChild(id, placed('c', 'p:anvil'));
    render(<PropBrowser />);
    fireEvent.click(screen.getByRole('button', { name: 'Used on this map (2)' }));
    const tiles = screen.getAllByTestId('v2-prop-tile');
    expect(tiles.map((t) => t.querySelector('.v2-ptile__nm')?.textContent)).toEqual(['rubble small', 'anvil']);
    expect(within(tiles[0]).getByLabelText('Used 2 times on this map')).toBeTruthy();
  });

  it('lists recent props under Recent', () => {
    useStore.setState((s) => {
      s.assets.recentlyUsed = ['p:crate_1', 'p:floor_x'];
    });
    render(<PropBrowser />);
    fireEvent.click(screen.getByRole('button', { name: 'Recent' }));
    expect(screen.getAllByTestId('v2-prop-tile').map((t) => t.querySelector('.v2-ptile__nm')?.textContent)).toEqual(['crate 1']);
  });

  it('in Scatter mode heads the sheet with the pool: a click adds, × removes, Clear empties', () => {
    useStore.getState().setActiveTool('scatterBrush');
    useStore.getState().updateScatterBrushSettings({ stampMode: false, assetIds: ['p:anvil'] });
    render(<PropBrowser />);
    const pool = screen.getByTestId('v2-props-pool');
    expect(within(pool).getByRole('img', { name: 'anvil' })).toBeTruthy();
    fireEvent.click(tileNamed(/^crate 1$/));
    expect(brush().assetIds).toEqual(['p:anvil', 'p:crate_1']);
    fireEvent.click(within(pool).getByRole('button', { name: 'Remove anvil from the pool' }));
    expect(brush().assetIds).toEqual(['p:crate_1']);
    fireEvent.click(within(pool).getByRole('button', { name: 'Clear' }));
    expect(brush().assetIds).toEqual([]);
    expect(screen.getByText('Click adds to the pool. ×N opens the family.')).toBeTruthy();
  });

  it('keeps the pool row the same height empty as full: an empty-state line holds the tiles’ place', () => {
    useStore.getState().setActiveTool('scatterBrush');
    useStore.getState().updateScatterBrushSettings({ stampMode: false, assetIds: [] });
    render(<PropBrowser />);
    const pool = screen.getByTestId('v2-props-pool');
    const empty = pool.querySelector('.v2-pbrowse__pool > .v2-pbrowse__poolempty');
    expect(empty?.textContent).toBe('Click props to add them');
    fireEvent.click(tileNamed(/^anvil$/));
    expect(pool.querySelector('.v2-pbrowse__poolempty')).toBeNull();
    expect(within(pool).getByRole('img', { name: 'anvil' })).toBeTruthy();
  });

  it('has no pool bar while stamping', () => {
    useStore.getState().setActiveTool('scatterBrush');
    useStore.getState().updateScatterBrushSettings({ stampMode: true });
    render(<PropBrowser />);
    expect(screen.queryByTestId('v2-props-pool')).toBeNull();
  });

  it('in replace mode names what it replaces and swaps it in at its own size, then leaves the mode', () => {
    useStore.getState().addChild(dungeon().id, placed('stool', 'p:crate_1'));
    useStore.getState().setPropReplaceIds(['stool']);
    render(<PropBrowser />);
    expect(screen.getByText('Click a prop to replace stool')).toBeTruthy();
    fireEvent.click(tileNamed(/^anvil$/));
    expect(swaps).toEqual([[['stool'], 'p:anvil', 'natural']]);
    expect(useStore.getState().ui.propReplaceIds).toBeNull();
    expect(brush().assetIds).not.toContain('p:anvil');
  });

  it('cancels replace mode', () => {
    useStore.getState().setPropReplaceIds(['x']);
    render(<PropBrowser />);
    fireEvent.click(within(screen.getByTestId('v2-props-replace')).getByRole('button', { name: 'Cancel' }));
    expect(useStore.getState().ui.propReplaceIds).toBeNull();
  });
});
