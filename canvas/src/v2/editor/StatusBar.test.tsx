import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import type { DungeonLayer } from '@/store/types';
import { StatusBar } from './StatusBar';

const grid = () => useStore.getState().grid;
const chip = () => screen.getByTestId('v2-grid-chip');
const openGrid = () => {
  fireEvent.click(chip());
  return screen.getByRole('dialog', { name: 'Grid' });
};

beforeEach(() => {
  useStore.getState().resetToDefault();
  useStore.getState().setSnapEnabled(true);
});

afterEach(cleanup);

describe('v2 StatusBar zoom readout', () => {
  it('reads 100% at the zoom a map opens at', () => {
    render(<StatusBar />);
    expect(screen.getByTestId('v2-zoom-pct').textContent).toBe('100%');
  });
});

describe('v2 StatusBar grid chip', () => {
  it('reads the snap step, and off when snapping is off', () => {
    render(<StatusBar />);
    expect(chip().textContent).toBe('Grid· ½');
    act(() => useStore.getState().setSnapDivision(4));
    expect(chip().textContent).toContain('¼');
    act(() => useStore.getState().setSnapEnabled(false));
    expect(chip().textContent).toContain('off');
  });

  it('dims when the grid is hidden', () => {
    render(<StatusBar />);
    expect(chip().className).not.toMatch(/hidden/);
    act(() => useStore.getState().setGridVisible(false));
    expect(chip().className).toMatch(/v2-status__gridchip--hidden/);
  });

  it('opens a popover with focus inside, and its controls drive the grid', () => {
    render(<StatusBar />);
    const pop = openGrid();
    expect(chip().getAttribute('aria-expanded')).toBe('true');
    const show = within(pop).getByRole('switch', { name: 'Show grid' });
    expect(document.activeElement).toBe(show);

    fireEvent.click(show);
    expect(grid().visible).toBe(false);

    fireEvent.click(within(pop).getByRole('switch', { name: 'Snap' }));
    expect(grid().snapEnabled).toBe(false);

    const step = within(pop).getByRole('button', { name: '1/8' });
    fireEvent.click(step);
    expect(grid().snapDivision).toBe(8);
    expect(step.getAttribute('aria-pressed')).toBe('true');
    expect(within(pop).getByRole('button', { name: '1/2' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('closes on Escape and hands focus back to the chip', () => {
    render(<StatusBar />);
    openGrid();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Grid' })).toBeNull();
    expect(document.activeElement).toBe(chip());
  });

  it('closes on a press outside it, and the chip toggles it shut', () => {
    render(<StatusBar />);
    openGrid();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog', { name: 'Grid' })).toBeNull();
    openGrid();
    fireEvent.click(chip());
    expect(screen.queryByRole('dialog', { name: 'Grid' })).toBeNull();
  });

  it('sets the active layer\'s grid lines colour, one undo step per visit, and calls it nothing else', () => {
    undoManager.clear();
    const layer = () => useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
    useStore.getState().setActiveLayerId(layer().id);
    const before = layer().style.wallColor;
    render(<StatusBar />);
    const pop = openGrid();
    expect(within(pop).queryByText(/wall/i)).toBeNull();
    const swatch = within(pop).getByRole('button', { name: /^Grid lines colour/ });
    expect(swatch.getAttribute('data-tip')).toBe("Colour of the grid lines over this layer's floors");

    fireEvent.click(swatch);
    const hex = screen.getByRole('textbox', { name: 'Hex colour' });
    fireEvent.change(hex, { target: { value: '#556677' } });
    fireEvent.keyDown(hex, { key: 'Enter' });
    expect(layer().style.wallColor).toBe('#556677');
    fireEvent.click(within(pop).getByRole('button', { name: /^Grid lines colour/ }));

    act(() => undoManager.undo());
    expect(layer().style.wallColor).toBe(before);
    expect(undoManager.canUndo()).toBe(false);
  });

  it('has no grid lines row when the active layer is not a dungeon layer', () => {
    const bg = useStore.getState().layers.find((l) => l.type === 'background')!;
    useStore.getState().setActiveLayerId(bg.id);
    render(<StatusBar />);
    const pop = openGrid();
    expect(within(pop).queryByText('Grid lines')).toBeNull();
  });

  it('is not undoable', () => {
    render(<StatusBar />);
    const pop = openGrid();
    fireEvent.click(within(pop).getByRole('switch', { name: 'Snap' }));
    expect(useStore.getState().ui.canUndo).toBe(false);
  });
});

describe('v2 StatusBar edit hints', () => {
  it('shows the wall key map with keys as keycaps', () => {
    useStore.getState().setNodeEditWall('wall-1');
    useStore.getState().selectNode(0.25);
    render(<StatusBar />);
    const hint = screen.getByTestId('v2-status-hint');
    expect(hint.textContent).toBe(
      'Editing wall · [ ] rotate · - + size · , . gap · Tab piece · { } insert · Del remove · Esc done',
    );
    const keys = [...hint.querySelectorAll('kbd')].map((k) => k.textContent);
    expect(keys).toContain('Tab');
    expect(keys).toContain('Esc');
  });

  it('gives the slot back to the solo chip once editing ends', () => {
    const layerId = useStore.getState().layers.find((l) => l.type === 'dungeon')!.id;
    useStore.getState().setShapeNodeEdit('shape-1');
    useStore.setState((s) => {
      s.ui.solo = { layerId };
    });
    render(<StatusBar />);
    expect(screen.getByTestId('v2-status-hint').textContent).toMatch(/^Editing outline · drag a corner/);
    expect(screen.queryByText(/Soloing/)).toBeNull();
    act(() => useStore.getState().setShapeNodeEdit(null));
    expect(screen.queryByTestId('v2-status-hint')).toBeNull();
    expect(screen.getByText(/Soloing/)).toBeTruthy();
  });
});

describe('v2 StatusBar prop hints', () => {
  it('shows the stamp keys while the Props tool stamps, keys as keycaps', () => {
    useStore.getState().setActiveTool('scatterBrush');
    useStore.getState().updateScatterBrushSettings({ stampMode: true });
    render(<StatusBar />);
    const hint = screen.getByTestId('v2-status-hint');
    expect(hint.textContent).toMatch(/^Stampclick to place/);
    const keys = [...hint.querySelectorAll('kbd')].map((k) => k.textContent);
    expect(keys).toEqual(['Wheel', 'Alt', 'Shift', 'F', 'Ctrl', 'Esc']);
  });

  it('switches to the scatter line with the mode', () => {
    useStore.getState().setActiveTool('scatterBrush');
    useStore.getState().updateScatterBrushSettings({ stampMode: true });
    render(<StatusBar />);
    act(() => useStore.getState().updateScatterBrushSettings({ stampMode: false }));
    expect(screen.getByTestId('v2-status-hint').textContent).toContain('drag to paint · one undo per stroke');
  });

  it('leaves the slot to the room tool when one is in hand', () => {
    useStore.getState().setActiveTool('roomRect');
    render(<StatusBar />);
    expect(screen.getByTestId('v2-status-hint').textContent).toMatch(/^Rectangle room/);
  });
});
