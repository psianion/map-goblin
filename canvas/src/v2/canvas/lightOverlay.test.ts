import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), dismiss: vi.fn() }),
}));

// jsdom has no 2D canvas to measure text with: a Text that only remembers what it was given.
vi.mock('pixi.js', async (importOriginal) => {
  const pixi = await importOriginal<typeof import('pixi.js')>();
  class FakeText extends pixi.Container {
    text = '';
    style: { fill: unknown } = { fill: 0 };
    constructor(opts?: { text?: string }) {
      super();
      this.text = opts?.text ?? '';
    }
    override get width() {
      return this.text.length * 6;
    }
    override set width(_: number) {}
  }
  return { ...pixi, Text: FakeText };
});

import { Container } from 'pixi.js';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import type { DungeonLayer, LightChild } from '@/store/types';
import type { RenderEngine } from '@/engine/RenderEngine';
import { cursorWorldPosition } from '@/canvas/cursorPosition';
import { dragPatch, handleAt, lightOverlayModel, mountLightOverlay, type LightOverlayHandle } from './lightOverlay';

function layer(): DungeonLayer {
  return useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
}

const torch = (over: Partial<LightChild> = {}): LightChild => ({
  id: 't',
  name: 'Torch 3',
  childType: 'light',
  visible: true,
  color: '#ffb561',
  radius: 8,
  featherRadius: 4,
  intensity: 0.9,
  falloff: 'quadratic',
  position: { x: 10, y: 10 },
  ...over,
});
const live = () => layer().children.find((c) => c.id === 't') as LightChild;

beforeEach(() => {
  useStore.getState().resetToDefault();
  undoManager.clear();
  useStore.getState().setActiveTool('select');
  useStore.getState().addChild(layer().id, torch());
});

describe('lightOverlayModel', () => {
  it('draws the light selected on its own: rings in cells, a cone only when narrower than a circle', () => {
    expect(lightOverlayModel(useStore.getState()).selected).toBeNull();
    useStore.getState().setSelectedIds(['t']);
    expect(lightOverlayModel(useStore.getState()).selected).toMatchObject({ x: 10, y: 10, bright: 4, dim: 8, cone: null, dark: false });
    useStore.getState().updateChild(layer().id, 't', { cone: { angle: 90, direction: 0 } });
    expect(lightOverlayModel(useStore.getState()).selected?.cone).toEqual({ angle: 90, direction: 0 });
  });

  it('ghosts the next light while the Light tool is in hand', () => {
    useStore.getState().updateLightDefaults({ featherRadius: 4, radius: 8 });
    useStore.getState().setActiveTool('light');
    expect(lightOverlayModel(useStore.getState()).ghost).toEqual({ bright: 4, dim: 8, dark: false });
  });
});

describe('handles', () => {
  it('finds the ring handles on their east points and the direction knob past the dim ring', () => {
    const ring = { x: 10, y: 10, bright: 4, dim: 8, cone: { angle: 90, direction: 90 }, dark: false };
    expect(handleAt(ring, { x: 14, y: 10 }, 20)).toBe('bright');
    expect(handleAt(ring, { x: 18.2, y: 10 }, 20)).toBe('dim');
    // 30 px past the dim ring, straight down, at 20 px a cell.
    expect(handleAt(ring, { x: 10, y: 19.5 }, 20)).toBe('direction');
    expect(handleAt(ring, { x: 12, y: 12 }, 20)).toBeNull();
  });

  it('turns a handle drag into feet steps and whole degrees, bright never past dim', () => {
    const l = torch();
    expect(dragPatch(l, 'dim', { x: 21.1, y: 10 }, 5)).toEqual({ radius: 11 });
    expect(dragPatch(l, 'bright', { x: 20, y: 10 }, 5)).toEqual({ featherRadius: 10, radius: 10 });
    expect(dragPatch(l, 'dim', { x: 12, y: 10 }, 5)).toEqual({ radius: 2, featherRadius: 2 });
    expect(dragPatch({ ...l, cone: { angle: 90, direction: 0 } }, 'direction', { x: 10, y: 20 }, 5)).toEqual({ cone: { angle: 90, direction: 90 } });
  });
});

describe('mountLightOverlay', () => {
  let frame: (() => void) | null = null;
  let overlay: LightOverlayHandle;
  let world: Container;
  const tick = (): void => {
    const f = frame;
    frame = null;
    f?.();
  };

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      frame = cb;
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    world = new Container();
    world.scale.set(20);
    const screen = new Container();
    const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0 }) };
    overlay = mountLightOverlay({
      stage: () => world,
      overlay: () => screen,
      canvas: () => canvas,
      screenToWorld: (sx: number, sy: number) => ({ x: sx / 20, y: sy / 20 }),
    } as unknown as RenderEngine);
  });

  afterEach(() => {
    overlay.destroy();
    cursorWorldPosition.current = null;
    vi.unstubAllGlobals();
  });

  it('costs nothing while the pointer moves: the ghost follows it, nothing redraws', () => {
    useStore.getState().setActiveTool('light');
    tick();
    const before = overlay.stats().redraws;
    for (let i = 0; i < 30; i++) {
      cursorWorldPosition.current = { x: 3 + i * 0.25, y: 4 };
      useStore.getState().setHoveredId(i % 2 ? 't' : null);
      tick();
    }
    expect(overlay.stats().redraws).toBe(before);
  });

  it('a ring handle drag previews live and lands as one undo step', () => {
    useStore.getState().setSelectedIds(['t']);
    tick();
    // The dim handle sits at (18, 10): 360, 200 in canvas px.
    expect(overlay.pressAt(360, 200)).toBe(true);
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 440, clientY: 200 }) as PointerEvent);
    expect(live().radius).toBe(12);
    expect(undoManager.canUndo()).toBe(false);
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: 440, clientY: 200 }) as PointerEvent);
    expect(live().radius).toBe(12);
    undoManager.undo();
    expect(live().radius).toBe(8);
    // Away from every handle the press goes on to the tools.
    expect(overlay.pressAt(100, 100)).toBe(false);
  });
});
