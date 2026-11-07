import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PathTool } from './PathTool';
import { useStore } from '../../store/store';
import { undoManager } from '../../store/undoManager';
import { setNotify } from '../../store/notify';
import { getAssetPackManager, resetAssetPackManager } from '../assetPackInstance';
import type { ManifestEntry, PackManifest } from '../assetPackManager';
import { editedPath, endPathDrag, movePathDrag, pressPath } from '../pathNodeEdit';
import type { DungeonLayer, PathwayChild } from '../../store/types';
import { snapshotChild, transformChild } from './childTransform';

const piece = (set: string): ManifestEntry => ({
  type: 'wall',
  material: `${set}_Straight_Path`,
  gridSize: '8x1',
  pieceType: 'path',
  variant: 'A',
  set,
  tags: [],
});

const warning = vi.fn();

beforeAll(() => {
  resetAssetPackManager();
  const cache = (getAssetPackManager() as unknown as { manifestCache: Map<string, PackManifest> }).manifestCache;
  cache.set('forge', {
    name: 'forge',
    description: '',
    version: '1.0.0',
    bundleSize: 0,
    atlases: {},
    files: {},
    entries: { fieldstone_path: piece('GG_Fieldstone'), palisade_path: piece('GG_Palisade') },
  });
  setNotify({ success() {}, error() {}, warning, info() {} } as unknown as Parameters<typeof setNotify>[0]);
});

const layer = () => useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
const paths = () => layer().children.filter((c): c is PathwayChild => c.childType === 'pathway');
const key = (k: string, shiftKey = false) => ({ key: k, shiftKey }) as KeyboardEvent;

function draw(tool: PathTool, nodes: [number, number][]): void {
  for (const [x, y] of nodes) {
    tool.onPointerMove({ x, y });
    tool.onPointerDown({ x, y });
    tool.onPointerUp();
  }
  tool.onKeyDown(key('Enter'));
}

describe('PathTool', () => {
  let tool: PathTool;

  beforeEach(() => {
    useStore.getState().resetToDefault();
    useStore.getState().setActiveLayerId(layer().id);
    undoManager.clear();
    tool = new PathTool();
  });

  it('lays a path of the clicked nodes with the dock and panel settings, one undo step', () => {
    useStore.setState((s) => {
      s.tools.settings.path.width = 2;
      s.tools.settings.path.transitionOut = 'shrink';
    });
    draw(tool, [[0, 0], [5, 0], [5, 5]]);
    const [p] = paths();
    expect(p).toMatchObject({
      contours: [[[0, 0], [5, 0], [5, 5]]],
      pieceId: 'forge:fieldstone_path',
      width: 2,
      smoothness: 0.6,
      curve: false,
      transitionIn: 'fade',
      transitionOut: 'shrink',
      blocksLight: false,
    });
    undoManager.undo();
    expect(paths()).toHaveLength(0);
  });

  it('takes the piece picked in the dock, and Curve or a Shift end bends it', () => {
    useStore.setState((s) => {
      s.tools.settings.path.pieceId = 'forge:palisade_path';
    });
    useStore.getState().setCurveMode(true);
    draw(tool, [[0, 0], [4, 0]]);
    useStore.getState().setCurveMode(false);
    tool.onPointerDown({ x: 0, y: 2 });
    tool.onPointerDown({ x: 4, y: 2 });
    tool.onKeyDown(key('Enter', true));
    expect(paths().map((p) => [p.pieceId, p.curve])).toEqual([
      ['forge:palisade_path', true],
      ['forge:palisade_path', true],
    ]);
  });

  it('draws nothing from one node, and Escape drops a path in progress', () => {
    draw(tool, [[0, 0]]);
    tool.onPointerDown({ x: 0, y: 0 });
    tool.onPointerDown({ x: 3, y: 0 });
    expect(tool.getPreview()?.points.length).toBeGreaterThan(1);
    tool.onKeyDown(key('Escape'));
    tool.onKeyDown(key('Enter'));
    expect(paths()).toHaveLength(0);
    expect(undoManager.canUndo()).toBe(false);
  });
});

describe('path node mode', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
    useStore.getState().setActiveLayerId(layer().id);
    undoManager.clear();
    draw(new PathTool(), [[0, 0], [8, 0], [8, 8]]);
    undoManager.clear();
    useStore.getState().setActiveTool('select');
    useStore.setState((s) => {
      s.selection.selectedIds = [paths()[0].id];
      s.tools.pathNodeEditId = paths()[0].id;
    });
    useStore.getState().setSnapEnabled(false);
  });

  it('is the picked path with node mode on for it, and nothing once another is picked', () => {
    expect(editedPath()?.path.id).toBe(paths()[0].id);
    useStore.setState((s) => {
      s.selection.selectedIds = [];
    });
    expect(editedPath()).toBeNull();
  });

  it('moves a dragged node, one undo step', () => {
    expect(pressPath({ x: 8, y: 0 }, 20)).toBe(true);
    movePathDrag({ x: 9, y: 1 });
    movePathDrag({ x: 10, y: 2 });
    endPathDrag();
    expect(paths()[0].contours[0]).toEqual([[0, 0], [10, 2], [8, 8]]);
    undoManager.undo();
    expect(paths()[0].contours[0]).toEqual([[0, 0], [8, 0], [8, 8]]);
  });

  it('inserts a node where a midpoint handle is dragged, one undo step', () => {
    expect(pressPath({ x: 4, y: 0 }, 20)).toBe(true);
    movePathDrag({ x: 4, y: -3 });
    endPathDrag();
    expect(paths()[0].contours[0]).toEqual([[0, 0], [4, -3], [8, 0], [8, 8]]);
    undoManager.undo();
    expect(paths()[0].contours[0]).toEqual([[0, 0], [8, 0], [8, 8]]);
    expect(undoManager.canUndo()).toBe(false);
  });

  it('lets a press away from every handle fall through', () => {
    expect(pressPath({ x: 2, y: 5 }, 20)).toBe(false);
  });
});

describe('moving a path', () => {
  it('moves, turns and scales its nodes point by point, as any ring child', () => {
    const p = { id: 'p', name: 'Path', childType: 'pathway', visible: true, contours: [[[0, 0], [4, 0], [4, 2]]] } as unknown as PathwayChild;
    const snap = snapshotChild(p);
    expect(snap.kind).toBe('rings');
    const moved = transformChild(snap, { translateX: 2, translateY: 1, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0, anchorY: 0 });
    expect((moved as Partial<PathwayChild>).contours).toEqual([[[2, 1], [6, 1], [6, 3]]]);
  });
});
