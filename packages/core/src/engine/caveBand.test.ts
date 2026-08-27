import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { caveBandPieces, placeOnChord, type CaveKitPiece, type KitPlacement } from '../assets/caveWallKit';
import { getEntriesByType } from '../assets/packCatalog';
import { getAssetPackManager, resetAssetPackManager } from './assetPackInstance';
import type { PackManifest } from './assetPackManager';
import { createDungeonLayer } from '../store/factories';
import { detectBands, type Vec } from './caveBand';
import type { AssetChild } from '../shared/types';
import type { DungeonLayer, Layer } from '../store/types';

// The real gg-demo manifest, not a fixture: a piece finds its art through
// `material` + `gridSize`, so a hand-written manifest would only prove the test
// agrees with itself. From process.cwd() (packages/core under vitest) rather than
// import.meta.url, which jsdom hands back as an http URL.
const REPO = resolve(process.cwd(), '../..');

beforeAll(() => {
  resetAssetPackManager();
  const dir = resolve(REPO, 'canvas/public/packs/gg-demo');
  const file = readdirSync(dir).find((f) => /^pack-[0-9a-f]+\.json$/.test(f))!;
  const manifest = JSON.parse(readFileSync(`${dir}/${file}`, 'utf8')) as PackManifest;
  const manager = getAssetPackManager();
  (manager as unknown as { manifestCache: Map<string, PackManifest> }).manifestCache.set(
    'gg-demo',
    manifest,
  );
  manager.catalogVersion++;
});

const dist = (a: Vec, b: Vec): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

const assetIdFor = (key: string): string =>
  getEntriesByType('object').find((e) => `${e.material}_${e.gridSize}` === key)!.id;

function assetChild(id: string, assetId: string, at: KitPlacement): AssetChild {
  return {
    id,
    name: 'band piece',
    childType: 'asset',
    objectType: 'asset',
    assetId,
    position: at.position,
    rotation: at.rotation,
    scale: at.scale,
    width: 1,
    height: 1,
    tint: '#ffffff',
    flipX: false,
    flipY: at.flipY ?? false,
    visible: true,
  };
}

/** A layer holding the given children and nothing else. */
function layerOf(children: AssetChild[]): DungeonLayer {
  return { ...createDungeonLayer('Cave'), children };
}

/** Three straights laid nose to tail along the x axis, in order. */
function straightRun(): { layer: DungeonLayer; pieces: CaveKitPiece[]; span: number } {
  const pieces = caveBandPieces()
    .filter((p) => p.turnDeg === 0 && !p.flipY)
    .slice(0, 3);
  const children: AssetChild[] = [];
  let x = 0;
  for (const [i, piece] of pieces.entries()) {
    const at = placeOnChord(piece, [x, 0], [x + piece.chordCells, 0]);
    children.push(assetChild(`piece-${i}`, assetIdFor(piece.key), at));
    x += piece.chordCells;
  }
  return { layer: layerOf(children), pieces, span: x };
}

describe('detectBands on the shipped Warren', () => {
  const warren = (): DungeonLayer => {
    const map = JSON.parse(
      readFileSync(resolve(REPO, 'session/testdata/goblin-warren.mapbuilder'), 'utf8'),
    ) as { layers: Layer[] };
    return map.layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
  };

  it('walks the cave wall as one closed ring of 127 pieces', () => {
    // The Warren's band is a single cycle around the whole cave; anything else
    // means the chain broke somewhere and node editing would only reach part of
    // the wall. 127 of the layer's 271 asset children are band rock — the rest
    // is rubble, ledges, mushrooms and furniture, which must not be swept in.
    const bands = detectBands(warren());
    expect(bands).toHaveLength(1);
    expect(bands[0].closed).toBe(true);
    expect(bands[0].pieces).toHaveLength(127);
    expect(bands[0].joints).toHaveLength(127);
  });

  it('leaves no seam wider than the acceptance gate', () => {
    // Gate 1 of the band editor: every seam ≤ 0.9 cells. The shipped map's worst
    // is 0.555, so a failure here is a wrong successor rather than a loose one —
    // a piece from across the cave picked up by a matching bug reads as a hole.
    const { pieces } = detectBands(warren())[0];
    const gaps = pieces.map((p, m) => dist(p.joints[1], pieces[(m + 1) % pieces.length].joints[0]));
    expect(Math.max(...gaps)).toBeLessThanOrEqual(0.9);
  });
});

describe('detectBands on an open run', () => {
  it('terminates at both ends and counts one more joint than pieces', () => {
    const { layer, pieces, span } = straightRun();
    const bands = detectBands(layer);
    expect(bands).toHaveLength(1);
    const band = bands[0];
    expect(band.closed).toBe(false);
    expect(band.pieces.map((p) => p.childId)).toEqual(['piece-0', 'piece-1', 'piece-2']);
    expect(band.pieces.map((p) => p.piece.key)).toEqual(pieces.map((p) => p.key));
    // The free ends are joints too, so the run has one more joint than pieces —
    // that is what lets a drag move the very end of an unclosed wall.
    expect(band.joints).toHaveLength(pieces.length + 1);
    expect(dist(band.joints[0], [0, 0])).toBeLessThan(1e-9);
    expect(dist(band.joints[band.joints.length - 1], [span, 0])).toBeLessThan(1e-9);
  });
});

describe('detectBands with a doubled piece', () => {
  it('never gives a piece two predecessors or two successors', () => {
    // Duplicating a child puts two equally good candidates on the same seam.
    // Per-node nearest would hand both of them the same neighbour and tear the
    // chain; one-to-one matching spends each end once, so the copy simply falls
    // out of the run as a band of its own.
    const { layer } = straightRun();
    const middle = layer.children[1] as AssetChild;
    const bands = detectBands(layerOf([...(layer.children as AssetChild[]), { ...middle, id: 'piece-1-copy' }]));

    const ids = bands.flatMap((b) => b.pieces.map((p) => p.childId));
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    expect(bands.map((b) => b.pieces.length).sort((a, b) => b - a)).toEqual([3, 1]);
    expect(bands.every((b) => !b.closed)).toBe(true);
  });
});
