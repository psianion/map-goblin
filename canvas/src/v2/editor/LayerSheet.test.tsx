import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useStore } from '@/store/store';
import { createDungeonLayer } from '@/store/factories';
import { PropertyCommand } from '@/store/commands';
import { undoManager } from '@/store/undoManager';
import { TERRAIN_PANEL_ID, type DungeonLayer } from '@/store/types';
import { LayerSheet } from './LayerSheet';

function seed(over: Partial<DungeonLayer> = {}): DungeonLayer {
  const layer = { ...createDungeonLayer('Crypt'), ...over } as DungeonLayer;
  useStore.setState({ layers: [layer] });
  return layer;
}

const live = (id: string) => useStore.getState().layers.find((l) => l.id === id) as DungeonLayer;

let execSpy: { mock: { calls: unknown[][] }; mockClear: () => void; mockRestore: () => void };

describe('LayerSheet', () => {
  beforeEach(() => {
    cleanup();
    useStore.getState().resetToDefault();
    undoManager.clear();
    execSpy = vi.spyOn(undoManager, 'execute');
  });
  afterEach(() => {
    execSpy.mockRestore();
  });

  it('renders nothing while closed', () => {
    seed();
    render(<LayerSheet target={null} onClose={() => {}} />);
    expect(screen.queryByTestId('v2-layer-sheet')).toBeNull();
  });

  it('titles itself with the layer name and commits an opacity drag once', () => {
    const layer = seed();
    render(<LayerSheet target={layer.id} onClose={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Crypt' })).toBeTruthy();
    // The slider names itself; no "Opacity" section heading above it.
    expect(screen.queryByRole('heading', { name: 'Opacity' })).toBeNull();

    const slider = screen.getByRole('slider', { name: 'Opacity' });
    fireEvent.pointerDown(slider);
    fireEvent.change(slider, { target: { value: '60' } });
    fireEvent.change(slider, { target: { value: '40' } });
    expect(live(layer.id).opacity).toBeCloseTo(0.4);
    expect(execSpy).not.toHaveBeenCalled();
    fireEvent.pointerUp(slider);

    expect(execSpy).toHaveBeenCalledTimes(1);
    expect(execSpy.mock.calls[0][0]).toBeInstanceOf(PropertyCommand);
    undoManager.undo();
    expect(live(layer.id).opacity).toBe(1);
  });

  it('renames the layer on Enter, reverts on Escape and refuses blank', () => {
    const layer = seed();
    render(<LayerSheet target={layer.id} onClose={() => {}} />);
    const field = screen.getByRole('textbox', { name: 'Layer name' }) as HTMLInputElement;

    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: '   ' } });
    expect(screen.getByText(/A layer needs a name/)).toBeTruthy();
    fireEvent.blur(field);
    expect(execSpy).not.toHaveBeenCalled();
    expect(field.value).toBe('Crypt');

    field.focus();
    fireEvent.change(field, { target: { value: 'Ossuary' } });
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(execSpy).not.toHaveBeenCalled();
    expect(field.value).toBe('Crypt');

    field.focus();
    fireEvent.change(field, { target: { value: 'Ossuary ' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(execSpy).toHaveBeenCalledTimes(1);
    expect(live(layer.id).name).toBe('Ossuary');
  });

  it('flips a sublayer through one undoable PropertyCommand', () => {
    const layer = seed();
    render(<LayerSheet target={layer.id} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Walls and doors' }));
    expect(execSpy).toHaveBeenCalledTimes(1);
    expect(execSpy.mock.calls[0][0]).toBeInstanceOf(PropertyCommand);
    expect(live(layer.id).sublayerVisibility.walls).toBe(false);
    expect(live(layer.id).sublayerVisibility.floor).toBe(true);
    undoManager.undo();
    expect(live(layer.id).sublayerVisibility.walls).toBe(true);
  });

  it('says when the map grid is off, and the switch still works', () => {
    const layer = seed();
    useStore.setState((s) => ({ grid: { ...s.grid, visible: false } }));
    render(<LayerSheet target={layer.id} onClose={() => {}} />);
    expect(screen.getByText('Grid is hidden for the whole map')).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'Grid' }));
    expect(live(layer.id).sublayerVisibility.grid).toBe(false);
  });

  it('shows the edge width only while blending is on, and commits a drag once', () => {
    const layer = seed();
    useStore.getState().updateLayer(layer.id, {
      style: { ...layer.style, showEdgeTransitions: false },
    } as Partial<DungeonLayer>);
    render(<LayerSheet target={layer.id} onClose={() => {}} />);
    expect(screen.queryByRole('slider', { name: 'Width' })).toBeNull();
    fireEvent.click(screen.getByRole('switch', { name: 'Blend textures where floors meet' }));
    expect(live(layer.id).style.showEdgeTransitions).toBe(true);

    execSpy.mockClear();
    const width = screen.getByRole('slider', { name: 'Width' });
    fireEvent.pointerDown(width);
    fireEvent.change(width, { target: { value: '1.2' } });
    fireEvent.change(width, { target: { value: '1.5' } });
    fireEvent.pointerUp(width);
    expect(execSpy).toHaveBeenCalledTimes(1);
    expect(live(layer.id).style.edgeTransitionWidth).toBe(1.5);
  });

  it('gives a background layer name and opacity only', () => {
    const bg = useStore.getState().layers.find((l) => l.type === 'background');
    expect(bg).toBeTruthy();
    render(<LayerSheet target={bg!.id} onClose={() => {}} />);
    expect(screen.getByRole('textbox', { name: 'Layer name' })).toBeTruthy();
    expect(screen.getByRole('slider', { name: 'Opacity' })).toBeTruthy();
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
  });

  it('shows only Visible and Opacity in terrain mode', () => {
    seed();
    render(<LayerSheet target={TERRAIN_PANEL_ID} onClose={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Terrain' })).toBeTruthy();
    expect(screen.getAllByRole('switch').map((s) => s.getAttribute('aria-label'))).toEqual(['Visible']);
    expect(screen.getAllByRole('slider').map((s) => s.getAttribute('aria-label'))).toEqual(['Opacity']);
    expect(screen.queryByRole('textbox')).toBeNull();

    fireEvent.click(screen.getByRole('switch', { name: 'Visible' }));
    expect(useStore.getState().mapSettings.terrain?.visible).toBe(false);

    execSpy.mockClear();
    const slider = screen.getByRole('slider', { name: 'Opacity' });
    fireEvent.pointerDown(slider);
    fireEvent.change(slider, { target: { value: '50' } });
    fireEvent.pointerUp(slider);
    expect(execSpy).toHaveBeenCalledTimes(1);
    expect(useStore.getState().mapSettings.terrain?.opacity).toBe(0.5);
  });

  it('closes on Escape and from its close button', () => {
    const layer = seed();
    const onClose = vi.fn();
    render(<LayerSheet target={layer.id} onClose={onClose} />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Close Crypt' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('closes itself when its layer is gone', () => {
    const onClose = vi.fn();
    seed();
    render(<LayerSheet target="missing" onClose={onClose} />);
    expect(onClose).toHaveBeenCalled();
  });
});
