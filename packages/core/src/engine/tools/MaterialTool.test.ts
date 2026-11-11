import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Container } from 'pixi.js';
import { MaterialTool } from './MaterialTool';
import { useStore } from '../../store/store';
import { undoManager } from '../../store/undoManager';
import { setClipperModule } from '../../geometry/Clipper2Engine';
import { patchArea } from '../../shared/materialPatch';
import type { RenderEngine } from '../RenderEngine';
import type { DungeonLayer, ShapeChild } from '../../store/types';

beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  setClipperModule(await mod.default({ wasmBinary }));
}, 30_000);

const engine = { stage: () => ({ scale: { x: 1 } }) } as unknown as RenderEngine;
const layer = () => useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;

function stroke(tool: MaterialTool, points: [number, number][]): void {
  tool.onPointerDown({ x: points[0][0], y: points[0][1] });
  for (const [x, y] of points.slice(1)) tool.onPointerMove({ x, y });
  tool.onPointerUp();
}

describe('MaterialTool', () => {
  let tool: MaterialTool;

  beforeEach(() => {
    useStore.getState().resetToDefault();
    useStore.getState().setActiveLayerId(layer().id);
    undoManager.clear();
    // The patch cases: Paint a real floor (on by default) has its own block below.
    useStore.setState((s) => {
      s.tools.settings.material.floor = false;
    });
    tool = new MaterialTool(engine, new Container());
  });

  it('closes a stroke into one patch of the material in hand, one undo step', () => {
    stroke(tool, [[0, 0], [3, 0], [6, 0]]);
    const [patch] = layer().materials!;
    expect(patch).toMatchObject({ material: 'GG_Cave_Ink', smooth: true, border: true });
    expect(patchArea(patch.rings)).toBeCloseTo(6 * 6 + Math.PI * 9, 0);
    stroke(tool, [[6, 0], [12, 0]]);
    expect(layer().materials).toHaveLength(1);
    undoManager.undo();
    expect(patchArea(layer().materials![0].rings)).toBeCloseTo(6 * 6 + Math.PI * 9, 0);
    undoManager.undo();
    expect(layer().materials).toBeUndefined();
  });

  describe('with Paint a real floor on', () => {
    const floors = () => layer().children.filter((c): c is ShapeChild => c.childType === 'shape');
    beforeEach(() => {
      useStore.setState((s) => {
        s.tools.settings.material.floor = true;
      });
    });

    it('lands a stroke as one cave floor pinned to the band, no patch, one undo step', () => {
      stroke(tool, [[0, 0], [3, 0], [6, 0]]);
      expect(layer().materials).toBeUndefined();
      expect(floors()).toHaveLength(1);
      expect(floors()[0]).toMatchObject({ name: 'Cave 1', shapeType: 'polygon', styleOverrides: { wallTextureSetId: 'GG_Cave_Ink' } });
      expect(patchArea(floors()[0].contours)).toBeCloseTo(6 * 6 + Math.PI * 9, -1);
      undoManager.undo();
      expect(floors()).toHaveLength(0);
    });

    it('merges a stroke into the floors of the same look it touches, keeping the first one’s id and name', () => {
      stroke(tool, [[0, 0], [6, 0]]);
      stroke(tool, [[20, 0], [26, 0]]);
      expect(floors().map((f) => f.name)).toEqual(['Cave 1', 'Cave 2']);
      const [a] = floors();
      stroke(tool, [[6, 0], [20, 0]]);
      expect(floors()).toHaveLength(1);
      expect(floors()[0]).toMatchObject({ id: a.id, name: 'Cave 1' });
      expect(floors()[0].contours).toHaveLength(1);
      undoManager.undo();
      expect(floors()).toHaveLength(2);
    });

    it('keeps a stroke with Border off its own floor, pinned to no stone', () => {
      stroke(tool, [[0, 0], [6, 0]]);
      useStore.setState((s) => {
        s.tools.settings.material.border = false;
      });
      stroke(tool, [[3, 0], [10, 0]]);
      expect(floors().map((f) => f.styleOverrides?.wallTextureSetId)).toEqual(['GG_Cave_Ink', '']);
    });

    it('carves an erase out of the floors under it, one undo step', () => {
      stroke(tool, [[0, 0], [12, 0]]);
      const before = patchArea(floors()[0].contours);
      useStore.getState().setEraseMode(true);
      stroke(tool, [[6, -5], [6, 5]]);
      expect(floors()).toHaveLength(2);
      expect(floors().reduce((n, f) => n + patchArea(f.contours), 0)).toBeLessThan(before);
      undoManager.undo();
      expect(floors()).toHaveLength(1);
    });
  });

  it('erases with Erase mode, and an erase that takes it all leaves none', () => {
    stroke(tool, [[0, 0]]);
    useStore.getState().setEraseMode(true);
    stroke(tool, [[0, 0], [0.5, 0]]);
    expect(layer().materials).toBeUndefined();
    undoManager.undo();
    expect(layer().materials).toHaveLength(1);
  });

  it('commits nothing for an erase over bare ground, or a stroke Escape drops', () => {
    useStore.getState().setEraseMode(true);
    stroke(tool, [[0, 0]]);
    useStore.getState().setEraseMode(false);
    tool.onPointerDown({ x: 0, y: 0 });
    tool.cancel();
    tool.onPointerUp();
    expect(layer().materials).toBeUndefined();
    expect(undoManager.canUndo()).toBe(false);
  });
});
