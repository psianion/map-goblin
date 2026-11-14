// Erase only the selected piece: a brush picked from Select keeps the floor pieces selected on
// the layer in hand, its erase keeps to them, and Escape lets them go.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Container } from 'pixi.js';
import { setClipperModule } from '../../geometry/Clipper2Engine';
import { useStore } from '../../store/store';
import { undoManager } from '../../store/undoManager';
import type { DungeonLayer, ShapeChild } from '../../store/types';
import type { Polygon } from '../../types/geometry';
import type { RenderEngine } from '../RenderEngine';
import { patchArea } from '../../shared/materialPatch';
import { computeMergedFloor } from '../mergedFloor';
import { MaterialTool } from './MaterialTool';
import { SelectTool } from './SelectTool';
import { ToolManager } from './ToolManager';
import { pieceRegion } from './eraseShapes';

beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  setClipperModule(await mod.default({ wasmBinary }));
}, 30_000);

const rect = (x0: number, y0: number, x1: number, y1: number): Polygon => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

function piece(id: string, ring: Polygon): ShapeChild {
  return {
    id, name: id, childType: 'shape', visible: true, shapeType: 'polygon', contours: [ring],
    textureScale: 1, textureOffsetX: 0, textureOffsetY: 0, textureFillRotation: 0, textureTint: '#ffffff',
    ground: true, textureId: 'pack:wild_grass_8x8_floor_A',
  };
}

const engine = {
  overlay: () => new Container(),
  canvas: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0 }) }) as unknown as HTMLCanvasElement,
  stage: () => ({ scale: { x: 1, y: 1 } }) as unknown as Container,
  worldToScreen: (x: number, y: number) => ({ x, y }),
} as unknown as RenderEngine;

const layer = () => useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
const area = (id: string) => patchArea(pieceRegion(layer().children.find((c) => c.id === id) as ShapeChild));

beforeEach(() => {
  undoManager.clear();
  useStore.getState().resetToDefault();
  useStore.setState((s) => {
    const l = s.layers.find((x) => x.type === 'dungeon') as DungeonLayer;
    // Two pieces over each other: 'under' first, 'over' on top.
    l.children = [piece('under', rect(0, 0, 10, 10)), piece('over', rect(0, 0, 10, 10))];
    l.mergedFloor = computeMergedFloor(l as DungeonLayer);
    s.ui.activeLayerId = l.id;
    Object.assign(s.tools.settings.material, { radius: 1, feather: 0, strength: undefined, smooth: false });
  });
});

describe('a brush picked from Select', () => {
  it('keeps the selected piece, erases only it, and Escape lets it go', () => {
    const tm = new ToolManager(new Container());
    const brush = new MaterialTool(engine, new Container());
    tm.registerTool(new SelectTool(engine));
    tm.registerTool(brush);
    tm.switchTool('select');
    useStore.getState().setSelectedIds(['under']);
    useStore.getState().setActiveTool('material');
    tm.switchTool('material');
    expect(useStore.getState().selection.selectedIds).toEqual(['under']);

    useStore.getState().setEraseMode(true);
    const stroke = (x: number) => {
      brush.onPointerDown({ x, y: 5 });
      brush.onPointerMove({ x: x + 1, y: 5 });
      brush.onPointerUp();
    };
    stroke(3);
    // Under the top piece, yet it is the selected one that loses the stroke.
    expect(area('under')).toBeLessThan(100);
    expect(area('over')).toBeCloseTo(100);

    brush.onKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(useStore.getState().selection.selectedIds).toEqual([]);
    stroke(7);
    expect(area('over')).toBeLessThan(100);
  });

  it('lets go of the selection on a switch to any other tool', () => {
    const tm = new ToolManager(new Container());
    tm.registerTool(new SelectTool(engine));
    tm.switchTool('select');
    useStore.getState().setSelectedIds(['under']);
    tm.switchTool('rectangle');
    expect(useStore.getState().selection.selectedIds).toEqual([]);
  });
});
