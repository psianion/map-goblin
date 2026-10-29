import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store';
import { MAX_SCATTER_TINTS, PROPS_RANGES } from './tools';

const brush = () => useStore.getState().tools.settings.scatterBrush;

describe('updateScatterBrushSettings — Props tool clamps', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
  });

  it('starts with the Props defaults: stamping, square, the Scatter board’s switches and spacing', () => {
    expect(brush()).toMatchObject({
      stampMode: true,
      stampRotation: 0,
      stampScale: 1,
      stampFlipX: false,
      stampVary: false,
      tints: [],
      randomVariant: true,
      minSpacing: 0.5,
      avoidOverlap: true,
      stayOnFloor: true,
      placeUnder: false,
    });
    expect(brush()).not.toHaveProperty('count');
  });

  it('clamps density, stamp scale and brush radius to their ranges', () => {
    const { updateScatterBrushSettings } = useStore.getState();
    updateScatterBrushSettings({ density: 9, stampScale: 0.01, brushRadius: 40 });
    expect(brush().density).toBe(PROPS_RANGES.density.max);
    expect(brush().stampScale).toBe(PROPS_RANGES.stampScale.min);
    expect(brush().brushRadius).toBe(PROPS_RANGES.brushRadius.max);
    updateScatterBrushSettings({ density: 0, stampScale: 10, brushRadius: 0 });
    expect(brush().density).toBe(PROPS_RANGES.density.min);
    expect(brush().stampScale).toBe(PROPS_RANGES.stampScale.max);
    expect(brush().brushRadius).toBe(PROPS_RANGES.brushRadius.min);
  });

  it('keeps the stamp angle within one turn, and at most four tints', () => {
    const { updateScatterBrushSettings } = useStore.getState();
    updateScatterBrushSettings({ stampRotation: -Math.PI / 2 });
    expect(brush().stampRotation).toBeCloseTo((3 * Math.PI) / 2);
    updateScatterBrushSettings({ stampRotation: 2 * Math.PI + Math.PI / 12 });
    expect(brush().stampRotation).toBeCloseTo(Math.PI / 12);
    updateScatterBrushSettings({ tints: ['#a00000', '#00a000', '#0000a0', '#a0a000', '#00a0a0'] });
    expect(brush().tints).toHaveLength(MAX_SCATTER_TINTS);
  });
});
