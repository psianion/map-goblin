import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store';

describe('bakeSelectionTransform', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault();
  });

  it('no-ops when selectionTransform is null', () => {
    const region: [number, number][][] = [[[0, 0], [10, 0], [10, 10], [0, 10]]];
    useStore.getState().setSelectedRegion(region);
    useStore.getState().bakeSelectionTransform();
    expect(useStore.getState().selection.selectedRegion).toEqual(region);
  });

  it('no-ops when selectedRegion is null', () => {
    useStore.getState().setSelectionTransform({ translate: [5, 5], rotate: 0, scale: [1, 1] });
    useStore.getState().bakeSelectionTransform();
    // Should not throw
    expect(useStore.getState().selection.selectionTransform).toBeNull();
  });

  it('applies translate-only transform', () => {
    const region: [number, number][][] = [[[0, 0], [10, 0], [10, 10], [0, 10]]];
    useStore.getState().setSelectedRegion(region);
    useStore.getState().setSelectionTransform({ translate: [5, 5], rotate: 0, scale: [1, 1] });
    useStore.getState().bakeSelectionTransform();

    const baked = useStore.getState().selection.selectedRegion!;
    expect(baked[0][0]).toEqual([5, 5]);
    expect(baked[0][1]).toEqual([15, 5]);
    expect(baked[0][2]).toEqual([15, 15]);
    expect(baked[0][3]).toEqual([5, 15]);
  });

  it('applies scale-only transform', () => {
    const region: [number, number][][] = [[[10, 10], [20, 10], [20, 20], [10, 20]]];
    useStore.getState().setSelectedRegion(region);
    useStore.getState().setSelectionTransform({ translate: [0, 0], rotate: 0, scale: [2, 2] });
    useStore.getState().bakeSelectionTransform();

    const baked = useStore.getState().selection.selectedRegion!;
    expect(baked[0][0]).toEqual([20, 20]);
    expect(baked[0][2]).toEqual([40, 40]);
  });

  it('applies 90-degree rotation transform', () => {
    const region: [number, number][][] = [[[10, 0]]];
    useStore.getState().setSelectedRegion(region);
    useStore.getState().setSelectionTransform({ translate: [0, 0], rotate: Math.PI / 2, scale: [1, 1] });
    useStore.getState().bakeSelectionTransform();

    const baked = useStore.getState().selection.selectedRegion!;
    expect(baked[0][0][0]).toBeCloseTo(0, 5);
    expect(baked[0][0][1]).toBeCloseTo(10, 5);
  });

  it('applies combined transform (scale + rotate + translate)', () => {
    const region: [number, number][][] = [[[10, 0]]];
    useStore.getState().setSelectedRegion(region);
    useStore.getState().setSelectionTransform({ translate: [5, 5], rotate: Math.PI / 2, scale: [2, 1] });
    useStore.getState().bakeSelectionTransform();

    const baked = useStore.getState().selection.selectedRegion!;
    // scale: [20, 0] → rotate 90°: [0, 20] → translate: [5, 25]
    expect(baked[0][0][0]).toBeCloseTo(5, 5);
    expect(baked[0][0][1]).toBeCloseTo(25, 5);
  });

  it('clears selectionTransform after bake', () => {
    const region: [number, number][][] = [[[0, 0]]];
    useStore.getState().setSelectedRegion(region);
    useStore.getState().setSelectionTransform({ translate: [1, 1], rotate: 0, scale: [1, 1] });
    useStore.getState().bakeSelectionTransform();
    expect(useStore.getState().selection.selectionTransform).toBeNull();
  });
});
