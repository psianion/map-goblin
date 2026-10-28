// The overhead layer at the table: core's overhead container lifted above the tokens and
// handed back, the seat's stencil, and the fade for a token standing under a prop.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container, type Sprite, type Ticker } from 'pixi.js';
import type { RenderEngine } from '@dnd/core/src/engine/RenderEngine';
import type { SceneGraph } from '@dnd/core/src/engine/sceneGraph';
import type { Obb } from '@dnd/core/src/engine/tools/propPlacement';
import { SHOWN_MASK, SIGHT_MASK } from '../../renderer/overlayLayer';
import { useSessionStore } from '../../session/store';
import { OVERHEAD_FADE, mountOverheadLayer, obbContains } from './OverheadLayer';

// Core's side of the seam: the overhead sprites with their boxes, and the one way to fade them.
const core = vi.hoisted(() => ({
  entries: [] as { childId: string; sprite: Sprite; obb: Obb }[],
  fades: new Map<string, number>(),
  calls: 0,
}));
vi.mock('@dnd/core/src/engine/subscribeToAssets', () => ({
  overheadEntries: () => core.entries,
  setOverheadFade: (childId: string, alpha: number) => {
    core.calls += 1;
    core.fades.set(childId, alpha);
  },
}));

const labelled = (label: string): Container => {
  const c = new Container();
  c.label = label;
  return c;
};

/** The two containers the layer touches, laid out the way the table's engine lays them out. */
function fakeSceneGraph() {
  const worldContainer = labelled('worldContainer');
  const layerContainer = labelled('layerContainer');
  const overheadContainer = labelled('overheadContainer');
  worldContainer.addChild(layerContainer, overheadContainer, labelled('previewContainer'));

  const overlayContainer = labelled('overlayContainer');
  const fog = labelled('playerFog');
  const sight = labelled(SIGHT_MASK);
  const shown = labelled(SHOWN_MASK);
  fog.addChild(sight, shown);
  overlayContainer.addChild(
    labelled('lightingComposite'),
    fog,
    labelled('tokenLayer'),
    labelled('turnRing'),
    labelled('doorOverlay'),
    labelled('fogTransition'),
  );
  const sceneGraph = { worldContainer, layerContainer, overheadContainer, overlayContainer } as unknown as SceneGraph;
  return { sceneGraph, fog, shown };
}

/** A ticker the test drives by hand, one frame at a time. */
function fakeEngine() {
  let tick: ((t: Ticker) => void) | null = null;
  const engine = {
    ticker: () => ({
      add: (fn: (t: Ticker) => void) => {
        tick = fn;
      },
      remove: () => {
        tick = null;
      },
    }),
  } as unknown as RenderEngine;
  const frames = (ms: number, frameMs = 1000 / 60) => {
    for (let t = 0; t < ms; t += frameMs) tick?.({ deltaMS: frameMs } as Ticker);
  };
  return { engine, frames, ticking: () => tick !== null };
}

/** A canopy 4 × 2 at (10, 10), turned a quarter: it covers x 9..11 and y 8..12. */
const CANOPY: Obb = { cx: 10, cy: 10, hw: 2, hh: 1, rot: Math.PI / 2 };
const ELSEWHERE: Obb = { cx: 30, cy: 30, hw: 1, hh: 1, rot: 0 };

const entry = (childId: string, obb: Obb) => ({ childId, obb, sprite: { alpha: 1, tint: 0xffffff } as Sprite });

function seat(role: 'dm' | 'player', at: { x: number; y: number } | null): void {
  const scene = at ? { t1: { id: 't1', name: 'Borin', size: 'medium', x: at.x, y: at.y } } : {};
  useSessionStore.setState({
    you: { role } as never,
    session: { activeSceneId: 's1', modules: { tokens: { library: {}, byScene: { s1: scene } } } } as never,
  });
}

const fadeOf = (childId: string): number => core.fades.get(childId) ?? 1;

beforeEach(() => {
  core.entries = [entry('canopy', CANOPY), entry('far', ELSEWHERE)];
  core.fades.clear();
  core.calls = 0;
});

afterEach(() => {
  useSessionStore.setState({ you: null, session: null });
});

describe('obbContains', () => {
  it('tests a point against the box on its own axes', () => {
    expect(obbContains(CANOPY, 10, 11.5)).toBe(true);
    expect(obbContains(CANOPY, 11.5, 10)).toBe(false);
    expect(obbContains(CANOPY, 11, 12)).toBe(true); // a corner counts
    expect(obbContains({ cx: 0, cy: 0, hw: 2, hh: 1, rot: Math.PI / 4 }, 1, 1)).toBe(true);
    expect(obbContains({ cx: 0, cy: 0, hw: 2, hh: 1, rot: Math.PI / 4 }, 1, -1)).toBe(false);
  });
});

describe('mountOverheadLayer', () => {
  it('leaves the overhead art in the world, under the lighting multiply, on every seat', () => {
    // Decision 10: overhead props take the lighting like everything else, at the table too.
    const { sceneGraph } = fakeSceneGraph();
    const { engine, ticking } = fakeEngine();
    const worldBefore = sceneGraph.worldContainer.children.map((c) => c.label);
    const parentBefore = sceneGraph.overheadContainer.parent;

    const unmount = mountOverheadLayer(engine, sceneGraph);
    expect(sceneGraph.overheadContainer.parent).toBe(parentBefore);
    expect(sceneGraph.overlayContainer.children.map((c) => c.label)).not.toContain('overheadProps');

    unmount();
    expect(sceneGraph.worldContainer.children.map((c) => c.label)).toEqual(worldBefore);
    expect(ticking()).toBe(false);
  });

  it('reports itself unlifted and wearing no stencil: the fog above covers it like the floor', () => {
    const { sceneGraph } = fakeSceneGraph();
    const { engine, frames } = fakeEngine();
    const unmount = mountOverheadLayer(engine, sceneGraph);
    for (const role of ['player', 'dm'] as const) {
      seat(role, null);
      frames(16);
      const probe = (window as Window & { __overheadProbe?: () => { lifted: boolean; mask: string | null } })
        .__overheadProbe!();
      expect(probe.lifted).toBe(false);
      expect(probe.mask).toBeNull();
      expect(sceneGraph.overheadContainer.mask ?? null).toBeNull();
    }
    unmount();
  });

  it('fades a prop for a token under it, eased, and restores it when the token walks away', () => {
    for (const role of ['dm', 'player'] as const) {
      core.fades.clear();
      const { sceneGraph } = fakeSceneGraph();
      const { engine, frames } = fakeEngine();
      const unmount = mountOverheadLayer(engine, sceneGraph);

      seat(role, { x: 10.5, y: 11.5 });
      frames(1000 / 60);
      // Eased, not snapped: one frame in, it has started and is still on its way.
      expect(fadeOf('canopy')).toBeLessThan(1);
      expect(fadeOf('canopy')).toBeGreaterThan(OVERHEAD_FADE);
      frames(100);
      expect(fadeOf('canopy')).toBeLessThan(0.4);
      frames(100);
      expect(fadeOf('canopy')).toBeCloseTo(OVERHEAD_FADE, 1);
      expect(core.fades.has('far')).toBe(false);

      seat(role, { x: 11.5, y: 10.5 }); // beside the canopy's long side, outside its turned box
      frames(500);
      expect(fadeOf('canopy')).toBe(1);
      unmount();
    }
  });

  it('writes nothing to core once every prop has settled', () => {
    const { sceneGraph } = fakeSceneGraph();
    const { engine, frames } = fakeEngine();
    const unmount = mountOverheadLayer(engine, sceneGraph);

    seat('player', { x: 20, y: 20 });
    frames(500);
    expect(core.calls).toBe(0);

    seat('player', { x: 10, y: 10 });
    frames(1000);
    const settled = core.calls;
    frames(1000);
    expect(core.calls).toBe(settled);
    expect(fadeOf('canopy')).toBe(OVERHEAD_FADE);
    unmount();
  });

  it('puts a faded prop back to full strength on unmount', () => {
    const { sceneGraph } = fakeSceneGraph();
    const { engine, frames } = fakeEngine();
    const unmount = mountOverheadLayer(engine, sceneGraph);
    seat('player', { x: 10, y: 10 });
    frames(300);
    expect(fadeOf('canopy')).toBeLessThan(0.4);
    unmount();
    expect(fadeOf('canopy')).toBe(1);
  });
});
