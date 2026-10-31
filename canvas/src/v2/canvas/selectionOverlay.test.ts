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

  it('an unlocked selection draws no lock', () => {
    asset('p');
    useStore.getState().setSelectedIds(['p']);
    expect(selectionOverlayModel(useStore.getState()).locked).toHaveLength(0);
  });
});
