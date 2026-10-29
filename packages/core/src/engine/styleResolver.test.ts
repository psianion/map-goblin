import { describe, it, expect } from 'vitest';
import { resolveStyle } from './styleResolver';
import type { DungeonStyle } from '../store/types';

const BASE_STYLE: DungeonStyle = {
  floorColor: '#c8b89a',
  wallColor: '#222222',
  wallWidth: 0.5,
  lineWidth: 1,
  edgeTransitionWidth: 0.5,
  showEdgeTransitions: true,
  wallTextureTint: '#ffffff',
};

describe('resolveStyle', () => {
  it('returns layer style when no overrides', () => {
    expect(resolveStyle(BASE_STYLE, undefined)).toBe(BASE_STYLE);
  });

  it('returns layer style when overrides is empty object', () => {
    const result = resolveStyle(BASE_STYLE, {});
    expect(result.floorColor).toBe('#c8b89a');
  });

  it('overrides specific fields', () => {
    const result = resolveStyle(BASE_STYLE, { floorColor: '#ff0000' });
    expect(result.floorColor).toBe('#ff0000');
    expect(result.wallColor).toBe('#222222'); // inherited
  });

  it('overrides multiple fields', () => {
    const result = resolveStyle(BASE_STYLE, {
      floorColor: '#ff0000',
      wallColor: '#00ff00',
      showEdgeTransitions: false,
    });
    expect(result.floorColor).toBe('#ff0000');
    expect(result.wallColor).toBe('#00ff00');
    expect(result.showEdgeTransitions).toBe(false);
    expect(result.wallWidth).toBe(0.5); // inherited
  });

  it('does not mutate the layer style', () => {
    const original = { ...BASE_STYLE };
    resolveStyle(BASE_STYLE, { floorColor: '#ff0000' });
    expect(BASE_STYLE).toEqual(original);
  });
});
