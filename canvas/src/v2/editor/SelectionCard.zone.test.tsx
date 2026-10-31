import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import type { AnyChild, DungeonLayer } from '@/store/types';
import type { ZoneChild } from '@/store/types';
import { SelectionCard } from './SelectionCard';

vi.mock('@/components/shared/PackThumbnailCanvas', () => ({
  PackThumbnailCanvas: () => <span />,
}));

function seed(zone: ZoneChild) {
  const layer = {
    id: 'l1', type: 'dungeon', name: 'Dungeon', visible: true, locked: false, opacity: 1, children: [zone as AnyChild],
    rooms: [], standaloneWalls: [], mergedFloor: null, style: {},
  } as unknown as DungeonLayer;
  useStore.setState({ layers: [layer] });
  useStore.getState().setSelectedIds([zone.id]);
}
const shape = () => ((useStore.getState().layers[0] as DungeonLayer).children[0] as ZoneChild).shape;

function type(label: string, value: string) {
  const input = screen.getByLabelText(label) as HTMLInputElement;
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

describe('zone card position fields', () => {
  beforeEach(() => {
    cleanup();
    useStore.getState().resetToDefault();
    undoManager.clear();
  });

  it('a circle zone shows X, Y and Radius', () => {
    seed({ id: 'z', name: 'Ambush', childType: 'zone', visible: true, shape: { kind: 'circle', position: { x: 4, y: 5 }, radius: 2 } });
    render(<SelectionCard />);
    expect((screen.getByLabelText('Zone X') as HTMLInputElement).value).toBe('4');
    expect((screen.getByLabelText('Zone Y') as HTMLInputElement).value).toBe('5');
    expect((screen.getByLabelText('Zone radius') as HTMLInputElement).value).toBe('2');
  });

  it('typing a radius sets it, one undo step', () => {
    seed({ id: 'z', name: 'Ambush', childType: 'zone', visible: true, shape: { kind: 'circle', position: { x: 4, y: 5 }, radius: 2 } });
    render(<SelectionCard />);
    type('Zone radius', '3');
    expect(shape()).toEqual({ kind: 'circle', position: { x: 4, y: 5 }, radius: 3 });
    undoManager.undo();
    expect(shape()).toEqual({ kind: 'circle', position: { x: 4, y: 5 }, radius: 2 });
  });

  it('a rect zone shows W and H and moves by X', () => {
    seed({ id: 'z', name: 'Vault', childType: 'zone', visible: true, shape: { kind: 'rect', x: 1, y: 2, width: 3, height: 4 } });
    render(<SelectionCard />);
    expect((screen.getByLabelText('Zone width') as HTMLInputElement).value).toBe('3');
    type('Zone X', '6');
    expect(shape()).toEqual({ kind: 'rect', x: 6, y: 2, width: 3, height: 4 });
  });

  it('a point zone shows only X and Y', () => {
    seed({ id: 'z', name: 'Pin', childType: 'zone', visible: true, shape: { kind: 'point', position: { x: 1, y: 1 } } });
    render(<SelectionCard />);
    expect(screen.getByLabelText('Zone X')).toBeTruthy();
    expect(screen.queryByLabelText('Zone radius')).toBeNull();
    expect(screen.queryByLabelText('Zone width')).toBeNull();
  });
});
