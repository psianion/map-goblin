import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import { createDungeonLayer } from '@/store/factories';
import type { DungeonLayer, Room } from '@/store/types';
import { SplitDialog } from './SplitDialog';

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const square = (x: number, y: number, s = 4): [number, number][] => [
  [x, y],
  [x + s, y],
  [x + s, y + s],
  [x, y + s],
];

const room = (id: string, name: string, number: number, x: number): Room => ({
  id,
  name,
  number,
  anchor: [x + 2, 2],
  face: square(x, 0),
  area: 16,
});

/** One dungeon layer on the store's one level, holding three rooms. */
function seed(): void {
  const levelId = useStore.getState().levels[0].id;
  const layer = {
    ...createDungeonLayer('Dungeon', levelId),
    rooms: [room('r1', 'Entry cave', 1, 0), room('r2', 'Warren hall', 2, 10), room('r3', 'Guard post', 3, 20)],
  } as DungeonLayer;
  useStore.setState({ layers: [layer] });
  useStore.getState().setActiveLayerId(layer.id);
}

const live = () => useStore.getState().layers[0] as DungeonLayer;
const roomOf = (id: string) => live().rooms!.find((r) => r.id === id)!;

const pending = (halves: [[number, number][], [number, number][]]) =>
  act(() =>
    useStore.getState().setPendingSplit({
      layerId: live().id,
      roomId: 'r2',
      threshold: { id: 't1', points: [[12, -1], [12, 5]] },
      halves,
    }),
  );

beforeEach(() => {
  cleanup();
  useStore.getState().resetToDefault();
  undoManager.clear();
});

describe('Split dialog', () => {
  const west = square(10, 0, 4).map(([x, y]) => [x, y] as [number, number]);

  it('defaults to the larger half keeping the room and names the other by where it lies', () => {
    seed();
    const big: [number, number][] = [[10, 0], [13, 0], [13, 4], [10, 4]];
    const small: [number, number][] = [[13, 0], [14, 0], [14, 4], [13, 4]];
    pending([big, small]);
    render(<SplitDialog />);
    expect(screen.getByText('Split Warren hall')).toBeTruthy();
    expect(screen.getByTestId('v2-split-half-0').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('v2-split-half-0').textContent).toContain('West half');
    expect((screen.getByLabelText('The other half becomes') as HTMLInputElement).value).toBe('Warren hall, east');
    expect(screen.getByText(/next free number, 4/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('v2-split-half-1'));
    expect((screen.getByLabelText('The other half becomes') as HTMLInputElement).value).toBe('Warren hall, west');
  });

  it('Split adds the other half with the next number and copied fog, and moves the keeper into its half', () => {
    seed();
    const left: [number, number][] = [[10, 0], [11.5, 0], [11.5, 4], [10, 4]];
    const right: [number, number][] = [[11.5, 0], [14, 0], [14, 4], [11.5, 4]];
    pending([right, left]);
    render(<SplitDialog />);
    // Keep the left half, where the anchor (12, 2) is not.
    fireEvent.click(screen.getByTestId('v2-split-half-1'));
    fireEvent.click(screen.getByTestId('v2-split-commit'));
    expect(useStore.getState().ui.pendingSplit).toBeNull();
    const rooms = live().rooms!;
    expect(rooms).toHaveLength(4);
    const other = rooms.find((r) => !['r1', 'r2', 'r3'].includes(r.id))!;
    expect(other).toMatchObject({ name: 'Warren hall, east', number: 4, derivedFrom: 'r2' });
    expect(roomOf('r2').anchor[0]).toBeLessThan(11.5);
    expect(live().thresholds).toHaveLength(1);
    act(() => undoManager.undo());
    expect(live().rooms).toHaveLength(3);
  });

  it('Start hidden leaves no fog lineage; Cancel adds nothing', () => {
    seed();
    pending([west, square(14, 0, 2)]);
    const { unmount } = render(<SplitDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'Start hidden' }));
    fireEvent.click(screen.getByTestId('v2-split-commit'));
    expect(live().rooms!.find((r) => r.number === 4)?.derivedFrom).toBeUndefined();
    unmount();
    pending([west, square(14, 0, 2)]);
    render(<SplitDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(useStore.getState().ui.pendingSplit).toBeNull();
    expect(live().rooms).toHaveLength(4);
  });
});
