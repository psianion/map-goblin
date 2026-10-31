import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import { notify } from '@/lib/toast';
import type { AnyChild, DungeonLayer } from '@/store/types';
import type { ZoneChild } from '@/store/types';
import { SelectionCard } from './SelectionCard';

vi.mock('@/components/shared/PackThumbnailCanvas', () => ({
  PackThumbnailCanvas: () => <span />,
}));
vi.mock('@/lib/toast', () => ({
  notify: { subtle: vi.fn(), action: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

function seed(zone: ZoneChild) {
  const layer = {
    id: 'l1', type: 'dungeon', name: 'Dungeon', visible: true, locked: false, opacity: 1, children: [zone as AnyChild],
    rooms: [], standaloneWalls: [], mergedFloor: null, style: {},
  } as unknown as DungeonLayer;
  useStore.setState({ layers: [layer] });
  useStore.getState().setSelectedIds([zone.id]);
}
const child = () => (useStore.getState().layers[0] as DungeonLayer).children[0] as ZoneChild;
const shape = () => child().shape;

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

  it('the card renames the zone in place, one undo step; Esc puts the name back', () => {
    seed({ id: 'z', name: 'Ambush', childType: 'zone', visible: true, shape: { kind: 'point', position: { x: 1, y: 1 } } });
    render(<SelectionCard />);
    const card = screen.getByTestId('v2-selection-card');
    const name = within(card).getByLabelText('Zone name') as HTMLInputElement;
    fireEvent.focus(name);
    fireEvent.change(name, { target: { value: 'Kennels' } });
    fireEvent.keyDown(name, { key: 'Escape' });
    fireEvent.blur(name);
    expect(child().name).toBe('Ambush');
    fireEvent.focus(name);
    fireEvent.change(name, { target: { value: 'Kennels' } });
    fireEvent.blur(name);
    expect(child().name).toBe('Kennels');
    undoManager.undo();
    expect(child().name).toBe('Ambush');
  });

  it('More… opens the v2 zone sheet, with no legacy styling inside it', () => {
    seed({ id: 'z', name: 'Ambush', childType: 'zone', visible: true, shape: { kind: 'circle', position: { x: 4, y: 5 }, radius: 2 } });
    render(<SelectionCard />);
    fireEvent.click(screen.getByRole('button', { name: 'More…' }));
    const sheet = screen.getByTestId('v2-zone-sheet');
    expect(within(sheet).getByTestId('v2-zone-sheet-body')).toBeTruthy();
    expect(sheet.querySelector('.v2-legacy')).toBeNull();
    expect(within(sheet).getByRole('button', { name: 'Add trigger' })).toBeTruthy();
  });

  it('Delete on a zone with triggers warns that they now reference nothing', () => {
    seed({ id: 'z', name: 'Ambush', childType: 'zone', visible: true, shape: { kind: 'circle', position: { x: 4, y: 5 }, radius: 2 } });
    useStore.getState().upsertTrigger({ id: 't', name: 'T', when: { kind: 'enter-region', zoneId: 'z' }, actions: [], once: true, enabled: true });
    render(<SelectionCard />);
    fireEvent.click(screen.getByTestId('v2-sel-act-delete'));
    expect(notify.warning).toHaveBeenCalledWith(expect.stringContaining('1 trigger now references nothing'));
    expect((useStore.getState().layers[0] as DungeonLayer).children).toHaveLength(0);
  });

  it('a point zone shows only X and Y', () => {
    seed({ id: 'z', name: 'Pin', childType: 'zone', visible: true, shape: { kind: 'point', position: { x: 1, y: 1 } } });
    render(<SelectionCard />);
    expect(screen.getByLabelText('Zone X')).toBeTruthy();
    expect(screen.queryByLabelText('Zone radius')).toBeNull();
    expect(screen.queryByLabelText('Zone width')).toBeNull();
  });
});
