import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { Container } from 'pixi.js';
import { OpeningTool, cliffSnap } from './OpeningTool';
import { useStore } from '../../store/store';
import { undoManager } from '../../store/undoManager';
import { createChildRemovalCommand } from '../../store/commands';
import { setNotify } from '../../store/notify';
import { setClipperModule } from '../../geometry/Clipper2Engine';
import { openingFrame } from '../../shared/plateaus';
import type { OpeningChild } from '../../shared/types';
import type { DungeonLayer, ShapeChild } from '../../store/types';

beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  setClipperModule(await mod.default({ wasmBinary }));
  setNotify({ success() {}, error() {}, warning() {}, info() {} } as unknown as Parameters<typeof setNotify>[0]);
}, 30_000);

function rect(id: string, x0: number, y0: number, x1: number, y1: number, extra: Partial<ShapeChild> = {}): ShapeChild {
  return {
    id,
    name: id,
    childType: 'shape',
    visible: true,
    shapeType: 'rectangle',
    contours: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]],
    textureScale: 1,
    textureOffsetX: 0,
    textureOffsetY: 0,
    textureFillRotation: 0,
    textureTint: '#ffffff',
    ...extra,
  };
}

function layer(): DungeonLayer {
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon');
  if (!l) throw new Error('default state has no dungeon layer');
  return l;
}

const openings = () => layer().children.filter((c): c is OpeningChild => c.childType === 'opening');

function click(tool: OpeningTool, x: number, y: number): void {
  tool.onPointerMove({ x, y });
  tool.onPointerDown({ x, y });
  tool.onPointerUp();
}

describe('OpeningTool', () => {
  let tool: OpeningTool;
  let ghost: Container;

  beforeEach(() => {
    undoManager.clear();
    useStore.getState().resetToDefault();
    const id = layer().id;
    for (const s of [
      rect('ground', 0, 0, 30, 30),
      rect('top', 10, 10, 16, 16, { height: 2, edge: 'cliff' }),
      rect('tower', 20, 20, 24, 24, { height: 2 }),
    ]) {
      useStore.getState().addChild(id, s);
    }
    const preview = new Container();
    tool = new OpeningTool(preview);
    ghost = preview.children[0] as Container;
  });

  it('snaps to a cliff edge, never to a raised room or the ground', () => {
    expect(cliffSnap(layer(), 13, 10.3)?.shapeId).toBe('top');
    expect(cliffSnap(layer(), 22, 20.2)).toBeNull();
    expect(cliffSnap(layer(), 0.1, 15)).toBeNull();
  });

  it('shows a ghost on the edge, then places stairs there, selected, as one undo step', () => {
    tool.onPointerMove({ x: 13, y: 10.2 });
    expect(ghost.children.length).toBe(1);
    click(tool, 13, 10.2);
    expect(openings()).toHaveLength(1);
    const [o] = openings();
    expect(o.kind).toBe('stairs');
    expect(o.shapeId).toBe('top');
    const frame = openingFrame(layer(), o)!;
    expect(frame.position[0]).toBeCloseTo(13);
    expect(frame.position[1]).toBeCloseTo(10);
    // Downhill points away from the plateau: north, off its top edge.
    expect(frame.downhill[1]).toBeCloseTo(-1);
    expect(useStore.getState().selection.selectedIds).toEqual([o.id]);
    undoManager.undo();
    expect(openings()).toHaveLength(0);
  });

  it('takes the kind and width from the tool settings', () => {
    useStore.getState().updateToolSettings({ opening: { kind: 'ladder', width: 1 } });
    click(tool, 16.2, 13);
    expect(openings()[0].kind).toBe('ladder');
    expect(openings()[0].width).toBe(1);
  });

  it('slides a placed opening along its ring as one undo step', () => {
    click(tool, 13, 10.2);
    const before = openings()[0].t;
    tool.onPointerMove({ x: 13, y: 10 });
    tool.onPointerDown({ x: 13, y: 10 });
    tool.onPointerMove({ x: 14.5, y: 9.8 });
    tool.onPointerUp();
    const moved = openingFrame(layer(), openings()[0])!;
    expect(moved.position[0]).toBeCloseTo(14.5);
    undoManager.undo();
    expect(openings()[0].t).toBeCloseTo(before);
  });

  it('takes the openings with the floor they sit on, and undo puts both back', () => {
    click(tool, 13, 10.2);
    undoManager.execute(createChildRemovalCommand(layer().id, 'top'));
    expect(openings()).toHaveLength(0);
    undoManager.undo();
    expect(openings()).toHaveLength(1);
    expect(layer().children.some((c) => c.id === 'top')).toBe(true);
  });

  it('deletes the selected opening', () => {
    click(tool, 13, 10.2);
    tool.onKeyDown(new KeyboardEvent('keydown', { key: 'Delete' }));
    expect(openings()).toHaveLength(0);
  });
});
