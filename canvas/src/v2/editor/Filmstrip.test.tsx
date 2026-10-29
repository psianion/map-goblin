import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { useStore } from '@/store/store';
import { createDungeonLayer } from '@/store/factories';
import { undoManager } from '@/store/undoManager';
import { TERRAIN_PANEL_ID } from '@/store/types';
import { Filmstrip } from './Filmstrip';
import { clearThumbs } from './layerThumbs';
import { renderLayerThumb } from './layerThumbRender';

// The Pixi painter stands in for the live canvas; by default there is no canvas to paint from.
vi.mock('./layerThumbRender', () => ({
  renderLayerThumb: vi.fn(() => undefined),
  disposeLayerThumbRenderer: vi.fn(),
}));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= function () {};
});

function seed() {
  const a = createDungeonLayer('Crypt');
  const b = createDungeonLayer('Tower');
  useStore.setState({ layers: [a, b] });
  useStore.getState().setActiveLayerId(a.id);
  return { a, b };
}

describe('Filmstrip layer settings', () => {
  beforeEach(() => {
    cleanup();
    useStore.getState().resetToDefault();
    undoManager.clear();
  });

  it('puts the settings glyph on the active tile only, and it asks for that layer', () => {
    const { a } = seed();
    const open = vi.fn();
    render(<Filmstrip onOpenLayers={() => {}} onOpenLayerSettings={open} />);
    const glyphs = screen.getAllByRole('button', { name: 'Layer settings' });
    expect(glyphs).toHaveLength(1);
    const tile = glyphs[0].closest('[data-testid="v2-film-tile"]') as HTMLElement;
    expect(tile.dataset.active).toBe('true');

    fireEvent.click(glyphs[0]);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(a.id);
  });

  it('asks for the tile that was double-clicked', () => {
    const { b } = seed();
    const open = vi.fn();
    render(<Filmstrip onOpenLayers={() => {}} onOpenLayerSettings={open} />);
    fireEvent.click(screen.getByRole('button', { name: 'Draw on Tower' }));
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Draw on Tower' }));
    expect(open).toHaveBeenLastCalledWith(b.id);
    expect(useStore.getState().ui.activeLayerId).toBe(b.id);
  });

  it('asks for the terrain pseudo-layer from the terrain tile', () => {
    seed();
    const open = vi.fn();
    render(<Filmstrip onOpenLayers={() => {}} onOpenLayerSettings={open} />);
    fireEvent.click(screen.getByRole('button', { name: 'Draw on Terrain' }));
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Draw on Terrain' }));
    expect(open).toHaveBeenLastCalledWith(TERRAIN_PANEL_ID);
    expect(useStore.getState().ui.activeLayerId).toBe(TERRAIN_PANEL_ID);
  });

  it('mounts no sheet of its own; the shell owns it', () => {
    seed();
    render(<Filmstrip onOpenLayers={() => {}} onOpenLayerSettings={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Layer settings' }));
    expect(screen.queryByTestId('v2-layer-sheet')).toBeNull();
  });
});

describe('Filmstrip previews', () => {
  beforeEach(() => {
    cleanup();
    useStore.getState().resetToDefault();
    undoManager.clear();
    clearThumbs();
    vi.mocked(renderLayerThumb).mockReset();
  });

  it('shows each layer as the canvas paints it, and keeps the icon on unpainted terrain', async () => {
    const { a, b } = seed();
    vi.mocked(renderLayerThumb).mockImplementation((key: string) =>
      key === a.id || key === b.id ? `data:image/png;base64,${key}` : undefined,
    );
    render(<Filmstrip onOpenLayers={() => {}} onOpenLayerSettings={() => {}} />);

    await waitFor(() => expect(screen.getAllByTestId('v2-film-thumb')).toHaveLength(2));
    const crypt = screen.getByRole('button', { name: 'Draw on Crypt' });
    expect(crypt.querySelector('img')?.getAttribute('src')).toBe(`data:image/png;base64,${a.id}`);
    const tower = screen.getByRole('button', { name: 'Draw on Tower' });
    expect(tower.querySelector('img')?.getAttribute('src')).toBe(`data:image/png;base64,${b.id}`);
    // Nothing painted on the terrain: it keeps its icon and is never asked for.
    const terrain = screen.getByRole('button', { name: 'Draw on Terrain' });
    expect(terrain.querySelector('img')).toBeNull();
    expect(terrain.querySelector('svg')).not.toBeNull();
    expect(vi.mocked(renderLayerThumb).mock.calls.map((c) => c[0])).not.toContain(TERRAIN_PANEL_ID);
  });

  it('keeps the swatch until a picture exists', () => {
    seed();
    render(<Filmstrip onOpenLayers={() => {}} onOpenLayerSettings={() => {}} />);
    expect(screen.queryByTestId('v2-film-thumb')).toBeNull();
    const crypt = screen.getByRole('button', { name: 'Draw on Crypt' });
    expect(crypt.querySelector('.v2-tile__swatch')).not.toBeNull();
  });
});
