import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing the module under test
vi.mock('../engine/assetPackInstance', () => ({
  getAssetPackManager: vi.fn(),
}));

// Sentinel texture returned by the fallback path
const FALLBACK_TEX = { __fallback: true } as unknown as Texture;

vi.mock('pixi.js', async () => {
  const actual = await vi.importActual<typeof import('pixi.js')>('pixi.js');
  // Mutate the real class rather than spreading it into a plain object: unitTexture's
  // sheet-crop path does `new Texture({ source, frame })`, which a spread object
  // (not a constructor) can't support.
  (actual.Texture as unknown as { from: unknown }).from = vi.fn(() => FALLBACK_TEX);
  return actual;
});

// Mock canvas for fallback texture
vi.stubGlobal('document', {
  createElement: () => ({
    width: 0,
    height: 0,
    getContext: () => ({
      fillStyle: '',
      fillRect: vi.fn(),
    }),
  }),
});

import { resolveTexture, unitTexture, reset as resetTextureLoader } from './textureLoader';
import { getAssetPackManager } from '../engine/assetPackInstance';
import type { PackManifest } from '../engine/assetPackManager';
import { Texture } from 'pixi.js';

function makeTex(label: string, width = 64, height = 64) {
  return { __label: label, width, height } as unknown as Texture;
}

let versionCounter = 0;

/**
 * Mock manager with a texture map and, optionally, a manifest backing the
 * catalog (unitTexture reads natural sizes off it).
 */
function createMockPackManager(
  textures: Record<string, Texture>,
  manifests: Array<{ packId: string; manifest: PackManifest }> = [],
) {
  return {
    getTexture: (id: string) => textures[id] ?? Texture.EMPTY,
    getPackManifests: () => manifests,
    // Fresh version per manager so the catalog memo never leaks across tests.
    catalogVersion: ++versionCounter,
  };
}

function manifestWith(entries: PackManifest['entries']): PackManifest {
  return {
    name: 'gg-forge',
    description: '',
    version: '1.0.0',
    bundleSize: 0,
    entries,
    atlases: {},
    files: {},
  };
}

describe('resolveTexture', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetTextureLoader();
  });

  it('resolves pack-format IDs (containing colon) via pack manager', () => {
    const mockTex = makeTex('pack-grass');
    const pm = createMockPackManager({ 'gg-forge:grass_1x1_floor_A': mockTex });
    vi.mocked(getAssetPackManager).mockReturnValue(pm as never);

    const result = resolveTexture('gg-forge:grass_1x1_floor_A');
    expect(result).toBe(mockTex);
  });

  it('returns magenta fallback for unknown non-pack IDs', () => {
    const pm = createMockPackManager({});
    vi.mocked(getAssetPackManager).mockReturnValue(pm as never);

    const result = resolveTexture('totally-unknown-id');
    expect(result).toBe(FALLBACK_TEX);
  });

  it('logs warning only once per unique missing ID', () => {
    const pm = createMockPackManager({});
    vi.mocked(getAssetPackManager).mockReturnValue(pm as never);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    resolveTexture('unique-missing-1');
    resolveTexture('unique-missing-1');
    resolveTexture('unique-missing-1');

    const relevantCalls = warnSpy.mock.calls.filter(
      (args) => typeof args[0] === 'string' && args[0].includes('unique-missing-1'),
    );
    expect(relevantCalls).toHaveLength(1);

    warnSpy.mockRestore();
  });

  it('returns same fallback texture instance for multiple unknown IDs', () => {
    const pm = createMockPackManager({});
    vi.mocked(getAssetPackManager).mockReturnValue(pm as never);

    const a = resolveTexture('unknown-a');
    const b = resolveTexture('unknown-b');
    expect(a).toBe(b);
  });
});

describe('unitTexture', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetTextureLoader(); // unitTexture caches by id — clear between tests reusing one id
  });

  it('sizes the unit from the catalog natural size (atlas frame w/h)', () => {
    const mockTex = makeTex('grass', 999, 999); // pixel size irrelevant when the catalog has natural size
    const id = 'gg-forge:grass_6x4_floor_A';
    const pm = createMockPackManager({ [id]: mockTex }, [
      {
        packId: 'gg-forge',
        manifest: manifestWith({
          grass_6x4_floor_A: {
            type: 'floor',
            material: 'grass',
            gridSize: '6x4',
            pieceType: 'tile',
            variant: 'A',
            frame: { x: 0, y: 0, w: 1200, h: 800 },
            tags: [],
          },
        }),
      },
    ]);
    vi.mocked(getAssetPackManager).mockReturnValue(pm as never);

    const unit = unitTexture(id);
    expect(unit.texture).toBe(mockTex);
    expect(unit.cellsWide).toBe(6); // 1200 / 200
    expect(unit.cellsHigh).toBe(4); // 800 / 200
  });

  it("falls back to the resolved texture's own pixel size with no catalog entry", () => {
    const mockTex = makeTex('pack-only', 400, 200);
    const id = 'gg-forge:unlisted_1x1_floor_A';
    const pm = createMockPackManager({ [id]: mockTex });
    vi.mocked(getAssetPackManager).mockReturnValue(pm as never);

    const unit = unitTexture(id);
    expect(unit.texture).toBe(mockTex);
    expect(unit.cellsWide).toBe(2); // 400 / 200
    expect(unit.cellsHigh).toBe(1); // 200 / 200
  });
});
