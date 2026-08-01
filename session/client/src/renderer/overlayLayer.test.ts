// What draws over what, pinned at the one list that decides it.
//
// The regression this exists for: door marks were mounted into the world container while
// the player's fog mask lives in screen space. A world child can never sort above a screen
// child — `app.stage` holds [worldContainer, overlayContainer] in that order — so no
// `OVERLAY_STACK` rank could lift the marks over the mask. A door sits on a room boundary,
// so the scrim's own edge covered ~95% of its mark, and the session doors-table row that
// asks "did the player's canvas move when a floor-ring door opened" read a canvas that had
// not moved. Two things had to be true to fix it, and both are pinned below: the door
// overlay is in the same container as the fog, and it outranks it there.

import { describe, expect, it } from 'vitest';
import { Container } from 'pixi.js';
import type { SceneGraph } from '@dnd/core/src/engine/sceneGraph';
import {
  OVERLAY_STACK,
  addScreenOverlay,
  addWorldOverlay,
  type OverlayLabel,
} from './overlayLayer';

/** The two containers overlays mount into, plus the multiply the screen ones draw above. */
function fakeSceneGraph(): SceneGraph {
  const worldContainer = new Container();
  const layerContainer = new Container();
  layerContainer.label = 'layerContainer';
  worldContainer.addChild(layerContainer);

  const overlayContainer = new Container();
  const lighting = new Container();
  lighting.label = 'lightingComposite';
  const transition = new Container();
  transition.label = 'fogTransition';
  overlayContainer.addChild(lighting, transition);

  return { worldContainer, layerContainer, overlayContainer } as unknown as SceneGraph;
}

const labels = (parent: Container): string[] => parent.children.map((c) => String(c.label));

const rank = (label: OverlayLabel): number => OVERLAY_STACK.indexOf(label);

describe('OVERLAY_STACK', () => {
  it('draws door marks over the player mask and tokens under it', () => {
    // Tokens under the mask: a token in a room the party cannot see stays hidden, and
    // moving it behind the dark must not leak where it went.
    expect(rank('tokenLayer')).toBeLessThan(rank('playerFog'));
    // Door marks over it: what a player holds has already been redacted by the referee
    // (PRODUCT principle 2) — only doors bound to an explored room are ever sent, and an
    // unrevealed secret never is — so a mark above the mask shows only what was earned.
    expect(rank('doorOverlay')).toBeGreaterThan(rank('playerFog'));
    // The DM's tint stays at the bottom, which is principle 3 as a draw order.
    expect(rank('fogOverlay')).toBe(0);
  });
});

describe('addWorldOverlay', () => {
  it('ranks overlays whatever order the panels mount them in', () => {
    for (const order of [
      ['tokenLayer', 'fogOverlay'],
      ['fogOverlay', 'tokenLayer'],
    ] as OverlayLabel[][]) {
      const sceneGraph = fakeSceneGraph();
      for (const label of order) addWorldOverlay(sceneGraph, new Container(), label);
      expect(labels(sceneGraph.worldContainer)).toEqual([
        'layerContainer',
        'fogOverlay',
        'tokenLayer',
      ]);
    }
  });
});

describe('addScreenOverlay', () => {
  it('puts door marks above the fog mask whichever mounts first', () => {
    for (const order of [
      ['playerFog', 'doorOverlay'],
      ['doorOverlay', 'playerFog'],
    ] as OverlayLabel[][]) {
      const sceneGraph = fakeSceneGraph();
      for (const label of order) addScreenOverlay(sceneGraph, new Container(), label);
      const drawn = labels(sceneGraph.overlayContainer);
      // Above the lighting multiply (D12), below the map-switch transition, and the marks
      // above the mask. Mount order used to decide the middle of that.
      expect(drawn).toEqual([
        'lightingComposite',
        'playerFog',
        'doorOverlay',
        'fogTransition',
      ]);
    }
  });

  it('still ranks when there is no lighting engine to sit above', () => {
    const overlayContainer = new Container();
    const sceneGraph = { overlayContainer } as unknown as SceneGraph;
    addScreenOverlay(sceneGraph, new Container(), 'doorOverlay');
    addScreenOverlay(sceneGraph, new Container(), 'playerFog');
    expect(labels(overlayContainer)).toEqual(['playerFog', 'doorOverlay']);
  });
});
