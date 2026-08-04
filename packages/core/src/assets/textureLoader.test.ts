import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing the module under test
vi.mock('../engine/assetPackInstance', () => ({
  getAssetPackManager: vi.fn(),
}));

vi.mock('./textureManifest', () => ({
  getTextureEntry: vi.fn(() => null),
  GRID_CELL_PX: 200,
}));

vi.mock('../engine/legacyAssetMapping', () => ({
  resolveLegacyId: vi.fn((id: string) => {
    const map: Record<string, string> = {
      'grass-a-01': 'dungeon-classic:grass-a-01_1x1_floor_A',
      'stone-slate': 'dungeon-classic:stone-slate_1x1_floor_A',
    };
    return map[id] ?? null;
  }),
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
import { getTextureEntry } from './textureManifest';
import { Texture } from 'pixi.js';

function makeTex(label: string, width = 64, height = 64) {
  return { __label: label, width, height } as unknown as Texture;
}

function createMockPackManager(textures: Record<string, Texture>) {
  return {
    getTexture: (id: string) => textures[id] ?? Texture.EMPTY,
  };
}

describe('resolveTexture', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves pack-format IDs (containing colon) via pack manager', () => {
    const mockTex = makeTex('pack-grass');
    const pm = createMockPackManager({ 'dungeon-classic:grass-a-01_1x1_floor_A': mockTex });
    vi.mocked(getAssetPackManager).mockReturnValue(pm as never);

    const result = resolveTexture('dungeon-classic:grass-a-01_1x1_floor_A');
    expect(result).toBe(mockTex);
  });

  it('resolves legacy IDs through the legacy mapping table', () => {
    const mockTex = makeTex('legacy-grass');
    const pm = createMockPackManager({ 'dungeon-classic:grass-a-01_1x1_floor_A': mockTex });
    vi.mocked(getAssetPackManager).mockReturnValue(pm as never);

    const result = resolveTexture('grass-a-01');
    expect(result).toBe(mockTex);
  });

  it('returns magenta fallback for unknown IDs', () => {
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
    resetTextureLoader(); // unitTexture caches by id — clear between tests reusing 'grass-a-01'
  });

  it('defaults to the whole resolved texture, sized from manifest naturalWidth/Height (no unitRect)', () => {
    const mockTex = makeTex('grass', 999, 999); // pixel size irrelevant when the manifest has natural size
    const pm = createMockPackManager({ 'dungeon-classic:grass-a-01_1x1_floor_A': mockTex });
    vi.mocked(getAssetPackManager).mockReturnValue(pm as never);
    vi.mocked(getTextureEntry).mockReturnValue({ naturalWidth: 1200, naturalHeight: 800 } as never);

    const unit = unitTexture('grass-a-01');
    expect(unit.texture).toBe(mockTex);
    expect(unit.cellsWide).toBe(6); // 1200 / 200
    expect(unit.cellsHigh).toBe(4); // 800 / 200
  });

  it('falls back to the resolved texture\'s own pixel size when there is no manifest entry (pack-only id)', () => {
    const mockTex = makeTex('pack-only', 400, 200);
    const pm = createMockPackManager({ 'dungeon-classic:grass-a-01_1x1_floor_A': mockTex });
    vi.mocked(getAssetPackManager).mockReturnValue(pm as never);
    vi.mocked(getTextureEntry).mockReturnValue(null as never);

    const unit = unitTexture('grass-a-01');
    expect(unit.texture).toBe(mockTex);
    expect(unit.cellsWide).toBe(2); // 400 / 200
    expect(unit.cellsHigh).toBe(1); // 200 / 200
  });
});
