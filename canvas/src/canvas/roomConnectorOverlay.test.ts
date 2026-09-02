// Authored room/connector overlay (E3): white + ink only, constant on-screen
// weight at any zoom, and nothing drawn for anything the DM has hidden.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container, Graphics } from 'pixi.js';
import { useStore } from '@/store/store';
import type { ConnectorChild, DungeonLayer, RoomChild } from '@/store/types';

vi.mock('@/engine/engineSingleton', () => ({ getEngineSingleton: vi.fn() }));
const { getEngineSingleton } = await import('@/engine/engineSingleton');
const { mountRoomConnectorOverlay } = await import('./roomConnectorOverlay');

function fakeEngineAtZoom(zoom: number) {
  return { engine: { stage: () => ({ scale: { x: zoom } }) } } as unknown as ReturnType<typeof getEngineSingleton>;
}

const ROOM: RoomChild = {
  id: 'room-1',
  name: 'Klarg Cave',
  childType: 'room',
  visible: true,
  contours: [
    [
      [0, 0],
      [6, 0],
      [6, 6],
      [0, 6],
    ],
  ],
};

const ARCH: ConnectorChild = {
  id: 'conn-1',
  name: 'Connector 1',
  childType: 'connector',
  visible: true,
  kind: 'arch',
  state: 'open',
  isSecret: false,
  contours: [
    [
      [6, 2],
      [8, 2],
      [8, 4],
      [6, 4],
    ],
  ],
};

const DOOR: ConnectorChild = { ...ARCH, id: 'conn-2', kind: 'door', state: 'closed' };

function dungeonLayer(): DungeonLayer {
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon');
  if (!l) throw new Error('default state has no dungeon layer');
  return l;
}

let rafCallback: (() => void) | null = null;

// PixiRenderEngine's initial camera: zoom 20 == 100%, i.e. 1 world unit == 20px.
const DEFAULT_ZOOM = 20;
const WHITE = 0xffffff;
const INK = 0x191b16;

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

type Paint = { color: number; width?: number; alpha: number };

function paints(spy: ReturnType<typeof vi.spyOn>): Paint[] {
  return spy.mock.calls.map((c: unknown[]) => c[0] as Paint);
}

function whiteStrokeWidth(strokeSpy: ReturnType<typeof vi.spyOn>): number {
  return paints(strokeSpy).find((p) => p.color === WHITE)!.width!;
}

describe('room/connector overlay palette', () => {
  it('draws rooms and connectors in white and ink only — never the theme accent', () => {
    useStore.getState().addChild(dungeonLayer().id, ROOM);
    useStore.getState().addChild(dungeonLayer().id, DOOR);
    const fillSpy = vi.spyOn(Graphics.prototype, 'fill');
    const strokeSpy = vi.spyOn(Graphics.prototype, 'stroke');

    const unmount = mountRoomConnectorOverlay(new Container());

    const colors = new Set([...paints(fillSpy), ...paints(strokeSpy)].map((p) => p.color));
    expect(colors.size).toBeGreaterThan(0);
    expect([...colors].every((c) => c === WHITE || c === INK)).toBe(true);

    unmount();
  });

  it('reads an arch and a door apart by their interior fill weight', () => {
    const fillSpy = vi.spyOn(Graphics.prototype, 'fill');

    useStore.getState().addChild(dungeonLayer().id, ARCH);
    let unmount = mountRoomConnectorOverlay(new Container());
    const archWhite = paints(fillSpy).find((p) => p.color === WHITE)!.alpha;
    unmount();

    useStore.getState().resetToDefault();
    fillSpy.mockClear();
    useStore.getState().addChild(dungeonLayer().id, DOOR);
    unmount = mountRoomConnectorOverlay(new Container());
    const doorWhite = paints(fillSpy).find((p) => p.color === WHITE)!.alpha;
    unmount();

    expect(doorWhite).toBeGreaterThan(archWhite);
  });

  it('holds the on-screen stroke weight constant as the camera zooms', () => {
    useStore.getState().addChild(dungeonLayer().id, ROOM);
    const strokeSpy = vi.spyOn(Graphics.prototype, 'stroke');

    const unmount = mountRoomConnectorOverlay(new Container());
    const onScreenAt100 = whiteStrokeWidth(strokeSpy) * DEFAULT_ZOOM;

    for (const zoom of [DEFAULT_ZOOM / 2, DEFAULT_ZOOM * 4]) {
      strokeSpy.mockClear();
      vi.mocked(getEngineSingleton).mockReturnValue(fakeEngineAtZoom(zoom));
      rafCallback?.();
      expect(whiteStrokeWidth(strokeSpy) * zoom).toBeCloseTo(onScreenAt100, 5);
    }

    unmount();
  });
});

describe('room/connector overlay visibility', () => {
  it('draws nothing for a hidden child', () => {
    useStore.getState().addChild(dungeonLayer().id, { ...ROOM, visible: false });
    const fillSpy = vi.spyOn(Graphics.prototype, 'fill');

    const unmount = mountRoomConnectorOverlay(new Container());

    expect(fillSpy).not.toHaveBeenCalled();
    unmount();
  });

  it('draws nothing for a child on a hidden layer', () => {
    const id = dungeonLayer().id;
    useStore.getState().addChild(id, ROOM);
    useStore.getState().updateLayer(id, { visible: false } as never);
    const fillSpy = vi.spyOn(Graphics.prototype, 'fill');

    const unmount = mountRoomConnectorOverlay(new Container());

    expect(fillSpy).not.toHaveBeenCalled();
    unmount();
  });

  it('labels each room with its name', () => {
    useStore.getState().addChild(dungeonLayer().id, ROOM);
    const world = new Container();

    const unmount = mountRoomConnectorOverlay(world);

    const root = world.children[0] as Container;
    const labels = root.children[1] as Container;
    expect(labels.children).toHaveLength(1);
    expect((labels.children[0] as unknown as { text: string }).text).toBe('Klarg Cave');

    unmount();
  });
});
