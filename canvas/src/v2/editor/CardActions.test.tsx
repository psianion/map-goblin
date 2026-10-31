import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import type { AnyChild, DungeonLayer } from '@/store/types';
import type { WallSegment } from '@/shared/types';
import { resolveSelection } from '@dnd/core/src/store/selectionResolve';
import { CardActions } from './CardActions';
import { cardActions } from './cardModels';

const kid = (id: string, childType: AnyChild['childType'], extra: Record<string, unknown> = {}): AnyChild =>
  ({
    id, name: id, childType, visible: true, position: { x: 1, y: 1 }, rotation: 0, scale: 1, width: 1, height: 1,
    flipX: false, flipY: false, contours: [[[0, 0], [1, 0], [1, 1]]], shape: { kind: 'point', position: { x: 0, y: 0 } },
    radius: 1, wallId: '', ...extra,
  }) as unknown as AnyChild;
const wall = (id: string, extra: Partial<WallSegment> = {}): WallSegment =>
  ({ id, points: [[0, 0], [2, 0]], wallType: 'normal', direction: 'both', color: '#000', roughness: 0, ...extra }) as WallSegment;

function seed(children: AnyChild[], walls: WallSegment[] = [], rooms: DungeonLayer['rooms'] = []) {
  const layer = {
    id: 'l1', type: 'dungeon', name: 'Dungeon', visible: true, locked: false, opacity: 1, children, rooms,
    standaloneWalls: walls, mergedFloor: null, style: {},
  } as unknown as DungeonLayer;
  useStore.setState({ layers: [layer] });
}

const actionsFor = (ids: string[]) => cardActions(resolveSelection(useStore.getState(), ids));

describe('card action row', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
    undoManager.clear();
  });
  afterEach(cleanup);

  it('a prop gets every verb', () => {
    seed([kid('p', 'asset')]);
    expect(actionsFor(['p'])).toEqual(['flipH', 'flipV', 'rotate', 'duplicate', 'lock', 'hide', 'delete', 'more']);
  });

  it('a drawn wall flips, turns and duplicates like anything else', () => {
    seed([], [wall('w')]);
    expect(actionsFor(['w'])).toEqual(['flipH', 'flipV', 'rotate', 'duplicate', 'lock', 'hide', 'delete', 'more']);
  });

  it('a light has nothing to flip or turn', () => {
    seed([kid('l', 'light')]);
    expect(actionsFor(['l'])).toEqual(['duplicate', 'lock', 'hide', 'delete', 'more']);
  });

  it('a label turns but does not flip', () => {
    seed([kid('t', 'text')]);
    expect(actionsFor(['t'])).toEqual(['rotate', 'duplicate', 'lock', 'hide', 'delete', 'more']);
  });

  it('water flips and turns', () => {
    seed([kid('w', 'water')]);
    expect(actionsFor(['w'])).toContain('flipH');
    expect(actionsFor(['w'])).toContain('rotate');
  });

  it('a zone turns, never flips', () => {
    seed([kid('z', 'zone')]);
    const a = actionsFor(['z']);
    expect(a).toContain('rotate');
    expect(a).not.toContain('flipH');
  });

  it('rooms alone get Delete and the menu only', () => {
    seed([], [], [{ id: 'r', name: 'Hall', anchor: [0, 0] }]);
    expect(actionsFor(['r'])).toEqual(['delete', 'more']);
  });

  it('doors alone get Delete and the menu only', () => {
    seed([kid('d', 'door')]);
    expect(actionsFor(['d'])).toEqual(['delete', 'more']);
  });

  it('a locked selection gets Unlock and the menu, no Delete', () => {
    seed([kid('p', 'asset', { locked: true })], [wall('w', { locked: true })]);
    expect(actionsFor(['p', 'w'])).toEqual(['unlock', 'more']);
  });

  it('a partly locked selection offers both Lock and Unlock', () => {
    seed([kid('p', 'asset', { locked: true }), kid('q', 'asset')]);
    const a = actionsFor(['p', 'q']);
    expect(a).toContain('lock');
    expect(a).toContain('unlock');
    expect(a).toContain('delete');
  });

  it('a mix of a door and a prop duplicates (the door is skipped, not the verb)', () => {
    seed([kid('d', 'door'), kid('p', 'asset')]);
    expect(actionsFor(['d', 'p'])).toContain('duplicate');
  });

  it('nothing selected, no row', () => {
    seed([kid('p', 'asset')]);
    expect(actionsFor([])).toEqual([]);
  });

  it('renders the buttons with their keys in the tooltip', () => {
    seed([kid('p', 'asset')]);
    useStore.getState().setSelectedIds(['p']);
    render(<CardActions />);
    expect(screen.getByTestId('v2-sel-act-duplicate').getAttribute('data-tip-key')).toBe('Ctrl D');
    expect(screen.getByTestId('v2-sel-act-rotate').getAttribute('data-tip-key')).toBe('Shift R');
  });

  it('Lock in the row locks the selection in one undo step', () => {
    seed([kid('p', 'asset')]);
    useStore.getState().setSelectedIds(['p']);
    useStore.getState().setActiveTool('select');
    render(<CardActions />);
    fireEvent.click(screen.getByTestId('v2-sel-act-lock'));
    const layer = useStore.getState().layers[0] as DungeonLayer;
    expect(layer.children[0].locked).toBe(true);
    expect(screen.getByTestId('v2-sel-act-unlock')).toBeTruthy();
    undoManager.undo();
    expect((useStore.getState().layers[0] as DungeonLayer).children[0].locked).toBeFalsy();
  });

  const ids = (group: HTMLElement | null) =>
    [...(group?.querySelectorAll('button') ?? [])].map((b) => b.getAttribute('data-testid')!.replace('v2-sel-act-', ''));

  it('a room’s row is the right group only: Delete never sits where Flip H does', () => {
    seed([], [], [{ id: 'r', name: 'Hall', anchor: [0, 0] }]);
    useStore.getState().setSelectedIds(['r']);
    render(<CardActions />);
    expect(screen.queryByTestId('v2-sel-acts-left')).toBeNull();
    expect(ids(screen.getByTestId('v2-sel-acts-right'))).toEqual(['delete', 'more']);
  });

  it('a prop’s row keeps Delete second from the right, after the left group', () => {
    seed([kid('p', 'asset')]);
    useStore.getState().setSelectedIds(['p']);
    render(<CardActions />);
    expect(ids(screen.getByTestId('v2-sel-acts-left'))).toEqual(['flipH', 'flipV', 'rotate', 'duplicate', 'lock', 'hide']);
    const all = ids(screen.getByTestId('v2-sel-actions'));
    expect(all.at(-2)).toBe('delete');
    expect(all.at(-1)).toBe('more');
  });
});
