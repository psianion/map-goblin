import { describe, it, expect, beforeEach } from 'vitest';
import { Container } from 'pixi.js';
import { SelectTool } from './SelectTool';
import { useStore } from '../../store/store';
import { undoManager } from '../../store/undoManager';
import type { RenderEngine } from '../RenderEngine';
import type { DungeonLayer } from '../../store/types';
import type { AssetChild, LightChild } from '../../shared/types';

// jsdom has no real <canvas> 2D context (the `canvas` npm package isn't
// installed), but TransformGizmo's chip label measures text through one —
// the gizmo only gets exercised here, no other test drives SelectTool's
// object-selection path. A permissive stub is enough: any call answers with
// something numeric, any property is settable.
if (typeof (globalThis as { CanvasRenderingContext2D?: unknown }).CanvasRenderingContext2D === 'undefined') {
  (globalThis as { CanvasRenderingContext2D?: unknown }).CanvasRenderingContext2D = class {};
}
const fakeCtx2D = new Proxy(
  {},
  {
    get: (target: Record<string, unknown>, prop) =>
      prop in target ? target[prop as string] : () => ({ width: 0, height: 0 }),
    set: (target: Record<string, unknown>, prop, value) => {
      target[prop as string] = value;
      return true;
    },
  },
);
HTMLCanvasElement.prototype.getContext = (() => fakeCtx2D) as unknown as typeof HTMLCanvasElement.prototype.getContext;

// A realistic zoom (50 screen px per world unit) so the light's icon hit
// radius floors to the default 0.5 world cells instead of ballooning — at
// zoom 1 a 12px icon radius would swallow clicks anywhere near it.
const ZOOM = 50;

function makeEngine(): RenderEngine {
  const overlayContainer = new Container();
  const rect = { left: 0, top: 0 } as DOMRect;
  return {
    overlay: () => overlayContainer,
    canvas: () => ({ getBoundingClientRect: () => rect }) as unknown as HTMLCanvasElement,
    stage: () => ({ scale: { x: ZOOM, y: ZOOM } }) as unknown as Container,
    worldToScreen: (wx: number, wy: number) => ({ x: wx * ZOOM, y: wy * ZOOM }),
  } as unknown as RenderEngine;
}

function pointerEvent(clientX: number, clientY: number, extra: Partial<PointerEvent> = {}): PointerEvent {
  return { clientX, clientY, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...extra } as PointerEvent;
}

/** Screen-space drag from (0,0) covering a world-space delta, at ZOOM. */
function dragEvent(worldDx: number, worldDy: number): PointerEvent {
  return pointerEvent(worldDx * ZOOM, worldDy * ZOOM);
}

function layer(): DungeonLayer {
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon');
  if (!l) throw new Error('default state has no dungeon layer');
  return l;
}

function addAsset(position: { x: number; y: number }): AssetChild {
  const asset: AssetChild = {
    id: crypto.randomUUID(),
    name: 'Lamp',
    childType: 'asset',
    visible: true,
    objectType: 'asset',
    assetId: 'lamp',
    position,
    rotation: 0,
    scale: 1,
    width: 1,
    height: 1,
    tint: '#ffffff',
    flipX: false,
    flipY: false,
  };
  useStore.getState().addChild(layer().id, asset);
  return asset;
}

function addLight(position: { x: number; y: number }, attachedTo?: string): LightChild {
  const light: LightChild = {
    id: crypto.randomUUID(),
    name: 'Light 1',
    childType: 'light',
    visible: true,
    color: '#ffcc66',
    radius: 4,
    featherRadius: 2,
    intensity: 0.8,
    falloff: 'linear',
    position,
    attachedTo,
  };
  useStore.getState().addChild(layer().id, light);
  return light;
}

function findChild(id: string) {
  return layer().children.find((c) => c.id === id);
}

describe('SelectTool — M1 attached-light drag', () => {
  let tool: SelectTool;

  beforeEach(() => {
    undoManager.clear();
    useStore.getState().resetToDefault();
    tool = new SelectTool(makeEngine());
  });

  it('moves an attached light by the same delta as its asset, in one undo', () => {
    const asset = addAsset({ x: 5, y: 5 });
    // Close enough to the asset centre to attach (< 0.5 cells), but the click
    // below lands on the asset's far corner so it doesn't also hit the light.
    const light = addLight({ x: 5.3, y: 5 }, asset.id);

    // Click-and-drag the asset: select-and-drag fires on the same pointerdown.
    tool.onPointerDown({ x: 4.5, y: 5.5 }, pointerEvent(0, 0));
    tool.onPointerMove({ x: 6.5, y: 8.5 }, dragEvent(2, 3));
    tool.onPointerUp({ x: 6.5, y: 8.5 }, dragEvent(2, 3));

    const movedAsset = findChild(asset.id) as AssetChild;
    const movedLight = findChild(light.id) as LightChild;
    expect(movedAsset.position).toEqual({ x: 7, y: 8 });
    expect(movedLight.position).toEqual({ x: 7.3, y: 8 });
    // Radius untouched by the asset's move.
    expect(movedLight.radius).toBe(4);

    // One undo reverts both.
    undoManager.undo();
    expect((findChild(asset.id) as AssetChild).position).toEqual({ x: 5, y: 5 });
    expect((findChild(light.id) as LightChild).position).toEqual({ x: 5.3, y: 5 });
  });

  it('moving a light directly does not drag its host asset', () => {
    const asset = addAsset({ x: 5, y: 5 });
    const light = addLight({ x: 5.3, y: 5 }, asset.id);

    tool.onPointerDown({ x: 5.3, y: 5 }, pointerEvent(0, 0));
    tool.onPointerMove({ x: 6.3, y: 6 }, dragEvent(1, 1));
    tool.onPointerUp({ x: 6.3, y: 6 }, dragEvent(1, 1));

    expect((findChild(light.id) as LightChild).position).toEqual({ x: 6.3, y: 6 });
    expect((findChild(asset.id) as AssetChild).position).toEqual({ x: 5, y: 5 });
  });

  it('does not drag a light attached to a different asset', () => {
    const asset = addAsset({ x: 5, y: 5 });
    const otherAsset = addAsset({ x: 20, y: 20 });
    const light = addLight({ x: 20.3, y: 20 }, otherAsset.id);

    tool.onPointerDown({ x: 5, y: 5 }, pointerEvent(0, 0));
    tool.onPointerMove({ x: 7, y: 8 }, dragEvent(2, 3));
    tool.onPointerUp({ x: 7, y: 8 }, dragEvent(2, 3));

    expect((findChild(asset.id) as AssetChild).position).toEqual({ x: 7, y: 8 });
    expect((findChild(light.id) as LightChild).position).toEqual({ x: 20.3, y: 20 });
  });
});
