// The fog layer on each seat: what `fogScene` reads, and what the mounted layer does with it —
// solid for a player, see-through with an edge line for the DM, solid again under "As players
// see it" — and the stencils the token chips wear, which must never let a token show through fog.
//
// Pixi's display objects need no GPU, so the layer is inspectable in jsdom; what lands in a
// texture is the GPU's business.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Container, Mesh, Sprite, Ticker } from 'pixi.js';
import { PROTOCOL_VERSION, type PlayerInfo, type SessionState } from '@dnd/core/src/shared/protocol';
import type { RenderEngine } from '@dnd/core/src/engine/RenderEngine';
import type { SceneGraph } from '@dnd/core/src/engine/sceneGraph';
import { clearEngineSingleton, setEngineSingleton } from '@dnd/core/src/engine/engineSingleton';
import { useStore } from '@dnd/core/src/store/store';
import { regionOf, setCells, type RegionMask } from '@dnd/mechanics/fog';
import type { Token } from '@dnd/mechanics/tokens';
import { SHOWN_MASK, SIGHT_MASK, shownMaskOf, sightMaskOf } from '../../renderer/overlayLayer';
import { useSessionStore } from '../../session/store';
import { useAsPlayers } from './asPlayers';
import { DM_DENSE, GRADE_STRENGTH, fogScene, glowPools, mountPlayerFogWhenReady } from './FogRenderer';
import { tierPlan } from './tierPlan';

const FRAME = { minX: 0, minY: 0, maxX: 20, maxY: 10 };
const LEVELS = [
  { id: 'upper', name: 'Upper' },
  { id: 'lower', name: 'Lower' },
];

const dm: PlayerInfo = { identityId: 'dm-1', name: 'Dana', role: 'dm', connected: true };
const player: PlayerInfo = { identityId: 'p1', name: 'Ayla', role: 'player', connected: true };

const token = (over: Partial<Token> = {}): Token => ({
  id: 't1',
  name: 'Ayla',
  imageAssetId: null,
  size: 'medium',
  disposition: 'friendly',
  sight: null,
  light: null,
  defId: null,
  x: 2.5,
  y: 2.5,
  elevation: 0,
  z: 0,
  hidden: false,
  ownerId: 'p1',
  levelId: 'upper',
  ...over,
});

const cleared = (cells: [number, number][]): RegionMask => setCells(regionOf(FRAME)!, cells);

const session = (fog: object, tokens: Token[] = []): SessionState => ({
  protocolVersion: PROTOCOL_VERSION,
  sessionId: 's1',
  campaignId: 'c1',
  activeSceneId: 'scene-1',
  scenes: [{ id: 'scene-1', name: 'Cave', mapId: 'scene-1' }],
  players: [dm, player],
  modules: {
    fog: { byScene: { 'scene-1': { ...fog } } },
    tokens: { byScene: { 'scene-1': Object.fromEntries(tokens.map((t) => [t.id, t])) } },
  },
});

function seat(you: PlayerInfo, fog: object, tokens: Token[] = [], level = 'upper'): void {
  useSessionStore.setState({ you, session: session(fog, tokens), mapData: { version: '3.0', frame: FRAME, layers: [] } });
  useStore.setState({ layers: [], levels: LEVELS, ui: { ...useStore.getState().ui, activeLevelId: level } } as never);
}

beforeEach(() => {
  useAsPlayers.getState().set(false);
});

describe('fogScene', () => {
  it('draws nothing on any seat while fog is off', () => {
    seat(player, {});
    expect(fogScene()).toMatchObject({ on: false, bounds: null });
    seat(dm, { on: false });
    expect(fogScene()).toMatchObject({ on: false, bounds: null });
  });

  it('covers the frame with fog on, solid for a player and see-through for the DM, with no token needed', () => {
    seat(player, { on: true });
    expect(fogScene()).toMatchObject({ on: true, solid: true, bounds: FRAME });
    seat(dm, { on: true });
    expect(fogScene()).toMatchObject({ on: true, solid: false, bounds: FRAME, own: [] });
  });

  it('draws the DM solid while "As players see it" is on, and only the DM changes', () => {
    seat(dm, { on: true });
    useAsPlayers.getState().set(true);
    expect(fogScene().solid).toBe(true);
    useAsPlayers.getState().set(false);
    expect(fogScene().solid).toBe(false);
  });

  it('takes the cleared record of the level shown, and nothing of another', () => {
    const fog = { on: true, cleared: { upper: cleared([[1, 1]]), lower: cleared([[9, 9]]) } };
    seat(dm, fog, [], 'upper');
    const upper = tierPlan({ frame: fogScene().bounds, cleared: fogScene().cleared });
    expect(upper.cells).toBe(1);
    seat(dm, fog, [], 'lower');
    expect(fogScene().cleared?.bits).toBe(cleared([[9, 9]]).bits);
  });

  it("keeps a player's own token clear, and only on the player's seat", () => {
    const own = token();
    const goblin = token({ id: 'g1', ownerId: null, x: 8.5 });
    seat(player, { on: true }, [own, goblin]);
    expect(fogScene().own).toHaveLength(1);
    seat(dm, { on: true }, [own, goblin]);
    expect(fogScene().own).toEqual([]);
  });

  it('lets a solid seat see only the glow of lights on cleared ground or carried by its own token', () => {
    const pools = [
      { x: 1.5, y: 1.5, inner: 1, outer: 2, warm: true },
      { x: 12.5, y: 5.5, inner: 1, outer: 2, warm: true },
      { x: 18.5, y: 8.5, inner: 1, outer: 2, warm: true },
    ];
    const own = [
      [
        [18, 8],
        [19, 8],
        [19, 9],
        [18, 9],
      ] as [number, number][],
    ];
    expect(glowPools(pools, cleared([[1, 1]]), own).map((p) => p.x)).toEqual([1.5, 18.5]);
    expect(glowPools(pools, undefined, [])).toEqual([]);
  });
});

describe('the mounted fog layer', () => {
  let ticker: Ticker;
  let sceneGraph: SceneGraph;
  let lighting: Container;
  let stop: (() => void) | null = null;

  const mount = (): void => {
    const worldContainer = new Container();
    const layerContainer = new Container();
    worldContainer.addChild(layerContainer);
    const overlayContainer = new Container();
    lighting = new Container();
    lighting.label = 'lightingComposite';
    overlayContainer.addChild(lighting);
    sceneGraph = { worldContainer, layerContainer, overlayContainer } as unknown as SceneGraph;
    ticker = new Ticker();
    setEngineSingleton(
      {
        ticker: () => ticker,
        canvas: () => document.createElement('canvas'),
        viewport: () => ({ width: 800, height: 600 }),
        screenToWorld: (x: number, y: number) => ({ x: x / 20, y: y / 20 }),
        renderToTexture: () => {},
      } as unknown as RenderEngine,
      sceneGraph,
    );
    stop = mountPlayerFogWhenReady();
  };

  afterEach(() => {
    stop?.();
    stop = null;
    clearEngineSingleton();
    ticker.destroy();
  });

  const fogLayer = (): Container => sceneGraph.overlayContainer.children.find((c) => c.label === 'playerFog') as Container;
  const mesh = (): Mesh => fogLayer().children.find((c) => c instanceof Mesh) as Mesh;
  const uniform = (name: string): number =>
    (mesh().shader!.resources.fogUniforms as { uniforms: Record<string, number> }).uniforms[name]!;
  const scrimSprite = (): Sprite => fogLayer().children.find((c) => c instanceof Sprite) as Sprite;
  const probe = () =>
    (window as Window & { __fogProbe?: { dense(): number; solid(): boolean; clearedCells(): number } }).__fogProbe!;
  const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 150));

  it('runs see-through with the edge line on the DM seat whenever fog is on, with no token selected', () => {
    seat(dm, { on: true, cleared: { upper: cleared([[3, 3]]) } });
    mount();
    expect(fogLayer().visible).toBe(true);
    expect(mesh().visible).toBe(true);
    expect(probe().dense()).toBe(DM_DENSE);
    expect(uniform('uDense')).toBe(DM_DENSE);
    expect(uniform('uEdgeLine')).toBe(1);
    // No scrim and no stencil: every token and door mark stays drawn for the DM.
    expect(scrimSprite().visible).toBe(false);
    expect(sightMaskOf(sceneGraph)).toBeNull();
    expect(shownMaskOf(sceneGraph)).toBeNull();
    expect(lighting.alpha).toBe(GRADE_STRENGTH);
  });

  it('turns solid under "As players see it" on the DM seat, and back again', async () => {
    seat(dm, { on: true });
    mount();
    useAsPlayers.getState().set(true);
    await flush();
    expect(probe().solid()).toBe(true);
    expect(uniform('uDense')).toBe(1);
    expect(uniform('uEdgeLine')).toBe(0);
    expect(scrimSprite().visible).toBe(true);
    expect(sightMaskOf(sceneGraph)?.label).toBe(SIGHT_MASK);
    useAsPlayers.getState().set(false);
    await flush();
    expect(uniform('uDense')).toBe(DM_DENSE);
    expect(sightMaskOf(sceneGraph)).toBeNull();
  });

  it('draws a player solid behind the scrim, with no edge line', () => {
    seat(player, { on: true, cleared: { upper: cleared([[3, 3]]) } });
    mount();
    expect(probe().dense()).toBe(1);
    expect(uniform('uEdgeLine')).toBe(0);
    expect(scrimSprite().visible).toBe(true);
    expect(probe().clearedCells()).toBe(1);
  });

  // A wearer that finds no stencil draws unmasked, so a monster could show through fog: on a
  // player's seat both labels are always carried, by the one mask.
  it('feeds both stencils from the one mask on a player seat, so a token under fog is not drawn', () => {
    seat(player, { on: true, cleared: { upper: cleared([[3, 3]]) } }, [token({ id: 'g1', ownerId: null, x: 12.5, y: 5.5 })]);
    mount();
    const sight = sightMaskOf(sceneGraph) as Sprite;
    const shown = shownMaskOf(sceneGraph) as Sprite;
    expect(sight).toBeInstanceOf(Sprite);
    expect(shown.label).toBe(SHOWN_MASK);
    // The same texture, which is the mask the cloud samples: clear only over cleared ground.
    expect(sight.texture).toBe(shown.texture);
    // The goblin's cell is fogged: the mask the stencil carries leaves it out.
    const plan = tierPlan({ frame: FRAME, cleared: fogScene().cleared });
    const cells = plan.ops.find((o) => o.kind === 'cells');
    expect(cells && cells.kind === 'cells' ? cells.cells.data[(5 * 20 + 12) * 4 + 3] : -1).toBe(0);
  });

  it('draws nothing, and labels no stencil, while fog is off', () => {
    seat(player, {});
    mount();
    expect(fogLayer().visible).toBe(false);
    expect(sightMaskOf(sceneGraph)).toBeNull();
    expect(shownMaskOf(sceneGraph)).toBeNull();
  });

  it('hands the composite back at full strength when the table goes away', () => {
    seat(dm, { on: true });
    mount();
    stop!();
    stop = null;
    expect(lighting.alpha).toBe(0.95);
  });
});
