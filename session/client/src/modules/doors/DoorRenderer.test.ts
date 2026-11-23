// T11 (I4) — the player's copy of the door art is redrawn when pack textures land, so a door
// first drawn before its kit slices decoded does not keep core's fallback glyph (an open door's
// swing arcs, which are editor marks) on a player's screen.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';
import type { RenderEngine } from '@dnd/core/src/engine/RenderEngine';
import type { SceneGraph } from '@dnd/core/src/engine/sceneGraph';
import { PROTOCOL_VERSION, type PlayerInfo } from '@dnd/core/src/shared/protocol';
import type { DoorChild } from '@dnd/core/src/shared/types';
import type { Layer } from '@dnd/core/src/store/types';
import { useStore } from '@dnd/core/src/store/store';
import { useSessionStore } from '../../session/store';
import { useAsPlayers } from '../fog/asPlayers';
import { mountDoorLayer } from './DoorRenderer';

const textureSubs = vi.hoisted(() => new Set<() => void>());
vi.mock('@dnd/core/src/engine/assetPackInstance', () => ({
  getAssetPackManager: () => ({
    subscribeTextures: (cb: () => void) => {
      textureSubs.add(cb);
      return () => textureSubs.delete(cb);
    },
  }),
}));
const renderDoors = vi.hoisted(() => vi.fn());
vi.mock('@dnd/core/src/engine/doorRenderer', () => ({ renderDoors }));

const door = {
  id: 'd1',
  name: 'Double 1',
  childType: 'door',
  visible: true,
  wallId: 'w1',
  position: [4, 4],
  angle: 0,
  width: 2,
  style: 'double',
  state: 'open',
  isSecret: false,
  freestanding: true,
  roomA: null,
  roomB: null,
} as unknown as DoorChild;
const player: PlayerInfo = { identityId: 'p-1', name: 'Pim', role: 'player', connected: true };

beforeEach(() => {
  renderDoors.mockClear();
  textureSubs.clear();
  useStore.setState({ layers: [{ id: 'l1', type: 'dungeon', children: [door], standaloneWalls: [], rooms: [] } as unknown as Layer] });
  useSessionStore.setState({
    you: player,
    session: {
      protocolVersion: PROTOCOL_VERSION,
      sessionId: 's1',
      campaignId: 'c1',
      activeSceneId: 'scene-1',
      scenes: [{ id: 'scene-1', name: 'Testing', mapId: 'scene-1' }],
      players: [player],
      modules: {},
    },
  });
});

describe('the player door art', () => {
  it('redraws once on the next frame after pack textures land', () => {
    const worldContainer = new Container();
    const sceneGraph = { worldContainer, layerContainer: new Container(), overlayContainer: new Container() } as unknown as SceneGraph;
    const ticks: (() => void)[] = [];
    const canvas = document.createElement('canvas');
    const engine = {
      canvas: () => canvas,
      screenToWorld: (x: number, y: number) => ({ x, y }),
      ticker: () => ({ add: (fn: () => void) => ticks.push(fn), remove: () => {} }),
    } as unknown as RenderEngine;
    const unmount = mountDoorLayer(engine, sceneGraph);
    const drawn = renderDoors.mock.calls.length;
    expect(drawn).toBeGreaterThan(0);

    ticks.forEach((tick) => tick());
    expect(renderDoors.mock.calls.length, 'a frame alone redraws nothing').toBe(drawn);

    // Two textures land in one frame: one redraw.
    textureSubs.forEach((cb) => cb());
    textureSubs.forEach((cb) => cb());
    ticks.forEach((tick) => tick());
    expect(renderDoors.mock.calls.length).toBe(drawn + 1);

    unmount();
    expect(textureSubs.size).toBe(0);
  });
});

describe('the DM’s door marks', () => {
  it('hide while the DM looks as players see it, and come back after', () => {
    useSessionStore.setState({ you: { ...player, identityId: 'd-1', role: 'dm' } });
    const sceneGraph = { worldContainer: new Container(), layerContainer: new Container(), overlayContainer: new Container() } as unknown as SceneGraph;
    const ticks: (() => void)[] = [];
    const engine = {
      canvas: () => document.createElement('canvas'),
      screenToWorld: (x: number, y: number) => ({ x, y }),
      ticker: () => ({ add: (fn: () => void) => ticks.push(fn), remove: () => {} }),
    } as unknown as RenderEngine;
    const unmount = mountDoorLayer(engine, sceneGraph);
    const marks = sceneGraph.overlayContainer.getChildByLabel('doorMarks', true)!;
    ticks.forEach((tick) => tick());
    expect(marks.visible).toBe(true);

    useAsPlayers.getState().set(true);
    ticks.forEach((tick) => tick());
    expect(marks.visible).toBe(false);

    useAsPlayers.getState().set(false);
    ticks.forEach((tick) => tick());
    expect(marks.visible).toBe(true);
    unmount();
  });
});
