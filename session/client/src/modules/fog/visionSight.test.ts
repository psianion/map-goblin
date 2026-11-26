import { describe, expect, it } from 'vitest';
import type { Layer } from '@dnd/core/src/store/types';
import { placedLights } from './visionSight';

const light = (over: Record<string, unknown> = {}) => ({
  id: 'l1',
  name: 'Brazier',
  childType: 'light',
  visible: true,
  color: '#ff8e3c',
  radius: 9,
  featherRadius: 6,
  intensity: 1,
  falloff: 'quadratic',
  position: { x: 2, y: 3 },
  ...over,
});

const layers = (children: unknown[]) => [{ id: 'L', type: 'dungeon', children }] as unknown as Layer[];

describe('placedLights: the fog glow sees each light as it is drawn', () => {
  it('glows an embers light at a third of its reach, and an off one at its own', () => {
    expect(placedLights(layers([light({ embers: true })]))[0]!.radius).toBeCloseTo(3);
    expect(placedLights(layers([light({ embers: true, visible: false })]))[0]!.radius).toBe(9);
    expect(placedLights(layers([light()]))[0]!.radius).toBe(9);
  });

  it('glows a moving cone`s whole circle, and keeps a still cone`s wedge', () => {
    const cone = { angle: 60, direction: 0 };
    const spin = placedLights(layers([light({ cone, motion: { kind: 'spin', rpm: 6, clockwise: true } })]))[0]!;
    expect(spin.cone).toBeUndefined();
    expect(placedLights(layers([light({ cone })]))[0]!.cone).toEqual(cone);
  });
});
