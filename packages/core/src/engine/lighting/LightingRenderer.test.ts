import { describe, expect, it } from 'vitest';
import { lightingSignature } from './LightingRenderer';
import type { LightChild } from '../../store/types';

/**
 * The lighting composite is skipped when its signature is unchanged, so the signature is
 * the whole of the guard's correctness: anything that moves the picture and is *not* in
 * here becomes a frame that silently keeps the previous one.
 *
 * Measured on the dressed gate map (Emberhold, 4 lights, 206 walls, 1280x720): the pass it
 * guards costs ~2-3ms of a ~22ms frame, and uploads one gradient texture per light per
 * frame. An idle table changes none of these fields.
 */

const light = (over: Partial<LightChild> = {}): LightChild => ({
  id: 'light-1',
  name: 'Brazier',
  childType: 'light',
  visible: true,
  color: '#ffaa55',
  radius: 40,
  featherRadius: 8,
  intensity: 0.9,
  falloff: 'quadratic',
  position: { x: 12, y: 20 },
  ...over,
});

const clean = () => false;
const sig = (
  lights: LightChild[] = [light()],
  cam: [number, number, number] = [100, 200, 1.5],
  size: [number, number] = [1280, 720],
  ambient = '#0d0e12',
  isDirty: (id: string) => boolean = clean,
) => lightingSignature(cam[0], cam[1], cam[2], size[0], size[1], ambient, lights, isDirty);

describe('lightingSignature', () => {
  it('is stable while nothing moves — the frame the guard skips', () => {
    expect(sig()).toBe(sig());
  });

  /**
   * One case per input the composite reads. The light positions are converted to *screen*
   * space before they are drawn, which is why the camera counts as much as the light does.
   */
  const changes: [string, () => string][] = [
    ['camera x (pan)', () => sig([light()], [101, 200, 1.5])],
    ['camera y (pan)', () => sig([light()], [100, 201, 1.5])],
    ['zoom', () => sig([light()], [100, 200, 1.6])],
    ['viewport width', () => sig([light()], [100, 200, 1.5], [1281, 720])],
    ['viewport height', () => sig([light()], [100, 200, 1.5], [1280, 721])],
    ['ambient colour', () => sig([light()], [100, 200, 1.5], [1280, 720], '#101014')],
    ['light moved', () => sig([light({ position: { x: 13, y: 20 } })])],
    ['light radius', () => sig([light({ radius: 41 })])],
    ['light colour', () => sig([light({ color: '#ff0000' })])],
    ['light intensity', () => sig([light({ intensity: 0.5 })])],
    ['light falloff', () => sig([light({ falloff: 'linear' })])],
    ['light feather', () => sig([light({ featherRadius: 9 })])],
    ['light mask texture', () => sig([light({ maskTextureId: 'pack:mask' })])],
    ['a different light', () => sig([light({ id: 'light-2' })])],
    ['a second light', () => sig([light(), light({ id: 'light-2' })])],
    ['no lights at all', () => sig([])],
    // A door swings or a wall moves and LightManager marks the polygon stale: the geometry
    // changed underneath a light that did not itself move.
    ['visibility polygon invalidated', () => sig([light()], [100, 200, 1.5], [1280, 720], '#0d0e12', () => true)],
  ];

  for (const [what, produce] of changes) {
    it(`changes when ${what}`, () => {
      expect(produce()).not.toBe(sig());
    });
  }

  it('does not confuse a moved light with a moved camera', () => {
    expect(sig([light({ position: { x: 13, y: 20 } })])).not.toBe(sig([light()], [101, 200, 1.5]));
  });
});
