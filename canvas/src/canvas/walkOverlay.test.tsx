import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { Container, Graphics } from 'pixi.js';
import { SOLID, STANDABLE } from '@dnd/mechanics/tokens';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import type { DungeonLayer } from '@/store/types';
import type { RenderEngine } from '@/engine/RenderEngine';
import { resetShell, useShell } from '@/editor/shell/shellStore';
import { TopActions } from '@/editor/surfaces/TopActions';
import { editorWalkGrid, mountWalkOverlay, walkMarks, type WalkOverlayHandle } from './walkOverlay';

/*
 * A 4 by 4 room on a 6 by 6 map, split down x = 2 by one stone wall with a shut door in it
 * at rows 1 to 2. The view washes everything off the floor and bars the wall's four cell
 * edges, the door's one drawn as a door.
 */

const ring: [number, number][] = [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
];

function layer(): DungeonLayer {
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon');
  if (!l) throw new Error('no dungeon layer');
  return l;
}

function drawRoom(doorState: 'closed' | 'open' = 'closed'): void {
  const room = layer();
  const door = { id: 'd1', childType: 'door', visible: true, wallId: 'w1', position: [2, 1.5], angle: 90, width: 1, style: 'single', state: doorState, isSecret: false, name: 'Door 1' };
  const wall = { id: 'w1', points: [[2, 0], [2, 4]], wallType: 'normal', direction: 'both', color: '#000', width: 0.5, roughness: 0 };
  const next = {
    ...room,
    children: [door],
    standaloneWalls: [wall],
    mergedFloor: [ring],
    rooms: [{ id: 'r1', name: 'Hall', number: 1, anchor: [1, 1], face: ring }],
  } as unknown as DungeonLayer;
  useStore.setState((s) => ({
    mapSettings: { ...s.mapSettings, ground: null, fixedSize: { width: 6, height: 6, locked: true } },
    layers: s.layers.map((l) => (l.id === room.id ? next : l)),
  }));
}

beforeEach(() => {
  undoManager.clear();
  useStore.getState().resetToDefault();
  resetShell();
  drawRoom();
});

describe('the Walkable cells view', () => {
  it('reads the level being edited into the table’s grid, the shut door as saved', () => {
    const grid = editorWalkGrid(useStore.getState())!;
    expect([grid.cols, grid.rows]).toEqual([6, 6]);
    const at = (x: number, y: number) => grid.cell[y * grid.cols + x];
    expect(at(0, 0)).toBe(STANDABLE);
    expect(at(3, 3)).toBe(STANDABLE);
    expect(at(4, 0)).not.toBe(STANDABLE);
    expect(at(5, 5)).not.toBe(STANDABLE);
    expect(grid.cell.includes(SOLID)).toBe(false);
  });

  it('washes every cell off the floor and bars the wall’s edges, the door’s as a door', () => {
    const grid = editorWalkGrid(useStore.getState())!;
    const { washed, bars } = walkMarks(grid);
    const off: number[] = [];
    for (let i = 0; i < 36; i++) if (i % 6 >= 4 || Math.floor(i / 6) >= 4) off.push(i);
    expect(washed).toEqual(off);
    expect(washed.every((i) => grid.cell[i] !== STANDABLE)).toBe(true);
    expect(bars).toEqual([
      { x1: 2, y1: 0, x2: 2, y2: 1, door: false },
      { x1: 2, y1: 1, x2: 2, y2: 2, door: true },
      { x1: 2, y1: 2, x2: 2, y2: 3, door: false },
      { x1: 2, y1: 3, x2: 2, y2: 4, door: false },
    ]);
  });

  it('drops the door’s bar when the door is saved open', () => {
    drawRoom('open');
    expect(walkMarks(editorWalkGrid(useStore.getState())!).bars.map((b) => b.y1)).toEqual([0, 2, 3]);
  });

  it('keeps a secret door shut, drawn as a door', () => {
    useStore.setState((s) => ({
      layers: s.layers.map((l) =>
        l.type === 'dungeon' ? { ...l, children: l.children.map((c) => (c.childType === 'door' ? { ...c, state: 'open' as const, isSecret: true } : c)) } : l,
      ),
    }));
    expect(walkMarks(editorWalkGrid(useStore.getState())!).bars.filter((b) => b.door).map((b) => b.y1)).toEqual([1]);
  });
});

describe('the View group’s switch', () => {
  afterEach(cleanup);

  it('turns the view on and off, and saves nothing with the map', async () => {
    const actions = { openExport: () => {}, openPublish: () => {}, importImage: () => {}, importTrace: () => {} };
    const layers = useStore.getState().layers;
    const { getByTestId, findByRole } = render(<TopActions actions={actions} onOpenSettings={() => {}} />);
    fireEvent.click(getByTestId('shell-more'));
    const item = await findByRole('menuitemcheckbox', { name: 'Walkable cells' });
    expect(item.getAttribute('aria-checked')).toBe('false');
    // A View switch keeps the menu open, as the others do.
    await act(async () => fireEvent.click(item));
    expect(useShell.getState().walkView).toBe(true);
    expect(item.getAttribute('aria-checked')).toBe('true');
    await act(async () => fireEvent.click(item));
    expect(useShell.getState().walkView).toBe(false);
    expect(useStore.getState().layers).toBe(layers);
  });
});

describe('mountWalkOverlay', () => {
  let frame: (() => void) | null = null;
  let world: Container;
  let screen: Container;
  let overlay: WalkOverlayHandle;
  const tick = () => frame?.();

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      frame = cb;
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    world = new Container();
    world.scale.set(20);
    screen = new Container();
    screen.addChild(new Graphics()); // the lighting composite stands first
    const engine = { stage: () => world, overlay: () => screen, ticker: () => ({ add: () => {}, remove: () => {} }) } as unknown as RenderEngine;
    overlay = mountWalkOverlay(engine);
  });

  afterEach(() => {
    overlay.destroy();
    vi.unstubAllGlobals();
  });

  it('reads nothing while the switch is off', () => {
    tick();
    drawRoom('open');
    tick();
    expect(overlay.reads()).toBe(0);
    expect(overlay.marks()).toBeNull();
  });

  it('reads the grid once when switched on, again only when the map changes', () => {
    useShell.getState().setWalkView(true);
    tick();
    expect(overlay.reads()).toBe(1);
    expect(overlay.marks()!.bars).toHaveLength(4);
    world.scale.set(40);
    tick();
    expect(overlay.reads()).toBe(1);
    drawRoom('open');
    tick();
    expect(overlay.reads()).toBe(2);
    expect(overlay.marks()!.bars).toHaveLength(3);
    useShell.getState().setWalkView(false);
    tick();
    expect(overlay.marks()).toBeNull();
    expect((screen.children[1] as Container).label).toBe('walkOverlay');
  });
});
