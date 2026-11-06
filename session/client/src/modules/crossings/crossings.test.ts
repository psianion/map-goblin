// Crossing a raised edge at the table: which chips a hop raises, when a player's move is
// refused (never the DM's), the live overrides, and the drag snapping back on a refusal.
import { PROTOCOL_VERSION } from '@dnd/core/src/shared/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import type { PlayerInfo, SessionState } from '@dnd/core/src/shared/protocol';
import type { RenderEngine } from '@dnd/core/src/engine/RenderEngine';
import type { Layer, PlateauChild, ShapeChild } from '@dnd/core/src/store/types';
import { defaultCrossingKinds } from '@dnd/core/src/shared/crossingKinds';
import { useStore } from '@dnd/core/src/store/store';
import type { Token } from '@dnd/mechanics/tokens';
import { useSessionStore } from '../../session/store';
import { attachTokenInput, type TokenLayer } from '../tokens/drag';
import { CHIP_MS, useCrossingChips } from './chips';
import { chipWords, crossingTargetAt, judgeHop, type CrossingMap } from './crossings';

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

// A +3 cliff (10..14 square), and a +1 slope east of it.
const children = [
  rect('ground', 0, 0, 30, 30),
  plat('top', 10, 10, 14, 14, { height: 3, edge: 'cliff' }),
  plat('hill', 20, 10, 24, 14, { height: 1, edge: 'slope' }),
];
const kinds = defaultCrossingKinds();
const map = (over: Partial<ReturnType<typeof defaultCrossingKinds>[number]>[] = []): CrossingMap => ({
  layers: [{ id: 'l1', type: 'dungeon', children, standaloneWalls: [], mergedFloor: null } as unknown as Layer],
  mapSettings: { crossingKinds: kinds.map((k, i) => ({ ...k, ...(over[i] ?? {}) })) },
});
const NONE = { edges: {}, blocks: {} };

function plat(id: string, x0: number, y0: number, x1: number, y1: number, extra: Partial<PlateauChild> = {}): PlateauChild {
  return {
    id,
    name: id,
    childType: 'plateau',
    visible: true,
    contours: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]],
    height: 1,
    edge: 'cliff',
    ...extra,
  };
}

describe('judgeHop', () => {
  it('names a cliff crossed straight on, and lets the move stand while Climb does not block', () => {
    const v = judgeHop(map(), undefined, [8, 10.5], [11, 10.6], NONE, 'player');
    expect(v.refused).toBeNull();
    expect(v.chips.map((c) => [c.via, c.kindId])).toEqual([['cliff', 'climb']]);
    expect(chipWords(v.chips[0], false)).toEqual({ title: 'Climb', note: 'e.g. DC 12 Athletics' });
  });

  it('refuses a player crossing an Impassable edge, and never the DM', () => {
    const live = { edges: { top: 'impassable' }, blocks: {} };
    const player = judgeHop(map(), undefined, [12, 8.5], [12, 11], live, 'player');
    expect(player.refused?.kindId).toBe('impassable');
    expect(chipWords(player.refused!, true).title).toBe("Impassable — you can't cross here");
    expect(judgeHop(map(), undefined, [12, 8.5], [12, 11], live, 'dm').refused).toBeNull();
  });

  it('reads the DM’s live blocks switch over the map’s', () => {
    const live = { edges: {}, blocks: { climb: true } };
    expect(judgeHop(map(), undefined, [12, 8.5], [12, 11], live, 'player').refused?.kindId).toBe('climb');
  });

  it('names a slope only when its kind is not Free', () => {
    expect(judgeHop(map(), undefined, [18, 12], [21, 12], NONE, 'player').chips.map((c) => c.kindId)).toEqual(['difficult']);
    const free = { edges: { hill: 'free' }, blocks: {} };
    expect(judgeHop(map(), undefined, [18, 12], [21, 12], free, 'player').chips).toEqual([]);
  });
});

describe('crossingTargetAt', () => {
  it('finds the edge under the point, and nothing on open ground', () => {
    expect(crossingTargetAt(map(), undefined, 12, 10.2)).toMatchObject({ targetId: 'top', what: 'cliff', mapKindId: 'climb' });
    expect(crossingTargetAt(map(), undefined, 5, 5)).toBeNull();
  });
});

describe('chips', () => {
  beforeEach(() => useCrossingChips.setState({ chips: [] }));

  it('stays four seconds and renews instead of stacking for the same edge', () => {
    const [c] = judgeHop(map(), undefined, [8, 10.5], [11, 10.6], NONE, 'player').chips;
    useCrossingChips.getState().show(c, false, 1000);
    useCrossingChips.getState().show(c, false, 1500);
    expect(useCrossingChips.getState().chips).toHaveLength(1);
    useCrossingChips.getState().expire(1500 + CHIP_MS - 1);
    expect(useCrossingChips.getState().chips).toHaveLength(1);
    useCrossingChips.getState().expire(1500 + CHIP_MS + 1);
    expect(useCrossingChips.getState().chips).toHaveLength(0);
  });
});

describe('a refused drag snaps back', () => {
  const player: PlayerInfo = { identityId: 'p-2', name: 'Borin', role: 'player', connected: true };
  const token: Token = {
    id: 't1', name: 'Borin', imageAssetId: null, size: 'medium', disposition: 'friendly', sight: null, light: null,
    defId: null, x: 12.5, y: 7.5, elevation: 0, z: 0, hidden: false, ownerId: 'p-2',
  };

  beforeEach(() => {
    useCrossingChips.setState({ chips: [] });
    useStore.setState({ layers: map().layers as Layer[], levels: [] });
    useStore.setState((s) => {
      s.mapSettings.crossingKinds = kinds;
    });
  });

  it('puts the token back where it was picked up, tells the server, and says why', async () => {
    const listeners: Record<string, ((e: unknown) => void)[]> = {};
    const fire = (type: string, x: number, y: number) =>
      (listeners[type] ?? []).forEach((fn) =>
        fn({ button: 0, clientX: x, clientY: y, pointerId: 1, stopPropagation() {}, stopImmediatePropagation() {}, preventDefault() {} }),
      );
    const canvas = {
      addEventListener: (t: string, fn: unknown) => void (listeners[t] ??= []).push(fn as never),
      removeEventListener: () => {},
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
      setPointerCapture: () => {},
      hasPointerCapture: () => false,
      releasePointerCapture: () => {},
    };
    const sent: { action: string; payload: { x: number; y: number } }[] = [];
    const session: SessionState = {
      protocolVersion: PROTOCOL_VERSION,
      sessionId: 's1',
      campaignId: 'c1',
      activeSceneId: 'scene-1',
      scenes: [{ id: 'scene-1', name: 'Hill', mapId: 'scene-1' }],
      players: [player],
      modules: {
        tokens: { library: {}, byScene: { 'scene-1': { t1: token } } },
        crossings: { byScene: { 'scene-1': { edges: { top: 'impassable' }, blocks: {} } } },
      },
    };
    useSessionStore.setState({
      session,
      you: player,
      lastError: null,
      client: {
        send: (m: unknown) => {
          const msg = m as { module: string; action: string; payload: { x: number; y: number } };
          if (msg.module === 'tokens') sent.push({ action: msg.action, payload: msg.payload });
        },
      } as never,
    });
    let settled: { x: number; y: number } | null = null;
    const layer: TokenLayer = {
      tokens: () => [token],
      placeAt: () => {},
      setDragging: () => {},
      settleAt: (_id, x, y) => void (settled = { x, y }),
    };
    const engine = { canvas: () => canvas, screenToWorld: (x: number, y: number) => ({ x, y }) } as unknown as RenderEngine;
    const detach = attachTokenInput(engine, layer);

    fire('pointerdown', 12.5, 7.5);
    fire('pointermove', 12.5, 11.5); // over the impassable north edge of the plateau
    await Promise.resolve();

    expect(settled).toEqual({ x: 12.5, y: 7.5 });
    expect(sent.at(-1)).toEqual({ action: 'move', payload: { id: 't1', x: 12.5, y: 7.5 } });
    expect(sent.some((m) => m.payload.y > 10)).toBe(false);
    const [chip] = useCrossingChips.getState().chips;
    expect(chip).toMatchObject({ refused: true, title: "Impassable — you can't cross here" });
    detach();
  });
});
