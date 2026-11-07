import { beforeEach, describe, expect, it } from 'vitest';
import { Container } from 'pixi.js';
import { WaterTool } from './WaterTool';
import { useStore } from '../../store/store';
import { undoManager } from '../../store/undoManager';
import { decodeWater } from '../../shared/waterMask';
import type { RenderEngine } from '../RenderEngine';
import type { DungeonLayer } from '../../store/types';

const engine = { stage: () => ({ scale: { x: 1 } }) } as unknown as RenderEngine;
const layer = () => useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
const wet = () => decodeWater(layer().water).data.reduce((n, v) => n + v, 0);

function stroke(tool: WaterTool, points: [number, number][]): void {
  const [x0, y0] = points[0];
  tool.onPointerDown({ x: x0, y: y0 });
  for (const [x, y] of points.slice(1)) tool.onPointerMove({ x, y });
  tool.onPointerUp();
}

describe('WaterTool', () => {
  let tool: WaterTool;

  beforeEach(() => {
    useStore.getState().resetToDefault();
    useStore.getState().setActiveLayerId(layer().id);
    undoManager.clear();
    tool = new WaterTool(engine, new Container());
  });

  it('paints the layer in hand with the panel look, one undo step a stroke', () => {
    stroke(tool, [[0, 0], [2, 0], [4, 0]]);
    const water = layer().water!;
    expect(water).toMatchObject({ shallow: '#9db7bd', deep: '#5f8a93', blend: 1.5, border: true });
    const painted = wet();
    expect(painted).toBeGreaterThan(0);
    stroke(tool, [[10, 0], [11, 0]]);
    expect(wet()).toBeGreaterThan(painted);
    undoManager.undo();
    expect(wet()).toBe(painted);
    undoManager.undo();
    expect(layer().water).toBeUndefined();
    expect(undoManager.canUndo()).toBe(false);
  });

  it('erases with Erase mode, and drying all of it leaves the layer dry', () => {
    stroke(tool, [[0, 0]]);
    useStore.getState().setEraseMode(true);
    stroke(tool, [[0, 0]]);
    expect(layer().water).toBeUndefined();
    undoManager.undo();
    expect(wet()).toBeGreaterThan(0);
  });

  it('keeps the layer\'s own look on later strokes', () => {
    stroke(tool, [[0, 0]]);
    useStore.setState((s) => {
      s.tools.settings.water.deep = '#000000';
    });
    stroke(tool, [[5, 0]]);
    expect(layer().water!.deep).toBe('#5f8a93');
  });

  it('commits nothing for a stroke that changes nothing, or one Escape drops', () => {
    useStore.getState().setEraseMode(true);
    stroke(tool, [[0, 0]]);
    expect(undoManager.canUndo()).toBe(false);
    useStore.getState().setEraseMode(false);
    tool.onPointerDown({ x: 0, y: 0 });
    tool.cancel();
    tool.onPointerUp();
    expect(layer().water).toBeUndefined();
    expect(undoManager.canUndo()).toBe(false);
  });
});
