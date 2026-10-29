import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { PrepOverview } from './PrepOverview';
import { useStore } from '@/store/store';
import type { DungeonLayer, TriggerDef } from '@/store/types';

const zone = (id: string, name: string, shape: unknown) =>
  ({ id, name, childType: 'zone', visible: true, shape }) as DungeonLayer['children'][number];

function seedLayers() {
  const layer = {
    id: 'l1',
    type: 'dungeon',
    name: 'Dungeon',
    children: [
      zone('z-guard', 'Guard post', { kind: 'circle', position: { x: 10, y: 10 }, radius: 3 }),
      zone('z-shrine', 'Old shrine', { kind: 'point', position: { x: 50, y: 50 } }),
    ],
    rooms: [{ id: 'r1', boundary: [[0, 0], [20, 0], [20, 20], [0, 20]] }],
  } as unknown as DungeonLayer;
  useStore.setState({ layers: [layer] });
}

const trigger = (over: Partial<TriggerDef> & Pick<TriggerDef, 'id' | 'when'>): TriggerDef => ({
  name: over.id,
  actions: [],
  once: true,
  enabled: true,
  ...over,
});

describe('PrepOverview', () => {
  beforeEach(() => {
    cleanup();
    useStore.getState().resetToDefault();
    useStore.setState({ prep: null });
  });

  it('shows one quiet line and how to add prep when there is none', () => {
    render(<PrepOverview />);
    expect(screen.getByText('No triggers or notes yet')).not.toBeNull();
    expect(screen.getByText('Z')).not.toBeNull();
  });

  it('renders zone groups with counts and marks inert rows', () => {
    seedLayers();
    useStore.setState({
      prep: {
        version: 3,
        rooms: [],
        triggers: [
          trigger({ id: 't-trap', name: 'Bear trap', when: { kind: 'enter-region', zoneId: 'z-guard' } }),
          trigger({
            id: 't-orphan',
            name: 'Brazier lights',
            enabled: false,
            when: { kind: 'room-revealed', zoneId: 'z-shrine' },
          }),
        ],
        notes: [{ id: 'n1', zoneId: 'z-guard', title: 'First sight', body: '', imageKeys: [], showOnReveal: true }],
      },
    });

    render(<PrepOverview />);

    const guard = screen.getByRole('region', { name: 'Guard post' });
    expect(within(guard).getByText('2')).not.toBeNull();
    expect(within(guard).getByText('Enter region → no actions')).not.toBeNull();
    expect(within(guard).getByText('Pops')).not.toBeNull();
    expect(within(guard).queryByText('Inert')).toBeNull();

    const shrine = screen.getByRole('region', { name: 'Old shrine' });
    expect(within(shrine).getByText('Inert')).not.toBeNull();
    expect(within(shrine).getByText('pin not inside a room')).not.toBeNull();
    expect(within(shrine).getByText('Off')).not.toBeNull();
  });

  it('clicking a row selects its zone', () => {
    seedLayers();
    useStore.setState({
      prep: {
        version: 3,
        rooms: [],
        triggers: [trigger({ id: 't1', name: 'Bear trap', when: { kind: 'enter-region', zoneId: 'z-guard' } })],
        notes: [],
      },
    });

    render(<PrepOverview />);
    fireEvent.click(screen.getByText('Bear trap'));

    expect(useStore.getState().selection.selectedIds).toEqual(['z-guard']);
    expect(screen.getByTestId('v2-prep-row').getAttribute('aria-current')).toBe('true');
  });
});
