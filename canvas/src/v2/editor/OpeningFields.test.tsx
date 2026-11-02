import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import type { AnyChild, DungeonLayer, ShapeChild } from '@/store/types';
import type { OpeningChild } from '@dnd/core/src/shared/types';
import { SelectionCard } from './SelectionCard';

vi.mock('@/editor/PackThumbnailCanvas', () => ({ PackThumbnailCanvas: () => null }));

const top: ShapeChild = {
  id: 'top',
  name: 'top',
  childType: 'shape',
  visible: true,
  shapeType: 'rectangle',
  contours: [[[4, 4], [8, 4], [8, 8], [4, 8]]],
  textureScale: 1,
  textureOffsetX: 0,
  textureOffsetY: 0,
  textureFillRotation: 0,
  textureTint: '#ffffff',
  height: 2,
  edge: 'cliff',
};
const stairs: OpeningChild = { id: 'o1', name: 'Stairs 1', childType: 'opening', visible: true, kind: 'stairs', shapeId: 'top', t: 0.1, width: 2 };

function seed(children: AnyChild[]) {
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
    s.selection.selectedIds = ['o1'];
  });
}

const opening = () =>
  (useStore.getState().layers[0] as DungeonLayer).children.find((c) => c.id === 'o1') as OpeningChild;

describe('opening card', () => {
  beforeEach(() => {
    cleanup();
    useStore.getState().resetToDefault();
    undoManager.clear();
  });

  it('sets kind, width and crossing, one undo step each', () => {
    seed([top, stairs]);
    render(<SelectionCard />);
    expect(screen.getByTestId('v2-sel-kind').textContent).toBe('Opening');
    fireEvent.click(screen.getByRole('button', { name: 'Ramp' }));
    expect(opening().kind).toBe('ramp');
    // Ramps have no art to pick.
    expect(screen.queryByRole('combobox', { name: 'Art' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Wider' }));
    expect(opening().width).toBe(2.5);
    fireEvent.change(screen.getByRole('combobox', { name: 'Crossing' }), { target: { value: 'difficult' } });
    expect(opening().crossingId).toBe('difficult');
    act(() => undoManager.undo());
    expect(opening().crossingId).toBeUndefined();
    act(() => undoManager.undo());
    expect(opening().width).toBe(2);
  });
});
