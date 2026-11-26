import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '@/store/store';
import type { AnyChild, DungeonLayer } from '@/store/types';
import type { WallSegment } from '@/shared/types';
import { selectionOverlayModel } from './selectionOverlay';

const layer = (): DungeonLayer => useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
const asset = (id: string, extra: Record<string, unknown> = {}): AnyChild => {
  const a = {
    id, name: id, childType: 'asset', visible: true, objectType: 'asset', assetId: 'a', position: { x: 2, y: 2 }, rotation: 0,
    scale: 1, width: 2, height: 2, tint: '#ffffff', flipX: false, flipY: false, ...extra,
  } as unknown as AnyChild;
  useStore.getState().addChild(layer().id, a);
  return a;
};

describe('selection overlay model', () => {
  beforeEach(() => useStore.getState().resetToDefault());

  it('draws nothing with nothing selected', () => {
    asset('p', { locked: true });
    expect(selectionOverlayModel(useStore.getState()).locked).toEqual([]);
  });

  it('outlines each locked selected member, at its box', () => {
    asset('p', { locked: true });
    asset('q');
    useStore.getState().setSelectedIds(['p', 'q']);
    expect(selectionOverlayModel(useStore.getState()).locked).toEqual([{ id: 'p', box: { x: 1, y: 1, width: 2, height: 2 } }]);
  });

  it('a locked wall gets its band box', () => {
    const w = { id: 'w', points: [[0, 0], [4, 0]], wallType: 'normal', direction: 'both', color: '#000', roughness: 0, width: 0.4, locked: true } as WallSegment;
    useStore.getState().addWall(layer().id, w);
    useStore.getState().setSelectedIds(['w']);
    const [{ box }] = selectionOverlayModel(useStore.getState()).locked;
    expect(box.width).toBeGreaterThan(4);
    expect(box.y).toBeLessThan(0);
  });

  it('a locked light gets its badge at the marker, not at its radius box', () => {
    const light = {
      id: 'l', name: 'l', childType: 'light', visible: true, locked: true, color: '#ffcc66', radius: 8, featherRadius: 1,
      intensity: 0.8, falloff: 'linear', position: { x: 10, y: 10 },
    } as unknown as AnyChild;
    useStore.getState().addChild(layer().id, light);
    useStore.getState().setSelectedIds(['l']);
    expect(selectionOverlayModel(useStore.getState()).locked).toEqual([{ id: 'l', box: { x: 9.5, y: 9.5, width: 1, height: 1 } }]);
  });

  it('picked stairs are outlined round their flight, and follow a resize', () => {
    const plateau = {
      id: 'p1', name: 'p1', childType: 'plateau', visible: true, contours: [[[10, 10], [14, 10], [14, 14], [10, 14]]], height: 2, edge: 'cliff',
      stairs: [{ id: 's1', ring: 0, from: 1, to: 3 }],
    } as unknown as AnyChild;
    useStore.getState().addChild(layer().id, plateau);
    expect(selectionOverlayModel(useStore.getState()).stairs).toEqual([]);
    useStore.getState().setSelectedIds(['stairs:p1:s1']);
    const xs = (i = 0) => selectionOverlayModel(useStore.getState()).stairs[i].map(([x]) => x);
    const ys = (i = 0) => selectionOverlayModel(useStore.getState()).stairs[i].map(([, y]) => y);
    // Two cells along the edge y 10 from x 11, two cells down to y 8.
    expect([Math.min(...xs()), Math.max(...xs())]).toEqual([11, 13]);
    expect([Math.min(...ys()), Math.max(...ys())]).toEqual([8, 10]);
    useStore.getState().updateChild(layer().id, 'p1', { stairs: [{ id: 's1', ring: 0, from: 1, to: 4 }] } as never);
    expect(Math.max(...xs())).toBe(14);
  });

  it('an unlocked selection draws no lock', () => {
    asset('p');
    useStore.getState().setSelectedIds(['p']);
    expect(selectionOverlayModel(useStore.getState()).locked).toHaveLength(0);
  });
});
