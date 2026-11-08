import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { defaultCrossingKinds } from '@dnd/core/src/shared/crossingKinds';
import type { Layer } from '@/store/types';
import { PlateauRules } from './PlateauRules';
import { crossingIdsInUse } from './plateauRulesModel';

describe('PlateauRules', () => {
  beforeEach(() => cleanup());

  it('counts a plateau edge with no kind of its own as using its default', () => {
    const layers = [
      {
        type: 'dungeon',
        children: [
          { childType: 'plateau', height: 2, edge: 'cliff' },
          { childType: 'plateau', height: 1, edge: 'slope', crossingId: 'impassable' },
          { childType: 'shape' },
        ],
      },
    ] as unknown as Layer[];
    expect(crossingIdsInUse(layers)).toEqual(new Set(['climb', 'impassable']));
  });

  it('refuses to delete a kind in use, and adds, renames and reorders the rest', () => {
    const onKinds = vi.fn();
    const kinds = defaultCrossingKinds();
    render(
      <PlateauRules sightDropCells={2} onSightDropCells={vi.fn()} kinds={kinds} onKinds={onKinds} inUse={new Set(['climb'])} />,
    );
    expect((screen.getByRole('button', { name: 'Delete Climb' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Difficult' }));
    expect(onKinds.mock.calls[0][0].map((k: { id: string }) => k.id)).toEqual(['free', 'climb', 'impassable']);
    fireEvent.click(screen.getByRole('button', { name: 'Move Climb up' }));
    expect(onKinds.mock.calls[1][0].map((k: { id: string }) => k.id)).toEqual(['free', 'climb', 'difficult', 'impassable']);
    fireEvent.click(screen.getByTestId('v2-map-crossing-add'));
    expect(onKinds.mock.calls[2][0]).toHaveLength(5);
    fireEvent.click(screen.getByRole('switch', { name: 'Free refuses moves' }));
    expect(onKinds.mock.calls[3][0][0].blocks).toBe(true);
  });

  it('steps the sight threshold, never below one cell', () => {
    const onSight = vi.fn();
    render(<PlateauRules sightDropCells={1} onSightDropCells={onSight} kinds={[]} onKinds={vi.fn()} inUse={new Set()} />);
    expect((screen.getByRole('button', { name: 'Decrease drop' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Increase drop' }));
    expect(onSight).toHaveBeenCalledWith(2);
  });
});
