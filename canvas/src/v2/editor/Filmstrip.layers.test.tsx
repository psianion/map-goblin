import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within, act } from '@testing-library/react';
import { useStore } from '@/store/store';
import { createDungeonLayer } from '@/store/factories';
import { undoManager } from '@/store/undoManager';
import type { AnyChild, DungeonLayer } from '@/store/types';
import { notify } from '@/lib/toast';
import { canvasKeysAllowed } from '@/shortcuts/keyGuard';
import { Filmstrip } from './Filmstrip';
import { mountDropToLayer, type MoveHooks } from './dropToLayer';

vi.mock('./layerThumbRender', () => ({
  renderLayerThumb: vi.fn(() => undefined),
  disposeLayerThumbRenderer: vi.fn(),
}));
vi.mock('@/lib/toast', () => ({
  notify: { action: vi.fn(), subtle: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= function () {};
});

const crate = (id: string): AnyChild =>
  ({ id, name: id, childType: 'asset', visible: true, assetId: 't:c', position: { x: 1, y: 1 }, rotation: 0, scale: 1, width: 1, height: 1 }) as AnyChild;

/** Two named layers on the default level, Crypt (bottom) and Tower (top), Crypt active. */
function seed() {
  const level = useStore.getState().levels[0].id;
  const a = { ...createDungeonLayer('Crypt', level), children: [crate('c1'), crate('c2')] } as DungeonLayer;
  const b = createDungeonLayer('Tower', level);
  useStore.setState((s) => {
    s.layers = [s.layers[0], a, b];
  });
  useStore.getState().setActiveLayerId(a.id);
  return { a, b };
}

const live = (id: string) => useStore.getState().layers.find((l) => l.id === id) as DungeonLayer;
const tileOf = (name: string) => screen.getByRole('button', { name: `Draw on ${name}` }).closest('[data-testid="v2-film-tile"]') as HTMLElement;
const strip = () => render(<Filmstrip onOpenLayers={() => {}} onOpenLayerSettings={() => {}} />);

describe('Filmstrip tiles as the layer panel', () => {
  beforeEach(() => {
    cleanup();
    useStore.getState().resetToDefault();
    undoManager.clear();
    vi.mocked(notify.warning).mockClear();
  });

  it('names every tile and counts its objects under it', () => {
    seed();
    strip();
    expect(within(tileOf('Crypt')).getByTestId('v2-film-name').textContent).toBe('Crypt');
    expect(within(tileOf('Crypt')).getByTestId('v2-film-count').textContent).toBe('2');
    expect(within(tileOf('Tower')).getByTestId('v2-film-count').textContent).toBe('0');
    expect(within(tileOf('Terrain')).getByTestId('v2-film-name').textContent).toBe('Terrain');
  });

  it('puts the top of the stack rightmost', () => {
    seed();
    strip();
    const names = screen.getAllByTestId('v2-film-name').map((n) => n.textContent);
    expect(names.indexOf('Tower')).toBeGreaterThan(names.indexOf('Crypt'));
  });

  it('marks map layer tiles as drop targets, not Background or Terrain', () => {
    const { a } = seed();
    strip();
    expect(tileOf('Crypt').dataset.layerTile).toBe(a.id);
    expect(tileOf('Terrain').dataset.layerTile).toBeUndefined();
    expect(tileOf('Background').dataset.layerTile).toBeUndefined();
  });

  it('a tile click changes the draw target and keeps the selection', () => {
    const { b } = seed();
    useStore.getState().setSelectedIds(['c1']);
    strip();
    fireEvent.click(screen.getByRole('button', { name: 'Draw on Tower' }));
    expect(useStore.getState().ui.activeLayerId).toBe(b.id);
    expect(useStore.getState().selection.selectedIds).toEqual(['c1']);
  });

  it('offers a lock on every tile and locks in one undo step', () => {
    const { b } = seed();
    strip();
    fireEvent.click(within(tileOf('Tower')).getByRole('button', { name: 'Lock Tower' }));
    expect(live(b.id).locked).toBe(true);
    expect(within(tileOf('Tower')).getByRole('button', { name: 'Unlock Tower' })).toBeTruthy();
    act(() => undoManager.undo());
    expect(live(b.id).locked).toBe(false);
  });

  it('the eye hides a layer and dims its tile', () => {
    const { b } = seed();
    strip();
    fireEvent.click(within(tileOf('Tower')).getByRole('button', { name: 'Hide Tower' }));
    expect(live(b.id).visible).toBe(false);
    expect(tileOf('Tower').className).toContain('v2-tile--hidden');
  });

  it('Alt+click on an eye solos that layer and dims the others', () => {
    const { b } = seed();
    strip();
    fireEvent.click(within(tileOf('Tower')).getByRole('button', { name: 'Hide Tower' }), { altKey: true });
    expect(useStore.getState().ui.solo).toEqual({ layerId: b.id });
    expect(live(b.id).visible).toBe(true);
    expect(tileOf('Crypt').className).toContain('v2-tile--soloout');
    expect(tileOf('Tower').className).not.toContain('v2-tile--soloout');
    expect(within(tileOf('Tower')).getByTestId('v2-film-eye').className).toContain('v2-tile__eye--solo');
  });

  it('a plain eye click while soloing ends the solo first', () => {
    const { b } = seed();
    useStore.getState().toggleSoloLayer(b.id);
    strip();
    fireEvent.click(within(tileOf('Crypt')).getByTestId('v2-film-eye'));
    expect(useStore.getState().ui.solo).toBeNull();
  });

  it('a double-click on the name renames in place; Enter keeps it', () => {
    const { b } = seed();
    strip();
    fireEvent.doubleClick(within(tileOf('Tower')).getByTestId('v2-film-name'));
    const input = screen.getByRole('textbox', { name: 'Layer name' });
    fireEvent.change(input, { target: { value: 'Cave walls' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(live(b.id).name).toBe('Cave walls');
    expect(screen.queryByRole('textbox', { name: 'Layer name' })).toBeNull();
  });

  it('Escape in the name field keeps the old name, and a blank name is refused', () => {
    const { b } = seed();
    strip();
    fireEvent.doubleClick(within(tileOf('Tower')).getByTestId('v2-film-name'));
    let input = screen.getByRole('textbox', { name: 'Layer name' });
    fireEvent.change(input, { target: { value: 'Nope' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(live(b.id).name).toBe('Tower');
    fireEvent.doubleClick(within(tileOf('Tower')).getByTestId('v2-film-name'));
    input = screen.getByRole('textbox', { name: 'Layer name' });
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(live(b.id).name).toBe('Tower');
  });

  it('"+" adds a layer, makes it active and opens its name for typing', () => {
    seed();
    strip();
    fireEvent.click(screen.getByRole('button', { name: 'Add layer' }));
    const s = useStore.getState();
    const added = s.layers.at(-1)!;
    expect(s.ui.activeLayerId).toBe(added.id);
    const input = screen.getByRole('textbox', { name: 'Layer name' }) as HTMLInputElement;
    expect(input.value).toBe(added.name);
    fireEvent.change(input, { target: { value: 'Traps' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(live(added.id).name).toBe('Traps');
  });

  it('right-click opens the tile menu with the layer verbs', () => {
    seed();
    strip();
    fireEvent.contextMenu(tileOf('Tower'), { clientX: 50, clientY: 50 });
    const menu = screen.getByRole('menu');
    for (const label of ['Rename', 'Duplicate', 'Lock', 'Hide', 'Solo', 'Zoom to layer', 'Move to level', 'Delete layer']) {
      expect(within(menu).getByText(label)).toBeTruthy();
    }
  });

  it('the menu refuses to delete the last layer of a level', () => {
    const level = useStore.getState().levels[0].id;
    useStore.setState((s) => {
      s.layers = [s.layers[0], createDungeonLayer('Only', level)];
    });
    strip();
    fireEvent.contextMenu(tileOf('Only'), { clientX: 50, clientY: 50 });
    const del = within(screen.getByRole('menu')).getByText('Delete layer').closest('button') as HTMLButtonElement;
    expect(del.disabled).toBe(true);
  });

  it('Delete on a focused last tile is refused with the level toast', () => {
    const level = useStore.getState().levels[0].id;
    useStore.setState((s) => {
      s.layers = [s.layers[0], createDungeonLayer('Only', level)];
    });
    strip();
    fireEvent.keyDown(tileOf('Only'), { key: 'Delete' });
    expect(notify.warning).toHaveBeenCalledWith('A level needs one layer. Delete the level instead.');
    expect(useStore.getState().layers).toHaveLength(2);
  });

  it('tiles are listbox options with arrow-key roving focus; Enter activates', () => {
    const { b } = seed();
    strip();
    expect(screen.getByRole('listbox')).toBeTruthy();
    const crypt = tileOf('Crypt');
    expect(crypt.getAttribute('role')).toBe('option');
    crypt.focus();
    fireEvent.keyDown(crypt, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tileOf('Tower'));
    fireEvent.keyDown(tileOf('Tower'), { key: 'Enter' });
    expect(useStore.getState().ui.activeLayerId).toBe(b.id);
  });

  it('F2 renames and Space hides the focused tile', () => {
    const { b } = seed();
    strip();
    fireEvent.keyDown(tileOf('Tower'), { key: ' ' });
    expect(live(b.id).visible).toBe(false);
    fireEvent.keyDown(tileOf('Tower'), { key: 'F2' });
    expect(screen.getByRole('textbox', { name: 'Layer name' })).toBeTruthy();
  });

  it('shows the drop ring on the tile a canvas drag is over', () => {
    const { b } = seed();
    useStore.getState().setSelectedIds(['c1']);
    strip();
    const inner = within(tileOf('Tower')).getByRole('button', { name: 'Draw on Tower' });
    document.elementFromPoint = vi.fn(() => inner) as typeof document.elementFromPoint;
    let hover: ((p: { x: number; y: number } | null, ids: string[]) => void) | null = null;
    const tools: MoveHooks = { setMoveReleaseHook: () => {}, setMoveHoverHook: (fn) => (hover = fn) };
    const el = document.createElement('div');
    mountDropToLayer(tools, el);
    act(() => hover!({ x: 1, y: 1 }, ['c1']));
    expect(tileOf('Tower').className).toContain('v2-tile--drop');
    expect(b.id).toBe(tileOf('Tower').dataset.layerTile);
    act(() => hover!(null, ['c1']));
    expect(tileOf('Tower').className).not.toContain('v2-tile--drop');
  });

  it('a hidden lock stays shown once the layer is locked', () => {
    const { b } = seed();
    useStore.getState().updateLayer(b.id, { locked: true });
    strip();
    expect(within(tileOf('Tower')).getByRole('button', { name: 'Unlock Tower' }).className).toContain('v2-tile__lock--on');
  });

  it('the active tile’s name reads in medium weight', () => {
    seed();
    strip();
    expect(tileOf('Crypt').className).toContain('v2-tile--on');
    expect(tileOf('Tower').className).not.toContain('v2-tile--on');
  });

  it('Shift+F10 on a focused tile opens its menu', () => {
    seed();
    strip();
    fireEvent.keyDown(tileOf('Crypt'), { key: 'F10', shiftKey: true });
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('floors the strip at four tiles (every tile when fewer), and the dock CSS keeps that floor', async () => {
    seed();
    const { unmount } = strip();
    expect(screen.getByTestId('v2-filmstrip').style.getPropertyValue('--v2-film-floor')).toBe('2');
    unmount();
    const level = useStore.getState().levels[0].id;
    for (const name of ['Gate', 'Hall', 'Well', 'Vault']) useStore.getState().addLayer(createDungeonLayer(name, level));
    strip();
    expect(screen.getByTestId('v2-filmstrip').style.getPropertyValue('--v2-film-floor')).toBe('4');
    // The floor in the sheets (vitest runs from canvas/): the scroll never goes below it, the
    // strip's own minimum counts it, and the tool row is what scrolls past it.
    const { readFileSync } = await import('node:fs' as string);
    const css = (f: string): string => readFileSync(`src/v2/editor/${f}`, 'utf8');
    expect(css('v2-editor.css')).toMatch(/\.v2-film__scroll \{[^}]*min-width: calc\(var\(--v2-film-floor, 1\) \* 62px - 2px\)/);
    expect(css('v2-editor.css')).toMatch(/\.v2-film \{[^}]*min-width: calc\(\(var\(--v2-film-fixed, 2\) \+ var\(--v2-film-floor, 1\)\) \* 62px/);
    expect(css('rooms.css')).toMatch(/\.v2-film:has\(> \.v2-level\) \{[^}]*var\(--v2-film-floor, 1\)/);
    expect(css('v2-editor.css')).toMatch(/\.v2-dock__section\[role='toolbar'\] \{[^}]*overflow-x: auto/);
  });

  /** The map's own key listener, as the canvas input mounts it: guarded, on the document. */
  function mapKeys(onKey: (e: KeyboardEvent) => void) {
    const listener = (e: KeyboardEvent) => {
      if (canvasKeysAllowed(e)) onKey(e);
    };
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }

  it('Ctrl+Z on a focused tile reaches the map and undoes', () => {
    const { b } = seed();
    strip();
    fireEvent.click(within(tileOf('Tower')).getByRole('button', { name: 'Lock Tower' }));
    expect(live(b.id).locked).toBe(true);
    const stop = mapKeys((e) => {
      if (e.ctrlKey && e.key === 'z') act(() => undoManager.undo());
    });
    try {
      tileOf('Tower').focus();
      fireEvent.keyDown(tileOf('Tower'), { key: 'z', ctrlKey: true });
    } finally {
      stop();
    }
    expect(live(b.id).locked).toBe(false);
  });

  it('Escape on a focused eye button is not consumed: the map sees it', () => {
    seed();
    strip();
    const seen: string[] = [];
    const stop = mapKeys((e) => seen.push(e.key));
    try {
      const eye = within(tileOf('Tower')).getByRole('button', { name: 'Hide Tower' });
      eye.focus();
      fireEvent.keyDown(eye, { key: 'Escape' });
      // The strip's own keys still stop at the strip.
      fireEvent.keyDown(tileOf('Tower'), { key: 'ArrowLeft' });
    } finally {
      stop();
    }
    expect(seen).toEqual(['Escape']);
  });
});
