import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within, act } from '@testing-library/react';
import { useStore } from '@/store/store';
import { createDungeonLayer } from '@/store/factories';
import { undoManager } from '@/store/undoManager';
import type { BackgroundLayer, DungeonLayer } from '@/store/types';
import { LayerSheet } from './LayerSheet';

vi.mock('@/lib/toast', () => ({
  notify: { action: vi.fn(), subtle: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn(), error: vi.fn() },
}));
// No canvas 2D in jsdom: the texture tiles draw nothing here.
vi.mock('@/components/shared/PackThumbnailCanvas', () => ({ PackThumbnailCanvas: () => null }));
vi.mock('@dnd/core/src/assets/packCatalog', async (orig) => {
  const real = await orig<typeof import('@dnd/core/src/assets/packCatalog')>();
  return {
    ...real,
    getEntriesByType: (type: string) =>
      type === 'floor'
        ? [
            { id: 'pk:flagstone', packId: 'pk', type: 'floor', material: 'stone', gridSize: '1x1', naturalWidth: 200, naturalHeight: 200, label: 'Flagstone', tags: [] },
            { id: 'pk:dirt', packId: 'pk', type: 'floor', material: 'dirt', gridSize: '1x1', naturalWidth: 200, naturalHeight: 200, label: 'Packed dirt', tags: [] },
          ]
        : [],
  };
});

const live = (id: string) => useStore.getState().layers.find((l) => l.id === id)!;

/** Two layers on the one level, the first active. */
function seed() {
  const level = useStore.getState().levels[0].id;
  const a = createDungeonLayer('Props', level);
  const b = createDungeonLayer('Walls', level);
  useStore.setState((s) => {
    s.layers = [s.layers[0], a, b];
  });
  useStore.getState().setActiveLayerId(a.id);
  return { a, b, bg: useStore.getState().layers[0] as BackgroundLayer };
}

const sheet = (target: string) => render(<LayerSheet target={target} onClose={() => {}} />);
const sw = (name: string) => screen.getByRole('switch', { name });

describe('LayerSheet: show rows, actions and the background', () => {
  beforeEach(() => {
    cleanup();
    useStore.getState().resetToDefault();
    undoManager.clear();
  });

  it('shows Labels and Zones beside Floor, Grid and Walls', () => {
    const { a } = seed();
    sheet(a.id);
    for (const name of ['Floor', 'Grid', 'Walls and doors', 'Labels', 'Zones']) expect(sw(name)).toBeTruthy();
    expect(sw('Labels').getAttribute('aria-checked')).toBe('true');
  });

  it('turns the labels row off in one undo step', () => {
    const { a } = seed();
    sheet(a.id);
    fireEvent.click(sw('Labels'));
    expect((live(a.id) as DungeonLayer).sublayerVisibility.labels).toBe(false);
    undoManager.undo();
    expect((live(a.id) as DungeonLayer).sublayerVisibility.labels).not.toBe(false);
  });

  it('turns the zones row off', () => {
    const { a } = seed();
    sheet(a.id);
    fireEvent.click(sw('Zones'));
    expect((live(a.id) as DungeonLayer).sublayerVisibility.zones).toBe(false);
  });

  it('locks and solos from the Layer section', () => {
    const { a } = seed();
    sheet(a.id);
    fireEvent.click(sw('Lock'));
    expect(live(a.id).locked).toBe(true);
    fireEvent.click(sw('Solo'));
    expect(useStore.getState().ui.solo).toEqual({ layerId: a.id });
  });

  it('duplicates the layer above it', () => {
    const { a } = seed();
    sheet(a.id);
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    const ids = useStore.getState().layers.map((l) => l.id);
    expect(useStore.getState().layers[ids.indexOf(a.id) + 1].name).toBe('Props copy');
  });

  it('deletes the layer, and greys Delete on the last layer of a level', () => {
    const { a, b } = seed();
    const { unmount } = sheet(a.id);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(useStore.getState().layers.some((l) => l.id === a.id)).toBe(false);
    unmount();
    sheet(b.id);
    expect((screen.getByRole('button', { name: 'Delete' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('greys Move to level on a one-level map, and moves with two', () => {
    const { a } = seed();
    const { unmount } = sheet(a.id);
    expect((screen.getByRole('button', { name: 'Move to level' }) as HTMLButtonElement).disabled).toBe(true);
    unmount();
    useStore.getState().addLevel({ id: 'lv-2', name: 'Cellar' });
    sheet(a.id);
    fireEvent.click(screen.getByRole('button', { name: 'Move to level' }));
    fireEvent.click(within(screen.getByRole('menu', { name: 'Move to level' })).getByText('Cellar'));
    expect(live(a.id).levelId).toBe('lv-2');
  });

  it('sets the background colour from its hex field in one undo step', () => {
    const { bg } = seed();
    sheet(bg.id);
    const hex = screen.getByRole('textbox', { name: 'Background hex' });
    fireEvent.change(hex, { target: { value: '#336699' } });
    fireEvent.keyDown(hex, { key: 'Enter' });
    expect((live(bg.id) as BackgroundLayer).backgroundColor).toBe('#336699');
    undoManager.undo();
    expect((live(bg.id) as BackgroundLayer).backgroundColor).toBe(bg.backgroundColor);
  });

  it('picks a background texture from the tiles, and None takes it off', () => {
    const { bg } = seed();
    sheet(bg.id);
    fireEvent.click(screen.getByRole('button', { name: 'Flagstone' }));
    expect((live(bg.id) as BackgroundLayer).backgroundTexture).toBe('pk:flagstone');
    fireEvent.click(screen.getByRole('button', { name: 'None' }));
    expect((live(bg.id) as BackgroundLayer).backgroundTexture).toBeNull();
  });

  it('commits a texture scale drag once, and shows Tint only with a texture', () => {
    const { bg } = seed();
    const { unmount } = sheet(bg.id);
    expect(screen.queryByRole('slider', { name: 'Texture scale' })).toBeNull();
    unmount();
    useStore.getState().updateLayer(bg.id, { backgroundTexture: 'pk:dirt' } as Partial<BackgroundLayer>);
    sheet(bg.id);
    const slider = screen.getByRole('slider', { name: 'Texture scale' });
    fireEvent.pointerDown(slider);
    fireEvent.change(slider, { target: { value: '2' } });
    fireEvent.pointerUp(slider);
    expect((live(bg.id) as BackgroundLayer).textureScale).toBe(2);
    expect(screen.getByRole('button', { name: /Tint colour/ })).toBeTruthy();
  });

  it('closes once Move to level takes its layer off the level on show', () => {
    const { a } = seed();
    useStore.getState().addLevel({ id: 'lv-2', name: 'Cellar' });
    const onClose = vi.fn();
    render(<LayerSheet target={a.id} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Move to level' }));
    fireEvent.click(within(screen.getByRole('menu', { name: 'Move to level' })).getByText('Cellar'));
    expect(live(a.id).levelId).toBe('lv-2');
    expect(onClose).toHaveBeenCalled();
  });

  it('closes when the level on show changes, and stays open for the Background', () => {
    const { a, bg } = seed();
    useStore.getState().addLevel({ id: 'lv-2', name: 'Cellar' });
    useStore.getState().addLayer(createDungeonLayer('Cellar layer', 'lv-2'));
    const onClose = vi.fn();
    render(<LayerSheet target={a.id} onClose={onClose} />);
    expect(onClose).not.toHaveBeenCalled();
    act(() => useStore.getState().setActiveLevelId('lv-2'));
    expect(onClose).toHaveBeenCalled();
    cleanup();
    const bgClose = vi.fn();
    render(<LayerSheet target={bg.id} onClose={bgClose} />);
    act(() => useStore.getState().setActiveLevelId(useStore.getState().levels[0].id));
    expect(bgClose).not.toHaveBeenCalled();
  });
});
