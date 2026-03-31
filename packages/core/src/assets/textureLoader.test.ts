import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing the module under test
vi.mock('../engine/assetPackInstance', () => ({
  getAssetPackManager: vi.fn(),
}));

vi.mock('./textureManifest', () => ({
  getTextureEntry: vi.fn(() => null),
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
  return {
    ...actual,
    Texture: {
      ...actual.Texture,
      from: vi.fn(() => FALLBACK_TEX),
    },
  };
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

import { resolveTexture } from './textureLoader';
import { getAssetPackManager } from '../engine/assetPackInstance';
import { Texture } from 'pixi.js';

function makeTex(label: string) {
  return { __label: label, width: 64 } as unknown as Texture;
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
