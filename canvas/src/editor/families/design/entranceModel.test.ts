// A picked cave mouth's Kit tiles and Width: the kit's mouths of its width as pictures, a pick
// changing its piece and its hollow in one undo step, and Width keeping to the widths the kit has.
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import type { CliffEntrance, DungeonLayer, PlateauChild } from '@/store/types';
import { resetAssetPackManager, seedPack } from '@dnd/core/src/testing/seedCatalog';
import type { BandMeasure, ManifestEntry } from '@dnd/core/src/engine/packManifest';
import { entranceKitSwatches, entranceKitValue, pickEntranceKit, resizePickedEntrance } from './entranceModel';

const SET = 'Test_Cliff_Mouths';
const entry = (material: string, gridSize: string, band: BandMeasure): ManifestEntry => ({ type: 'object', material, gridSize, pieceType: 'object', variant: 'A', set: SET, tags: [], band });
const mouth = (L: number, m: [number, number], shadow = false): BandMeasure => ({ joints: [[L / 2, 0.36], [-L / 2, 0.36]], turnDeg: 0, entrance: true, mouth: m, ...(shadow && { shadow: true }) });

function seed(): void {
  seedPack('test-mouths', {
    run_2x2_A: entry('run', '2x2', { joints: [[1.15, 0.36], [-1.15, 0.36]], turnDeg: 0 }),
    run_4x2_A: entry('run', '4x2', { joints: [[2.15, 0.36], [-2.15, 0.36]], turnDeg: 0 }),
    mouth_a1_2x2_A: entry('mouth_a1', '2x2', mouth(2, [0.3, 0.6])),
    mouth_a2_2x2_A: entry('mouth_a2', '2x2', mouth(2, [0.4, 0.7])),
    mouth_a3_3x2_A: entry('mouth_a3', '3x2', mouth(3, [0.35, 0.65])),
    mouth_shadow_a1_2x2_A: entry('mouth_shadow_a1', '2x2', mouth(2, [0.3, 0.6], true)),
  });
}

const layer = () => useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
const plateau = () => layer().children.find((c) => c.id === 'p1') as PlateauChild;
const span = (): CliffEntrance => plateau().entrances![0];

describe('a picked cave mouth', () => {
  beforeEach(() => {
    undoManager.clear();
    resetAssetPackManager();
    useStore.getState().resetToDefault();
    seed();
    useStore.setState((s) => {
      (s.layers.find((l) => l.type === 'dungeon') as DungeonLayer).children.push({
        id: 'p1', name: 'p1', childType: 'plateau', visible: true, contours: [[[10, 10], [16, 10], [16, 14], [10, 14]]], height: 2, edge: 'cliff', edgeArt: SET,
        entrances: [{ id: 'm1', ring: 0, from: 1, to: 3 }],
      } as PlateauChild);
    });
    useStore.getState().setSelectedIds(['entrance:p1:m1']);
  });

  it('shows its kit’s plain mouths of its width as picture tiles, the first on', () => {
    const tiles = entranceKitSwatches(useStore.getState());
    expect(tiles.map((t) => t.value)).toEqual(['0', '1']);
    expect(tiles.every((t) => typeof t.art === 'string' && t.art.length > 0)).toBe(true);
    expect(entranceKitValue(useStore.getState())).toBe('0');
  });

  it('takes the picked tile’s piece and its hollow, in one undo step', () => {
    pickEntranceKit('1');
    expect(span().piece).toBe('mouth_a2_2x2');
    expect(entranceKitValue(useStore.getState())).toBe('1');
    // The hollow, the piece's own, along the edge: two cells from x 11, its mouth 0.4 to 0.7 of the way one way or the other.
    const [m0, m1] = span().mouth!;
    expect(Math.round((m1 - m0) * 100) / 100).toBe(0.6);
    expect([1 + 0.8, 3 - 1.4].map((v) => Math.round(v * 100) / 100)).toContain(Math.round(m0 * 100) / 100);
    undoManager.undo();
    expect(span().piece).toBeUndefined();
  });

  it('resizes to the widths its kit has, nearest first, and drops a piece the new width has not', () => {
    pickEntranceKit('1');
    resizePickedEntrance(['entrance:p1:m1'], 3);
    expect([span().from, span().to]).toEqual([1, 4]);
    expect(span().piece).toBeUndefined();
    expect(span().mouth).toBeDefined();
    // No 1-cell piece: the nearest width the kit has is 2.
    resizePickedEntrance(['entrance:p1:m1'], 1);
    expect([span().from, span().to]).toEqual([1, 3]);
  });

  it('with none picked, a tile is the piece the next mouths take', () => {
    useStore.getState().setSelectedIds([]);
    useStore.getState().updateToolSettings({ doorWidth: 2 });
    useStore.getState().setActiveLayerId(layer().id);
    expect(entranceKitSwatches(useStore.getState()).map((t) => t.value)).toEqual(['0', '1']);
    pickEntranceKit('1');
    expect(useStore.getState().tools.settings.entranceVariant).toBe(1);
    expect(span().piece).toBeUndefined();
  });
});
