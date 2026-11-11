import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Container } from 'pixi.js';
import { MaterialTool } from './MaterialTool';
import { useStore } from '../../store/store';
import { undoManager } from '../../store/undoManager';
import { setClipperModule } from '../../geometry/Clipper2Engine';
import { patchArea } from '../../shared/materialPatch';
import type { RenderEngine } from '../RenderEngine';
import type { DungeonLayer } from '../../store/types';

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

  it('paints a patch whose edge is a wall by default, and one that is not with the switch off', () => {
    stroke(tool, [[0, 0], [3, 0]]);
    expect(layer().materials![0].wall).toBe(true);
    useStore.setState((s) => {
      s.tools.settings.material.wall = false;
    });
    stroke(tool, [[20, 0], [23, 0]]);
    expect(layer().materials![1].wall).toBeUndefined();
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
