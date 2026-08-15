// The clip, and when it gets cut.
//
// Two gate walks found the shadow pass computing correct geometry and rendering nothing: the
// stencil it was masked by had been cut from a floor union that had not arrived yet, and the
// draw memo the cut was hiding behind keys on nothing the union moves. This reproduces that
// exact shape — a map loaded with floors but `mergedFloor: null`, then the union landing with
// no other input changing — so it cannot come back.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock classes live inside the factory — vi.mock is hoisted above any top-level class
// declaration it would otherwise close over (TDZ).
vi.mock('pixi.js', () => {
  class MockContainer {
    children: MockContainer[] = [];
    label = '';
    visible = true;
    destroyed = false;
    blendMode = 'normal';
    mask: unknown = null;
    /** Every `poly`/`rect` since the last `clear`, and every `fill` that committed them. */
    paths = 0;
    fills = 0;
    addChild(c: MockContainer): MockContainer {
      this.children.push(c);
      return c;
    }
    removeChild(c: MockContainer): void {
      const i = this.children.indexOf(c);
      if (i >= 0) this.children.splice(i, 1);
    }
    destroy(): void {
      this.destroyed = true;
    }
  }
  class MockGraphics extends MockContainer {
    clear(): this {
      this.paths = 0;
      this.fills = 0;
      return this;
    }
    poly(): this {
      this.paths++;
      return this;
    }
    rect(): this {
      this.paths++;
      return this;
    }
    fill(): this {
      this.fills++;
      return this;
    }
  }
  class MockSprite extends MockContainer {
    anchor = { set: (): void => {} };
    position = { set: (): void => {} };
    scale = { set: (): void => {} };
    skew = { x: 0 };
    alpha = 1;
    tint = 0;
    texture: unknown;
  }
  return { Container: MockContainer, Graphics: MockGraphics, Sprite: MockSprite };
});
vi.mock('./sceneGraph', () => ({ getLayerEntry: vi.fn() }));
// Clipper2's WASM is not loaded in a unit test (its real `intersection` answers [] without it),
// so the clip is the identity here — what is asserted is *which* ground the pass hands it and
// whether it draws at all, not Clipper's own arithmetic.
vi.mock('../geometry/Clipper2Engine', () => ({
  clipper2Engine: { intersection: (subjects: unknown[], clips: unknown[]) => (clips.length > 0 ? subjects : []) },
}));

import { Container } from 'pixi.js';
import { updateShadows } from './shadowPass';
import { setTableWorld } from './worldOverride';
import { resolveWorldLight, type MapEnvironment } from '../shared/world';
import { SHADOW_STEPS } from '../shared/shadows';
import { useStore } from '../store/store';
import { getLayerEntry } from './sceneGraph';
import type { DungeonLayer, Polygon } from '../store/types';

const MAP: MapEnvironment = { environment: 'outdoor', naturalLight: true, orientation: 90 };
/** 17:00 — a low sun, well clear of the sunset zero. */
const EVENING = 1020;
const frameAt = (minutes: number): { minutes: number; sun: ReturnType<typeof resolveWorldLight>['sun'] } => ({
  minutes,
  sun: resolveWorldLight({ ...MAP, clockMinutes: minutes, nightSky: 'full-moon' }).sun,
});

const COURTYARD: Polygon[] = [[[2, 43], [26, 43], [26, 58], [2, 58]]];

/** Fresh id per test: the pass keeps per-layer state keyed on it, for the life of the module. */
let nextId = 0;

/** One standalone wall, no floor union yet — a map as it arrives off the wire. */
const freshLayer = (): DungeonLayer =>
  ({
    id: `dungeon-${++nextId}`,
    type: 'dungeon',
    children: [],
    mergedFloor: null,
    standaloneWalls: [
      { id: 'w1', points: [[9, 43], [26, 43]], wallType: 'normal', direction: 'both', color: '#26221c', width: 0.5, roughness: 0 },
    ],
  }) as unknown as DungeonLayer;

/** What the mocked Graphics records — the real type knows nothing of these counters. */
interface Recorder {
  label: string;
  paths: number;
  fills: number;
  mask: unknown;
  children: Recorder[];
}

const childLabelled = (parent: unknown, label: string): Recorder =>
  (parent as Recorder).children.find((c) => c.label === label)!;


describe('the shadow clip', () => {
  let entry: { container: InstanceType<typeof Container>; sublayers: Record<string, InstanceType<typeof Container>> };

  const drawnOf = (): Recorder => childLabelled(entry.sublayers.shadows, 'wallShadows');

  beforeEach(() => {
    useStore.getState().resetToDefault();
    const container = new Container();
    const shadows = new Container();
    container.addChild(shadows);
    entry = { container, sublayers: { shadows } as never };
    vi.mocked(getLayerEntry).mockReturnValue(entry as never);
  });

  afterEach(() => setTableWorld(null));

  it('draws once the floor union lands, though nothing else changed', () => {
    const layer = freshLayer();
    const frame = frameAt(EVENING);

    // Frame 1: on screen, sun casting, and no union yet — `subscribeToStore` only builds it for
    // a layer whose scene-graph entry exists, so it lands a notification later than this.
    updateShadows([layer], 1, frame);
    expect(drawnOf().fills).toBe(0);

    // The union arrives. No wall edited, no clock tick, no orientation nudge — every term the
    // draw memo used to key on is byte-identical, which is exactly why this used to be missed.
    layer.mergedFloor = COURTYARD;
    updateShadows([layer], 1, frame);
    expect(drawnOf().fills).toBe(SHADOW_STEPS);
    expect(drawnOf().paths).toBeGreaterThan(0);
  });

  it('takes the painted terrain as ground too, with no floor under it', () => {
    const layer = freshLayer();
    updateShadows([layer], 1, frameAt(EVENING));
    expect(drawnOf().fills).toBe(0);

    useStore.setState((s) => {
      s.mapSettings.terrain = { palette: [], bounds: { minX: 0, minY: 0, maxX: 30, maxY: 30 } };
    });
    updateShadows([layer], 1, frameAt(EVENING));
    expect(drawnOf().fills).toBe(SHADOW_STEPS);
  });

  it('leaves a wall standing in the void casting nothing', () => {
    // No floors, no terrain: correct behaviour, not a gap to paper over.
    updateShadows([freshLayer()], 1, frameAt(EVENING));
    expect(drawnOf().fills).toBe(0);
    expect(drawnOf().paths).toBe(0);
  });

  it('redraws when the floor is edited, not just when it first lands', () => {
    const layer = freshLayer();
    layer.mergedFloor = COURTYARD;
    updateShadows([layer], 1, frameAt(EVENING));
    const first = drawnOf().paths;
    layer.mergedFloor = [[[0, 0], [40, 0], [40, 40], [0, 40]]];
    updateShadows([layer], 1, frameAt(EVENING));
    expect(drawnOf().paths).toBe(first);
    expect(drawnOf().fills).toBe(SHADOW_STEPS);
  });

  it('hangs no PixiJS mask on the sublayer — the clip is in the geometry', () => {
    const layer = freshLayer();
    layer.mergedFloor = COURTYARD;
    updateShadows([layer], 1, frameAt(EVENING));
    expect(entry.sublayers.shadows.mask).toBeNull();
    expect(entry.container.children.some((c) => c.label === 'shadowClip')).toBe(false);
  });
});
