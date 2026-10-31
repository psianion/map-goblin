// Zone overlay markers: constant on-screen weight at any zoom (N7), and an interior fill
// that reads on the black-surround unlit maps a dungeon usually is (N8).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container, Graphics } from 'pixi.js';
import { useStore } from '@/store/store';
import type { DungeonLayer, ZoneChild } from '@/store/types';

vi.mock('@/engine/engineSingleton', () => ({ getEngineSingleton: vi.fn() }));
const { getEngineSingleton } = await import('@/engine/engineSingleton');
const { mountZoneOverlay } = await import('./zoneOverlay');

function fakeEngineAtZoom(zoom: number) {
  return { engine: { stage: () => ({ scale: { x: zoom } }) } } as unknown as ReturnType<typeof getEngineSingleton>;
}

const CIRCLE_ZONE: ZoneChild = {
  id: 'zone-1',
  name: 'Zone',
  childType: 'zone',
  visible: true,
  shape: { kind: 'circle', position: { x: 1, y: 1 }, radius: 2 },
};

function dungeonLayer(): DungeonLayer {
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon');
  if (!l) throw new Error('default state has no dungeon layer');
  return l;
}

// The overlay's own poll loop (see zoneOverlay.ts) — captured so tests can advance it by
// hand instead of racing a real rAF.
let rafCallback: (() => void) | null = null;

// PixiRenderEngine's initial camera: zoom 20 == 100%, i.e. 1 world unit == 20px.
const DEFAULT_ZOOM = 20;

beforeEach(() => {
  useStore.getState().resetToDefault();
  vi.mocked(getEngineSingleton).mockReturnValue(fakeEngineAtZoom(DEFAULT_ZOOM));
  rafCallback = null;
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
    rafCallback = cb;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// The unselected circle's white outline stroke (as opposed to the ink under-stroke, which
// carries an extra fixed width on top) — isolate it by color the way the fill tests do.
function whiteStrokeWidth(strokeSpy: ReturnType<typeof vi.spyOn>): number {
  const call = strokeSpy.mock.calls.find((c: unknown[]) => (c[0] as { color: number }).color === 0xffffff);
  return (call![0] as { width: number }).width;
}

describe('zone overlay zoom scaling (N7)', () => {
  it('renders the authored on-screen stroke weight at the default 100% zoom', () => {
    useStore.getState().addChild(dungeonLayer().id, CIRCLE_ZONE);
    const strokeSpy = vi.spyOn(Graphics.prototype, 'stroke');

    const unmount = mountZoneOverlay(new Container());

    // World-unit width * zoom (px-per-world-unit) = on-screen px. Authored unselected
    // circle stroke is 0.04 world units at REFERENCE_ZOOM, i.e. 0.8 screen px at 100%.
    const widthOnScreen = whiteStrokeWidth(strokeSpy) * DEFAULT_ZOOM;
    expect(widthOnScreen).toBeCloseTo(0.8, 5);

    unmount();
  });

  it('holds the on-screen stroke weight constant as the camera zooms', () => {
    useStore.getState().addChild(dungeonLayer().id, CIRCLE_ZONE);
    const strokeSpy = vi.spyOn(Graphics.prototype, 'stroke');

    const unmount = mountZoneOverlay(new Container());
    const onScreenAt100 = whiteStrokeWidth(strokeSpy) * DEFAULT_ZOOM;

    for (const zoom of [DEFAULT_ZOOM / 2, DEFAULT_ZOOM * 4]) {
      strokeSpy.mockClear();
      vi.mocked(getEngineSingleton).mockReturnValue(fakeEngineAtZoom(zoom));
      rafCallback?.(); // one more poll tick sees the new zoom and redraws

      expect(whiteStrokeWidth(strokeSpy) * zoom).toBeCloseTo(onScreenAt100, 5);
    }

    unmount();
  });
});

describe('zone interior fill (N8)', () => {
  it('sandwiches the ink fill with a white fill so zones read on black-surround maps', () => {
    useStore.getState().addChild(dungeonLayer().id, CIRCLE_ZONE);
    const fillSpy = vi.spyOn(Graphics.prototype, 'fill');

    const unmount = mountZoneOverlay(new Container());

    const fills = fillSpy.mock.calls.map((c) => c[0] as unknown as { color: number; alpha: number });
    const inkFill = fills.find((f) => f.color === 0x191b16);
    const whiteFill = fills.find((f) => f.color === 0xffffff);
    expect(inkFill).toBeDefined();
    expect(whiteFill).toBeDefined();
    expect(whiteFill!.alpha).toBeCloseTo(0.05, 5);

    unmount();
  });

  it('uses the stronger white fill alpha for a selected zone', () => {
    useStore.getState().addChild(dungeonLayer().id, CIRCLE_ZONE);
    useStore.getState().setSelectedIds([CIRCLE_ZONE.id]);
    const fillSpy = vi.spyOn(Graphics.prototype, 'fill');

    const unmount = mountZoneOverlay(new Container());

    const fills = fillSpy.mock.calls.map((c) => c[0] as unknown as { color: number; alpha: number });
    const whiteFill = fills.find((f) => f.color === 0xffffff);
    expect(whiteFill!.alpha).toBeCloseTo(0.09, 5);

    unmount();
  });
});

describe('zones and levels', () => {
  /** A layer on a second level, holding the circle zone; the first level stays on show. */
  function zoneUpstairs() {
    useStore.getState().addLevel({ id: 'up', name: 'Up' });
    const upper = { ...structuredClone(dungeonLayer()), id: 'upper', name: 'Upper', levelId: 'up', children: [CIRCLE_ZONE], standaloneWalls: [] };
    useStore.getState().addLayer(upper as DungeonLayer);
  }

  it('does not draw a zone whose layer is on another level', () => {
    zoneUpstairs();
    const strokeSpy = vi.spyOn(Graphics.prototype, 'stroke');
    const unmount = mountZoneOverlay(new Container());
    expect(strokeSpy).not.toHaveBeenCalled();
    unmount();
  });

  it('redraws when the level on show switches', () => {
    zoneUpstairs();
    const strokeSpy = vi.spyOn(Graphics.prototype, 'stroke');
    const unmount = mountZoneOverlay(new Container());
    useStore.getState().setActiveLevelId('up');
    rafCallback?.();
    expect(strokeSpy).toHaveBeenCalled();
    strokeSpy.mockClear();
    useStore.getState().setActiveLevelId(useStore.getState().levels[0].id);
    rafCallback?.();
    expect(strokeSpy).not.toHaveBeenCalled();
    unmount();
  });
});

describe('the zones show row', () => {
  it('draws no zone of a layer whose Zones row is off', () => {
    const layer = dungeonLayer();
    useStore.getState().addChild(layer.id, CIRCLE_ZONE);
    useStore.getState().setSublayerVisibility(layer.id, 'zones', false);
    const strokeSpy = vi.spyOn(Graphics.prototype, 'stroke');
    const unmount = mountZoneOverlay(new Container());
    expect(strokeSpy).not.toHaveBeenCalled();
    unmount();
  });

  it('redraws the zones when the row comes back on', () => {
    const layer = dungeonLayer();
    useStore.getState().addChild(layer.id, CIRCLE_ZONE);
    useStore.getState().setSublayerVisibility(layer.id, 'zones', false);
    const strokeSpy = vi.spyOn(Graphics.prototype, 'stroke');
    const unmount = mountZoneOverlay(new Container());
    useStore.getState().setSublayerVisibility(layer.id, 'zones', true);
    rafCallback?.();
    expect(strokeSpy).toHaveBeenCalled();
    unmount();
  });
});
