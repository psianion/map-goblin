import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import type { AnyChild, DungeonLayer, ShapeChild } from '@/store/types';
import { SelectionCard } from './SelectionCard';

vi.mock('@/editor/PackThumbnailCanvas', () => ({
  PackThumbnailCanvas: ({ textureId }: { textureId: string }) => <span data-testid="thumb">{textureId}</span>,
}));

function shape(id: string, x0: number, x1: number, over: Partial<ShapeChild> = {}): ShapeChild {
  return {
    id,
    name: id,
    childType: 'shape',
    visible: true,
    shapeType: 'rectangle',
    contours: [[[x0, x0], [x1, x0], [x1, x1], [x0, x1]]],
    textureScale: 1,
    textureOffsetX: 0,
    textureOffsetY: 0,
    textureFillRotation: 0,
    textureTint: '#ffffff',
    ...over,
  };
}

function seed(children: AnyChild[], selected: string[]) {
  const layer = {
    id: 'l1',
    type: 'dungeon',
    name: 'Dungeon',
    visible: true,
    locked: false,
    opacity: 1,
    children,
    rooms: [],
    standaloneWalls: [],
    mergedFloor: null,
    style: { floorColor: '#aabbcc' },
  } as unknown as DungeonLayer;
  useStore.setState({ layers: [layer] });
  useStore.setState((s) => {
    s.selection.selectedIds = selected;
  });
}

const child = (id: string) =>
  (useStore.getState().layers[0] as DungeonLayer).children.find((c) => c.id === id) as ShapeChild;

describe('plateau rows on a floor card', () => {
  beforeEach(() => {
    cleanup();
    useStore.getState().resetToDefault();
    undoManager.clear();
    sessionStorage.clear();
  });

  it('steps the height in whole cells, one undo step each, and shows the edge rows once raised', () => {
    seed([shape('ground', 0, 20), shape('top', 4, 8)], ['top']);
    render(<SelectionCard />);
    expect(screen.queryByRole('group', { name: 'Edge' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Raise' }));
    fireEvent.click(screen.getByRole('button', { name: 'Raise' }));
    expect(child('top').height).toBe(2);
    expect(screen.getByTestId('v2-plateau-height').textContent).toContain('+2');
    expect(screen.getByRole('group', { name: 'Edge' })).not.toBeNull();
    act(() => undoManager.undo());
    expect(child('top').height).toBe(1);
  });

  it('turns a raised floor into a cliff and answers Auto with the drop against the threshold', () => {
    seed([shape('ground', 0, 20), shape('top', 4, 8, { height: 2 })], ['top']);
    render(<SelectionCard />);
    fireEvent.click(screen.getByRole('button', { name: 'Cliff' }));
    expect(child('top').edge).toBe('cliff');
    expect(screen.getByRole('button', { name: 'Auto (hides)' })).not.toBeNull();
    expect(screen.getByTestId('v2-plateau-standing').textContent).toBe('+2 · drop 2');
    fireEvent.click(screen.getByRole('button', { name: 'Never' }));
    expect(child('top').sightOverride).toBe('show');
  });

  it('picks a crossing kind from the map list, with the edge default first', () => {
    seed([shape('ground', 0, 20), shape('top', 4, 8, { height: 1, edge: 'slope' })], ['top']);
    render(<SelectionCard />);
    const select = screen.getByRole('combobox', { name: 'Crossing' }) as HTMLSelectElement;
    expect(select.options[0].textContent).toBe('Default (Difficult)');
    fireEvent.change(select, { target: { value: 'impassable' } });
    expect(child('top').crossingId).toBe('impassable');
  });
});
