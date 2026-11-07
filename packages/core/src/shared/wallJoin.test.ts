import { describe, it, expect, beforeEach } from 'vitest';
import { autoJoin, joinPoints, joinRefusal, mergeWalls } from './wallJoin';
import { useStore } from '../store/store';
import { undoManager } from '../store/undoManager';
import { MergeWallsCommand } from '../store/commands';
import { WallTool } from '../engine/tools/WallTool';
import type { DoorChild, DungeonLayer, DungeonStyle, WallSegment } from '../store/types';

const style = { wallTextureSetId: 'GG_Fieldstone', wallTextureTint: '#ffffff', wallWidth: 0.5 } as DungeonStyle;

const wall = (id: string, points: [number, number][], over: Partial<WallSegment> = {}): WallSegment => ({
  id,
  points,
  wallType: 'normal',
  direction: 'both',
  color: '#000000',
  roughness: 0,
  ...over,
});

const door = (id: string, wallId: string, position: [number, number]): DoorChild => ({
  id,
  name: id,
  childType: 'door',
  visible: true,
  wallId,
  position,
  angle: 0,
  width: 1,
  style: 'single',
  state: 'closed',
  isSecret: false,
});

describe('joining two walls end to end', () => {
  it("keeps the first wall's direction whichever end of the second touches", () => {
    expect(joinPoints([[0, 0], [4, 0]], [[4, 0], [4, 3]])?.points).toEqual([[0, 0], [4, 0], [4, 3]]);
    expect(joinPoints([[0, 0], [4, 0]], [[4, 3], [4, 0]])?.points).toEqual([[0, 0], [4, 0], [4, 3]]);
    expect(joinPoints([[0, 0], [4, 0]], [[0, 3], [0, 0]])?.points).toEqual([[0, 3], [0, 0], [4, 0]]);
    expect(joinPoints([[0, 0], [4, 0]], [[9, 9], [8, 8]])).toBeNull();
  });

  it('closes into a loop whose last point is its first when both ends meet', () => {
    const j = joinPoints([[0, 0], [4, 0], [4, 4]], [[4, 4], [0, 4], [0, 0.0005]]);
    expect(j?.points.at(-1)).toEqual([0, 0]);
  });

  it("merges into the first wall's id and moves each wall's stone edits onto its own stretch", () => {
    const a = wall('a', [[0, 0], [4, 0]], { nodeEdits: [{ t: 0.5, rotate: 1 }] });
    const b = wall('b', [[8, 0], [4, 0]], { nodeEdits: [{ t: 0.25, scale: 2 }] });
    const m = mergeWalls(a, b, style)!;
    expect(m.id).toBe('a');
    expect(m.points).toEqual([[0, 0], [4, 0], [8, 0]]);
    // a's middle is a quarter of the way along; b ran backwards, so its t 0.25 lands at 7 of 8.
    expect(m.nodeEdits?.map((e) => e.t)).toEqual([0.25, 0.875]);
  });
});

describe('when Merge is enabled', () => {
  const a = wall('a', [[0, 0], [4, 0]]);
  it('needs a shared endpoint, the same type and the same set', () => {
    expect(joinRefusal(a, wall('b', [[4, 0], [4, 4]]), style)).toBeNull();
    expect(joinRefusal(a, wall('b', [[5, 0], [9, 0]]), style)).toBe('not touching at an end');
    expect(joinRefusal(a, wall('b', [[4, 0], [4, 4]], { wallType: 'window' }), style)).toBe('different types');
    expect(joinRefusal(a, wall('b', [[4, 0], [4, 4]], { textureSetId: 'GG_Palisade' }), style)).toBe('different sets');
    expect(joinRefusal(a, wall('b', [[4, 0], [4, 4]], { locked: true }), style)).toBe('one is locked');
  });

  it('refuses a one-sided wall that would face the other way once joined', () => {
    const left = wall('a', [[0, 0], [4, 0]], { direction: 'left' });
    expect(joinRefusal(left, wall('b', [[4, 0], [8, 0]], { direction: 'left' }), style)).toBeNull();
    expect(joinRefusal(left, wall('b', [[8, 0], [4, 0]], { direction: 'left' }), style)).toBe('facing different ways');
    expect(joinRefusal(left, wall('b', [[8, 0], [4, 0]], { direction: 'right' }), style)).toBeNull();
  });
});

describe('the Merge command', () => {
  const layer = () => useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;

  beforeEach(() => {
    undoManager.clear();
    useStore.getState().resetToDefault();
    const id = layer().id;
    useStore.getState().setActiveLayerId(id);
    useStore.setState((s) => {
      const l = s.layers.find((x) => x.id === id) as DungeonLayer;
      l.style.wallTextureSetId = 'GG_Fieldstone';
      l.standaloneWalls = [wall('a', [[0, 0], [4, 0]]), wall('x', [[20, 20], [21, 20]]), wall('b', [[4, 0], [4, 6]])];
      l.children = [door('d1', 'a', [2, 0]), door('d2', 'b', [4, 3])];
    });
  });

  it('leaves one wall with the first id, the doors where they were, and one undo restores both', () => {
    const l = layer();
    const merged = mergeWalls(l.standaloneWalls[0], l.standaloneWalls[2], l.style)!;
    undoManager.execute(new MergeWallsCommand('Merge walls', l.id, merged, ['b']));
    expect(layer().standaloneWalls.map((w) => w.id)).toEqual(['a', 'x']);
    expect(layer().standaloneWalls[0].points).toEqual([[0, 0], [4, 0], [4, 6]]);
    const doors = layer().children as DoorChild[];
    expect(doors.map((d) => [d.wallId, d.position])).toEqual([['a', [2, 0]], ['a', [4, 3]]]);

    undoManager.undo();
    expect(layer().standaloneWalls.map((w) => w.id)).toEqual(['a', 'x', 'b']);
    expect(layer().standaloneWalls[0].points).toEqual([[0, 0], [4, 0]]);
    expect((layer().children as DoorChild[]).map((d) => d.wallId)).toEqual(['a', 'b']);
  });

  it('auto-joins a wall drawn from a free end into that wall, as one undo step; off, two walls touch', () => {
    const tool = new WallTool();
    const draw = (pts: [number, number][]) => {
      for (const [x, y] of pts) tool.onPointerDown({ x, y });
      tool.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }));
    };
    draw([[4, 6], [0, 6]]);
    expect(layer().standaloneWalls.map((w) => w.id)).toEqual(['a', 'x', 'b']);
    expect(layer().standaloneWalls[2].points).toEqual([[4, 0], [4, 6], [0, 6]]);
    undoManager.undo();
    expect(layer().standaloneWalls[2].points).toEqual([[4, 0], [4, 6]]);

    draw([[0, 6], [0, 0]]);
    expect(layer().standaloneWalls.find((w) => w.id === 'a')?.points).toEqual([[0, 6], [0, 0], [4, 0]]);
    // Between two walls' free ends, the second joins too: here the four sides close a loop.
    draw([[4, 6], [0, 6]]);
    expect(layer().standaloneWalls.map((w) => w.id)).toEqual(['x', 'b']);
    expect(layer().standaloneWalls[1].points).toEqual([[4, 0], [4, 6], [0, 6], [0, 0], [4, 0]]);

    useStore.getState().updateToolSettings({ wallAutoJoin: false });
    draw([[21, 20], [25, 20]]);
    expect(layer().standaloneWalls).toHaveLength(3);
  });

  it('auto-joins only to a wall of the same set and type', () => {
    useStore.setState((s) => {
      const l = s.layers.find((x) => x.type === 'dungeon') as DungeonLayer;
      l.standaloneWalls[2].textureSetId = 'GG_Palisade';
    });
    const l = layer();
    const drawn = wall('n', [[4, 6], [0, 6]]);
    expect(autoJoin(drawn, l.standaloneWalls, l.style)).toBeNull();
    expect(autoJoin({ ...drawn, wallType: 'window' }, [wall('b', [[4, 0], [4, 6]])], l.style)).toBeNull();
  });
});
