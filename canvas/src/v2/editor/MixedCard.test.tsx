import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import type { AnyChild, DungeonLayer } from '@/store/types';
import type { LightChild, WallSegment } from '@/shared/types';
import { resolveSelection } from '@dnd/core/src/store/selectionResolve';
import { MixedCard } from './MixedCard';
import { mixedModel } from './cardModels';

const asset = (id: string, x: number, extra: Record<string, unknown> = {}): AnyChild =>
  ({
    id, name: id, childType: 'asset', visible: true, objectType: 'asset', assetId: 'a', position: { x, y: 0 }, rotation: 0,
    scale: 1, width: 1, height: 1, tint: '#ffffff', flipX: false, flipY: false, ...extra,
  }) as unknown as AnyChild;
const light = (id: string, x: number, y = 0): AnyChild =>
  ({ id, name: id, childType: 'light', visible: true, color: '#fff', radius: 1, featherRadius: 1, intensity: 1, falloff: 'linear', position: { x, y } }) as unknown as AnyChild;
const label = (id: string): AnyChild =>
  ({ id, name: id, childType: 'text', visible: true, text: id, position: { x: 3, y: 3 }, rotation: 0, scale: 1, width: 2, height: 1 }) as unknown as AnyChild;
const door = (id: string): AnyChild =>
  ({ id, name: id, childType: 'door', visible: true, wallId: '', position: [0, 0], angle: 0, width: 1 }) as unknown as AnyChild;
const wall = (id: string, x: number): WallSegment =>
  ({ id, points: [[x, 5], [x + 2, 5]], wallType: 'normal', direction: 'both', color: '#000', roughness: 0, width: 0.3 }) as WallSegment;

function seed(children: AnyChild[], walls: WallSegment[] = [], selected: string[] = []) {
  const s = useStore.getState();
  const levelId = s.levels[0]?.id;
  const layer = {
    id: 'l1', type: 'dungeon', name: 'Dungeon', visible: true, locked: false, opacity: 1, levelId, children,
    standaloneWalls: walls, mergedFloor: null, style: {}, rooms: [],
  } as unknown as DungeonLayer;
  const other = { ...layer, id: 'l2', name: 'Other', children: [], standaloneWalls: [] };
  useStore.setState({ layers: [layer, other] });
  useStore.getState().setSelectedIds(selected);
  useStore.getState().setActiveTool('select');
}

const model = (ids: string[]) => mixedModel(resolveSelection(useStore.getState(), ids));
const layerOf = (id: string) => (useStore.getState().layers as DungeonLayer[]).find((l) => l.children.some((c) => c.id === id))?.id;

describe('mixed card', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
    undoManager.clear();
  });
  afterEach(cleanup);

  it('titles the selection kind by kind', () => {
    seed([asset('a', 0), asset('b', 2), asset('c', 4), light('l', 1), light('m', 3), label('t')]);
    expect(model(['a', 'b', 'c', 'l', 'm', 't']).title).toBe('3 props · 2 lights · 1 label');
  });

  it('counts the locked members', () => {
    seed([asset('a', 0, { locked: true }), light('l', 1)]);
    expect(model(['a', 'l']).locked).toBe(1);
  });

  it('arranges anything with a box but doors and locked members', () => {
    seed([asset('a', 0), asset('b', 1, { locked: true }), door('d'), light('l', 2)], [wall('w', 0)]);
    expect(model(['a', 'b', 'd', 'l', 'w']).arrangeable).toBe(3);
  });

  it('knows the one layer when every member shares it', () => {
    seed([asset('a', 0), light('l', 1)]);
    expect(model(['a', 'l']).layerId).toBe('l1');
  });

  it('shows the title and the locked tag', () => {
    seed([asset('a', 0, { locked: true }), light('l', 1)], [], ['a', 'l']);
    render(<MixedCard />);
    expect(screen.getByTestId('v2-mixed-title').textContent).toBe('1 prop · 1 light');
    expect(screen.getByTestId('v2-sel-locked').textContent).toContain('1 locked');
  });

  it('offers Align for two and Distribute only from three', () => {
    seed([asset('a', 0), light('l', 4)], [], ['a', 'l']);
    render(<MixedCard />);
    expect(screen.getByTestId('v2-mixed-align')).toBeTruthy();
    expect(screen.queryByTestId('v2-mixed-distribute')).toBeNull();
  });

  it('Distribute appears with three members', () => {
    seed([asset('a', 0), light('l', 4), label('t')], [], ['a', 'l', 't']);
    render(<MixedCard />);
    expect(screen.getByTestId('v2-mixed-distribute')).toBeTruthy();
  });

  it('Align left lines a light and a wall up, one undo step', () => {
    seed([light('l', 10)], [wall('w', 2)], ['l', 'w']);
    render(<MixedCard />);
    fireEvent.click(screen.getByTestId('v2-mixed-align-left'));
    const l = (useStore.getState().layers[0] as DungeonLayer).children[0] as LightChild;
    // By the light's marker square, not its radius.
    expect(l.position.x - 0.5).toBeCloseTo(2 - 0.3);
    undoManager.undo();
    expect(((useStore.getState().layers[0] as DungeonLayer).children[0] as LightChild).position.x).toBe(10);
  });

  it('Order shows only when props are in the selection', () => {
    seed([light('l', 0), label('t')], [], ['l', 't']);
    render(<MixedCard />);
    expect(screen.queryByTestId('v2-mixed-order')).toBeNull();
  });

  it('moves the selection to another layer', () => {
    seed([asset('a', 0), light('l', 1)], [], ['a', 'l']);
    render(<MixedCard />);
    fireEvent.change(screen.getByTestId('v2-mixed-layer'), { target: { value: 'l2' } });
    expect(layerOf('a')).toBe('l2');
    expect(layerOf('l')).toBe('l2');
  });

  it('Select only narrows to one kind', () => {
    seed([asset('a', 0), light('l', 1)], [], ['a', 'l']);
    render(<MixedCard />);
    fireEvent.click(screen.getAllByText('Select only')[1]);
    expect(useStore.getState().selection.selectedIds).toEqual(['l']);
  });

  it('carries the action row', () => {
    seed([asset('a', 0), light('l', 1)], [], ['a', 'l']);
    render(<MixedCard />);
    expect(screen.getByTestId('v2-sel-actions')).toBeTruthy();
  });
});
