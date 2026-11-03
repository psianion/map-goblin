// The node editor for a plateau's ring, and a ring edited with it.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { setClipperModule } from '../geometry/Clipper2Engine';
import { setNotify } from '../store/notify';
import { useStore } from '../store/store';
import { undoManager } from '../store/undoManager';
import type { DungeonLayer, PlateauChild, ShapeChild } from '../store/types';
import {
  draggedHandles,
  insertHitAt,
  nodeHitAt,
  nodesToRing,
  plateauNodes,
  ringLine,
  type RingNode,
  endPlateauDrag,
  hoverPlateau,
  isDraggingPlateau,
  movePlateauDrag,
  pressPlateau,
  removeHoveredPlateauPoint,
  togglePlateauPointAt,
} from './ringNodeEdit';

const warning = vi.fn();

beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  setClipperModule(await mod.default({ wasmBinary }));
  setNotify({ success() {}, error() {}, warning, info() {} } as unknown as Parameters<typeof setNotify>[0]);
}, 30_000);

const square: RingNode[] = [
  { x: 0, y: 0, handles: null },
  { x: 4, y: 0, handles: { in: [-1, 0], out: [1, 0] } },
  { x: 4, y: 4, handles: null },
  { x: 0, y: 4, handles: null },
];

describe('the shared node editor', () => {
  it('finds a handle before its point, and a point within reach', () => {
    expect(nodeHitAt(square, { x: 5, y: 0.1 }, 0.3)).toEqual({ kind: 'handle', index: 1, which: 'out' });
    expect(nodeHitAt(square, { x: 4.05, y: 4 }, 0.3)).toEqual({ kind: 'point', index: 2 });
    expect(nodeHitAt(square, { x: 2, y: 2 }, 0.3)).toBeNull();
  });

  it('inserts on the line before the next node, the closing edge after the last', () => {
    const line = ringLine(square.map((n) => ({ ...n, handles: null })));
    expect(insertHitAt(line, 4, { x: 2, y: 0.1 }, 0.3)).toMatchObject({ kind: 'insert', index: 1, x: 2, y: 0 });
    expect(insertHitAt(line, 4, { x: 0.1, y: 2 }, 0.3)).toMatchObject({ kind: 'insert', index: 4 });
    expect(insertHitAt(line, 4, { x: 2, y: 2 }, 0.3)).toBeNull();
  });

  it('drags one handle, or pulls both out mirrored', () => {
    expect(draggedHandles(square[1], { x: 4, y: 2 }, 'out', false).handles).toEqual({ in: [-1, 0], out: [0, 2] });
    expect(draggedHandles(square[1], { x: 4, y: 2 }, 'out', true).handles).toEqual({ in: [-0, -2], out: [0, 2] });
    expect(draggedHandles(square[0], { x: 1, y: 1 }, 'out', false).handles).toEqual({ in: [-1, -1], out: [1, 1] });
  });

  it('reads a plateau ring as nodes (tangents absolute, handles relative) and writes it back', () => {
    const ring = nodesToRing(square);
    expect(ring.contours).toEqual([[[0, 0], [4, 0], [4, 4], [0, 4]]]);
    expect(ring.tangents?.[0][1]).toEqual({ tin: [3, 0], tout: [5, 0] });
    expect(plateauNodes(ring)).toEqual(square);
    expect(nodesToRing(square.map((n) => ({ ...n, handles: null }))).tangents).toBeUndefined();
    // A transform is folded in.
    const moved = plateauNodes({ contours: [[[0, 0], [1, 0], [1, 1]]], transform: { translate: [10, 0], rotate: 0, scale: [1, 1] } });
    expect(moved.map((n) => n.x)).toEqual([10, 11, 11]);
  });
});

function shape(id: string, x0: number, y0: number, x1: number, y1: number): ShapeChild {
  return {
    id, name: id, childType: 'shape', visible: true, shapeType: 'rectangle',
    contours: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]],
    textureScale: 1, textureOffsetX: 0, textureOffsetY: 0, textureFillRotation: 0, textureTint: '#ffffff',
  };
}

describe("a plateau's ring under the Select tool", () => {
  const layer = () => useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
  const mesa = () => layer().children.find((c): c is PlateauChild => c.id === 'mesa')!;
  const settle = () => new Promise((r) => setTimeout(r, 0));

  beforeEach(() => {
    useStore.getState().resetToDefault();
    undoManager.clear();
    warning.mockClear();
    const id = layer().id;
    useStore.getState().addChild(id, shape('ground', 0, 0, 20, 20));
    useStore.getState().addChild(id, {
      id: 'mesa', name: 'Mesa', childType: 'plateau', visible: true,
      contours: [[[4, 4], [8, 4], [8, 8], [4, 8]]], height: 2, edge: 'cliff',
    } as PlateauChild);
    useStore.setState((s) => {
      s.tools.activeTool = 'select';
      s.grid.snapEnabled = false;
    });
    useStore.getState().setSelectedIds(['mesa']);
  });

  it('drags a point to reshape it, as one undo step', async () => {
    expect(pressPlateau({ x: 8, y: 8 }, 20, { alt: false })).toBe(true);
    expect(isDraggingPlateau()).toBe(true);
    movePlateauDrag({ x: 10, y: 11 });
    expect(mesa().contours[0][2]).toEqual([10, 11]);
    endPlateauDrag();
    await settle();
    expect(mesa().contours[0][2]).toEqual([10, 11]);
    undoManager.undo();
    expect(mesa().contours[0][2]).toEqual([8, 8]);
  });

  it('puts a drag that leaves the ground back, with the toast', async () => {
    pressPlateau({ x: 8, y: 8 }, 20, { alt: false });
    movePlateauDrag({ x: 60, y: 60 });
    endPlateauDrag();
    await settle();
    expect(mesa().contours[0][2]).toEqual([8, 8]);
    expect(warning).toHaveBeenCalledWith('A plateau needs ground under it');
    expect(undoManager.canUndo()).toBe(false);
  });

  it('inserts a point on its edge, removes a hovered one, and turns one smooth', async () => {
    pressPlateau({ x: 6, y: 4 }, 20, { alt: false });
    await settle();
    expect(mesa().contours[0]).toHaveLength(5);
    hoverPlateau({ x: 6, y: 4 }, 20);
    expect(removeHoveredPlateauPoint()).toBe(true);
    await settle();
    expect(mesa().contours[0]).toHaveLength(4);
    expect(togglePlateauPointAt({ x: 8, y: 4 }, 20)).toBe(true);
    await settle();
    expect(mesa().tangents?.[0][1]).toBeTruthy();
    // A ring keeps three points.
    useStore.getState().updateChild(layer().id, 'mesa', { contours: [[[4, 4], [8, 4], [8, 8]]], tangents: undefined });
    hoverPlateau({ x: 8, y: 8 }, 20);
    removeHoveredPlateauPoint();
    await settle();
    expect(mesa().contours[0]).toHaveLength(3);
  });
});
