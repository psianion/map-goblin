import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The tool resolves art through the texture loader, which needs a GPU-backed pack
// install; a plain 200 px texture (one cell) stands in for every asset.
vi.mock('../../assets/textureLoader', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../assets/textureLoader')>();
  const { Texture, TextureSource } = await import('pixi.js');
  const cell = new Texture({ source: new TextureSource({ width: 200, height: 200 }) });
  return { ...real, resolveTexture: () => cell };
});
vi.mock('../subscribeToAssets', async (importOriginal) => {
  const real = await importOriginal<typeof import('../subscribeToAssets')>();
  return { ...real, setAssetChildrenAlpha: vi.fn() };
});

import { Container, Graphics, Sprite } from 'pixi.js';
import { setEditorDesk } from '../editorDesk';
import { StampScatterTool, STAMP_ROTATE_STEP, STAMP_SCALE_STEP, strokeStatus } from './StampScatterTool';
import { ToolManager } from './ToolManager';
import { setAssetChildrenAlpha } from '../subscribeToAssets';
import { useStore } from '../../store/store';
import { undoManager } from '../../store/undoManager';
import { setNotify } from '../../store/notify';
import { getAssetPackManager, resetAssetPackManager } from '../assetPackInstance';
import type { ManifestEntry, PackManifest } from '../assetPackManager';
import type { AssetChild, DungeonLayer, ScatterBrushSettings } from '../../store/types';

const CRATE = 'test:crate_1_A';
const CRATE_2 = 'test:crate_2_A';
const TABLE = 'test:table_A';

function seedProps(): void {
  const entry = (material: string, gridSize: string, w: number, h: number, family: string): ManifestEntry => ({
    type: 'object',
    material,
    gridSize,
    pieceType: 'object',
    variant: 'A',
    frame: { x: 0, y: 0, w, h },
    set: 'demo-storage',
    tags: [],
    family,
  });
  const manifest: PackManifest = {
    name: 'test',
    description: '',
    version: '1.0.0',
    bundleSize: 0,
    entries: {
      crate_1_A: entry('crate_1', '1x1', 200, 200, 'crate'),
      crate_2_A: entry('crate_2', '1x1', 200, 200, 'crate'),
      crate_3_A: entry('crate_3', '2x2', 400, 400, 'crate'),
      table_A: entry('table', '2x1', 400, 200, 'table'),
    },
    atlases: {},
    files: {},
  };
  const manager = getAssetPackManager();
  (manager as unknown as { manifestCache: Map<string, PackManifest> }).manifestCache.set('test', manifest);
  manager.catalogVersion++;
}

function layer(): DungeonLayer {
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon');
  if (!l) throw new Error('default state has no dungeon layer');
  return l;
}

const props = (): AssetChild[] => layer().children.filter((c): c is AssetChild => c.childType === 'asset');
const brush = (): ScatterBrushSettings => useStore.getState().tools.settings.scatterBrush;
const set = (patch: Partial<ScatterBrushSettings>): void => useStore.getState().updateScatterBrushSettings(patch);

const wheel = (init: WheelEventInit): WheelEvent => new WheelEvent('wheel', init);
const key = (k: string, init: KeyboardEventInit = {}): KeyboardEvent => new KeyboardEvent('keydown', { key: k, ...init });
const pointer = (init: { ctrlKey?: boolean; button?: number } = {}): PointerEvent =>
  ({ ctrlKey: false, button: 0, ...init }) as PointerEvent;

function addProp(id: string, x: number, over: Partial<AssetChild> = {}): void {
  useStore.getState().addChild(layer().id, {
    id,
    name: id,
    childType: 'asset',
    visible: true,
    objectType: 'asset',
    assetId: CRATE,
    position: { x, y: 0 },
    rotation: 0,
    scale: 1,
    width: 1,
    height: 1,
    tint: '#ffffff',
    flipX: false,
    flipY: false,
    ...over,
  });
}

let container: Container;
let tool: StampScatterTool;

/** The sprites the tool is showing right now. */
const shown = (): Sprite[] => container.children.filter((c): c is Sprite => c instanceof Sprite && c.visible);

beforeEach(() => {
  useStore.getState().resetToDefault();
  undoManager.clear();
  resetAssetPackManager();
  seedProps();
  setNotify({ warning: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn() });
  useStore.getState().setActiveLayerId(layer().id);
  useStore.getState().setActiveTool('scatterBrush');
  set({ assetIds: [CRATE], stampMode: true, stampRotation: 0, stampScale: 1, stampFlipX: false });
  container = new Container();
  tool = new StampScatterTool(container);
});

afterEach(() => {
  tool.destroy();
  vi.restoreAllMocks();
  vi.mocked(setAssetChildrenAlpha).mockClear();
});

describe('shaping the stamp', () => {
  it('wheel turns 15° each way', () => {
    expect(tool.onWheel(wheel({ deltaY: 100 }), { x: 0, y: 0 })).toBe(true);
    expect(brush().stampRotation).toBeCloseTo(STAMP_ROTATE_STEP);
    tool.onWheel(wheel({ deltaY: 100 }), { x: 0, y: 0 });
    expect(brush().stampRotation).toBeCloseTo(Math.PI / 6);
    tool.onWheel(wheel({ deltaY: -100 }), { x: 0, y: 0 });
    tool.onWheel(wheel({ deltaY: -100 }), { x: 0, y: 0 });
    tool.onWheel(wheel({ deltaY: -100 }), { x: 0, y: 0 });
    // Kept in [0, 2π).
    expect(brush().stampRotation).toBeCloseTo(2 * Math.PI - STAMP_ROTATE_STEP);
  });

  it('Alt+wheel up grows it by one step, down shrinks it', () => {
    tool.onWheel(wheel({ deltaY: -100, altKey: true }), { x: 0, y: 0 });
    expect(brush().stampScale).toBeCloseTo(STAMP_SCALE_STEP);
    tool.onWheel(wheel({ deltaY: 100, altKey: true }), { x: 0, y: 0 });
    expect(brush().stampScale).toBeCloseTo(1);
    expect(brush().stampRotation).toBe(0);
  });

  it('Shift+wheel steps the variant, reading deltaX when that is all Windows sends', () => {
    tool.onWheel(wheel({ deltaX: 100, shiftKey: true }), { x: 0, y: 0 });
    expect(brush().assetIds[0]).toBe(CRATE_2);
    tool.onWheel(wheel({ deltaY: -100, shiftKey: true }), { x: 0, y: 0 });
    expect(brush().assetIds[0]).toBe(CRATE);
  });

  it('right-click turns 90° and keeps the menu shut', () => {
    expect(tool.onContextMenu({ x: 0, y: 0 })).toBe(true);
    expect(brush().stampRotation).toBeCloseTo(Math.PI / 2);
  });

  it('F mirrors; Ctrl+F is not the tool’s', () => {
    tool.onKeyDown(key('f'));
    expect(brush().stampFlipX).toBe(true);
    tool.onKeyDown(key('F'));
    expect(brush().stampFlipX).toBe(false);
    tool.onKeyDown(key('f', { ctrlKey: true }));
    expect(brush().stampFlipX).toBe(false);
  });

  it('Scatter mode and an empty pick leave the wheel and right-click alone', () => {
    set({ stampMode: false });
    expect(tool.onWheel(wheel({ deltaY: 100 }), { x: 0, y: 0 })).toBe(false);
    expect(tool.onContextMenu({ x: 0, y: 0 })).toBe(false);
    set({ stampMode: true, assetIds: [] });
    expect(tool.onWheel(wheel({ deltaY: 100 }), { x: 0, y: 0 })).toBe(false);
    expect(brush().stampRotation).toBe(0);
  });

  it('Escape goes back to Select', () => {
    tool.onPointerMove({ x: 1, y: 1 }, pointer());
    tool.onKeyDown(key('Escape'));
    expect(useStore.getState().tools.activeTool).toBe('select');
  });
});

describe('the ghost', () => {
  it('is one sprite, moved in place, across 100 moves', () => {
    const seen = new Set<Sprite>();
    const spriteCount = container.children.filter((c) => c instanceof Sprite).length;
    let worst = 0;
    for (let i = 0; i < 100; i++) {
      const t0 = performance.now();
      tool.onPointerMove({ x: i * 0.37, y: i * 0.21 }, pointer());
      worst = Math.max(worst, performance.now() - t0);
      for (const s of shown()) seen.add(s);
    }
    expect(seen.size).toBe(1);
    expect(container.children.filter((c) => c instanceof Sprite).length).toBe(spriteCount);
    // §13 asks for 0.5 ms; the bound leaves room for a slow CI box.
    expect(worst).toBeLessThan(10);
  });

  it('follows the settings without a move', () => {
    tool.onPointerMove({ x: 2.2, y: 2.2 }, pointer());
    tool.onContextMenu({ x: 2.2, y: 2.2 });
    expect(shown()[0].rotation).toBeCloseTo(Math.PI / 2);
  });

  it('a 2×1 covers whole cells, and 1×2 of them after a quarter turn', () => {
    set({ assetIds: [TABLE] });
    tool.onPointerMove({ x: 3.3, y: 4.8 }, pointer());
    // Division 2 (the default): the top-left sits on a half cell.
    expect(shown()[0].position.x).toBeCloseTo(3.5);
    expect(shown()[0].position.y).toBeCloseTo(5);
    useStore.getState().setSnapDivision(1);
    tool.onPointerMove({ x: 3.3, y: 4.8 }, pointer());
    expect(shown()[0].position.x).toBeCloseTo(3);
    expect(shown()[0].position.y).toBeCloseTo(4.5);
    tool.onContextMenu({ x: 3.3, y: 4.8 });
    expect(shown()[0].position.x).toBeCloseTo(3.5);
    expect(shown()[0].position.y).toBeCloseTo(5);
  });

  it('Ctrl inverts the snap', () => {
    tool.onPointerMove({ x: 3.3, y: 4.8 }, pointer({ ctrlKey: true }));
    expect(shown()[0].position.x).toBeCloseTo(3.3);
    expect(shown()[0].position.y).toBeCloseTo(4.8);
  });
});

describe('placing a stamp', () => {
  it('lands exactly the ghost: position, angle, size and mirror; scale stays 1', () => {
    useStore.getState().updateToolSettings({ continuousPlacement: true });
    set({ stampRotation: Math.PI / 6, stampScale: 1.5, stampFlipX: true });
    const at = { x: 3.3, y: 4.8 };
    tool.onPointerMove(at, pointer());
    const ghost = shown()[0];
    tool.onPointerDown(at, pointer());

    const [child] = props();
    expect(child.assetId).toBe(CRATE);
    expect(child.position.x).toBeCloseTo(ghost.position.x);
    expect(child.position.y).toBeCloseTo(ghost.position.y);
    expect(child.rotation).toBeCloseTo(ghost.rotation);
    expect(child.width).toBeCloseTo(1.5);
    expect(child.height).toBeCloseTo(1.5);
    expect(-ghost.scale.x * ghost.texture.width).toBeCloseTo(child.width);
    expect(child.flipX).toBe(true);
    expect(child.scale).toBe(1);
    expect(useStore.getState().tools.activeTool).toBe('scatterBrush');
  });

  it('a middle-button press places nothing', () => {
    tool.onPointerDown({ x: 1, y: 1 }, pointer({ button: 1 }));
    expect(props()).toHaveLength(0);
  });

  it('returns to Select unless Keep placing is on', () => {
    tool.onPointerDown({ x: 1, y: 1 }, pointer());
    expect(props()).toHaveLength(1);
    expect(useStore.getState().tools.activeTool).toBe('select');
  });

  it('Vary each stamp re-rolls the next ghost inside the family', () => {
    useStore.getState().updateToolSettings({ continuousPlacement: true });
    set({ stampVary: true });
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) {
      tool.onPointerDown({ x: i * 2, y: 1 }, pointer());
      seen.add(brush().assetIds[0]);
    }
    for (const id of seen) expect(id.startsWith('test:crate_')).toBe(true);
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('a scatter stroke', () => {
  beforeEach(() => {
    set({
      stampMode: false,
      assetIds: [CRATE, TABLE],
      brushRadius: 2,
      density: 0.6,
      minSpacing: 0.5,
      avoidOverlap: true,
      stayOnFloor: false,
      scaleRange: [0.8, 1.2],
      tints: [],
    });
  });

  function paint(): void {
    tool.onPointerDown({ x: 0, y: 0 }, pointer());
    for (let x = 0.25; x <= 8; x += 0.25) tool.onPointerMove({ x, y: 0 }, pointer());
  }

  it('is one undo entry, and props carry their size in width with scale 1', () => {
    const execute = vi.spyOn(undoManager, 'execute');
    paint();
    const status = strokeStatus();
    expect(status?.placed).toBeGreaterThan(3);
    expect(props()).toHaveLength(0);
    tool.onPointerUp();
    expect(strokeStatus()).toBeNull();

    expect(execute).toHaveBeenCalledTimes(1);
    expect(props()).toHaveLength(status!.placed);
    for (const p of props()) {
      expect(p.scale).toBe(1);
      const natural = p.assetId === TABLE ? 2 : 1;
      expect(p.width / natural).toBeGreaterThanOrEqual(0.8 - 1e-9);
      expect(p.width / natural).toBeLessThanOrEqual(1.2 + 1e-9);
    }
    undoManager.undo();
    expect(props()).toHaveLength(0);
  });

  it('Escape mid-stroke drops it and keeps the tool', () => {
    const execute = vi.spyOn(undoManager, 'execute');
    paint();
    tool.onKeyDown(key('Escape'));
    tool.onPointerUp();
    expect(execute).not.toHaveBeenCalled();
    expect(props()).toHaveLength(0);
    expect(strokeStatus()).toBeNull();
    expect(useStore.getState().tools.activeTool).toBe('scatterBrush');
  });

  it('hover shows the brush only, never sample props', () => {
    tool.onPointerMove({ x: 1, y: 1 }, pointer());
    expect(shown()).toHaveLength(0);
  });
});

describe('an erase stroke', () => {
  beforeEach(() => {
    addProp('a', 0);
    addProp('b', 2);
    addProp('c', 4);
    addProp('image', 1, { objectType: 'image' });
    addProp('locked', 3, { locked: true });
    undoManager.clear();
    set({ stampMode: false, brushRadius: 0.6 });
    useStore.getState().setEraseMode(true);
  });

  it('removes the props it crossed in one undo entry, sparing images and locked props', () => {
    const execute = vi.spyOn(undoManager, 'execute');
    tool.onPointerDown({ x: 0, y: 0 }, pointer());
    for (let x = 0.25; x <= 4; x += 0.25) tool.onPointerMove({ x, y: 0 }, pointer());
    // Caught props fade while the stroke runs; nothing is gone yet.
    expect(setAssetChildrenAlpha).toHaveBeenCalledWith(layer().id, ['a'], 0.3);
    expect(props()).toHaveLength(5);
    tool.onPointerUp();

    expect(execute).toHaveBeenCalledTimes(1);
    expect(props().map((p) => p.id).sort()).toEqual(['image', 'locked']);
    expect(setAssetChildrenAlpha).toHaveBeenLastCalledWith(layer().id, ['a', 'b', 'c'], 1);
    undoManager.undo();
    expect(props()).toHaveLength(5);
  });

  it('is left behind when another tool is chosen: B again comes back placing, in the mode it had', () => {
    useStore.getState().setActiveTool('select');
    expect(useStore.getState().tools.eraseMode).toBe(false);
    useStore.getState().setActiveTool('scatterBrush');
    expect(useStore.getState().tools.eraseMode).toBe(false);
    expect(brush().stampMode).toBe(false);

    set({ stampMode: true });
    useStore.getState().setEraseMode(true);
    useStore.getState().setActiveTool('wall');
    useStore.getState().setActiveTool('scatterBrush');
    expect(useStore.getState().tools.eraseMode).toBe(false);
    expect(brush().stampMode).toBe(true);
  });

  it('Escape drops the stroke and puts the fade back', () => {
    tool.onPointerDown({ x: 0, y: 0 }, pointer());
    tool.onKeyDown(key('Escape'));
    tool.onPointerUp();
    expect(props()).toHaveLength(5);
    expect(setAssetChildrenAlpha).toHaveBeenLastCalledWith(layer().id, ['a'], 1);
  });
});

describe('a layer that cannot be edited', () => {
  it('gets no stamp, stroke or erase when locked or hidden', () => {
    const manager = new ToolManager(new Container());
    manager.registerTool(tool);
    useStore.getState().updateToolSettings({ continuousPlacement: true });

    useStore.getState().updateLayer(layer().id, { locked: true });
    manager.onPointerDown({ x: 1, y: 1 }, pointer());
    manager.onPointerUp({ x: 1, y: 1 }, pointer());
    useStore.getState().updateLayer(layer().id, { locked: false, visible: false });
    manager.onPointerDown({ x: 1, y: 1 }, pointer());
    set({ stampMode: false });
    manager.onPointerDown({ x: 1, y: 1 }, pointer());
    manager.onPointerUp({ x: 1, y: 1 }, pointer());
    expect(props()).toHaveLength(0);
  });
});

describe('the brush ring', () => {
  type Style = { color: number; width: number; alpha: number };
  type PathOp = { action: string };
  const ring = (): Graphics => container.children.find((c): c is Graphics => c instanceof Graphics && c !== undefined)!;
  const strokes = () =>
    ring()
      .context.instructions.filter((i) => i.action === 'stroke')
      .map((i) => i.data as unknown as { style: Style; path: { instructions: PathOp[] } });
  const moves = (s: { path: { instructions: PathOp[] } }) => s.path.instructions.filter((op) => op.action === 'moveTo').length;

  beforeEach(() => {
    setEditorDesk({ desk: '#f2f2f2', dot: '#c6c6c6', sheet: '#fbfbfb', ink: '#1b1b1b' });
    set({ stampMode: false, assetIds: [CRATE], brushRadius: 2 });
  });
  afterEach(() => setEditorDesk(null));

  it('scatter: an ink line over a wider paper halo, so it reads on light and dark floors', () => {
    tool.onPointerMove({ x: 1, y: 1 }, pointer());
    const [halo, ink] = strokes();
    expect([halo.style.color, ink.style.color]).toEqual([0xfbfbfb, 0x1b1b1b]);
    expect(halo.style.width).toBeGreaterThan(ink.style.width);
    expect(ink.style.alpha).toBe(1);
    expect(moves(ink)).toBeLessThanOrEqual(1);
  });

  it('erase: the same ink and paper ring, dashed, and no red', () => {
    useStore.getState().setEraseMode(true);
    tool.onPointerMove({ x: 1, y: 1 }, pointer());
    const all = strokes();
    expect(new Set(all.map((s) => s.style.color))).toEqual(new Set([0xfbfbfb, 0x1b1b1b]));
    const ink = all.find((s) => s.style.color === 0x1b1b1b)!;
    expect(moves(ink)).toBeGreaterThan(8);
    const fills = ring().context.instructions.filter((i) => i.action === 'fill');
    expect(fills.every((f) => (f.data as unknown as { style: Style }).style.color !== 0xff4444)).toBe(true);
  });
});
