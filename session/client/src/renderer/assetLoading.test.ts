import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssetProgress } from './assetBoot';

// A mocked manager behind the adapter: every tier call is a spy the test drives.
const SETS: Record<string, { set: string; installed: boolean; files: number; bytes: number; missingFiles: number; missingBytes: number }[]> = {
  'gg-forge': [
    { set: 'GG_Fieldstone', installed: true, files: 2, bytes: 1_000_000, missingFiles: 0, missingBytes: 0 },
    { set: 'GG_Palisade', installed: false, files: 2, bytes: 1_000_000, missingFiles: 1, missingBytes: 600_000 },
  ],
  'gg-demo': [{ set: 'demo-nature', installed: false, files: 100, bytes: 18_000_000, missingFiles: 100, missingBytes: 18_000_000 }],
  'from-file': [{ set: 'x', installed: false, files: 1, bytes: 5, missingFiles: 1, missingBytes: 5 }],
};
const pm = { getAssetSetStatus: vi.fn((packId: string) => SETS[packId] ?? []) };
const boot = {
  bootAssets: vi.fn(async () => {}),
  ensureMapAssets: vi.fn(async (_pm: unknown, _ids: string[], _cb?: (p: AssetProgress) => void) => {}),
  installLibrary: vi.fn(async (_pm: unknown, _order: string[], _cb?: (p: AssetProgress) => void, _signal?: AbortSignal) => {}),
  collectMapTextureIds: vi.fn((_map: unknown, extra: string[] = []) => ['gg-forge:wall', ...extra]),
};
vi.mock('./assetBoot', () => ({
  getAssetPackManager: () => pm,
  bootAssets: (...a: Parameters<typeof boot.bootAssets>) => boot.bootAssets(...a),
  ensureMapAssets: (...a: Parameters<typeof boot.ensureMapAssets>) => boot.ensureMapAssets(...a),
  installLibrary: (...a: Parameters<typeof boot.installLibrary>) => boot.installLibrary(...a),
  collectMapTextureIds: (m: unknown, extra?: string[]) => boot.collectMapTextureIds(m, extra),
}));
const toast = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('@dnd/ui/toast', () => ({ notify: { error: toast.error, info: vi.fn(), success: vi.fn() } }));

const { useTableAssets, ensureSceneAssets, markFirstSceneDone, startAssetBoot, runLibrary, pauseLibrary, resumeLibrary, librarySize, resetTableAssets } =
  await import('./assetLoading');

const MAP = { mapSettings: {}, layers: [] } as never;
const p = (filesDone: number, filesTotal: number): AssetProgress => ({ phase: 'map', filesDone, filesTotal, bytesDone: 0, bytesTotal: 0 });

beforeEach(() => {
  resetTableAssets();
  vi.clearAllMocks();
});

describe('table assets', () => {
  it('boots once however many callers ask', async () => {
    await Promise.all([startAssetBoot(), startAssetBoot(), ensureSceneAssets(MAP)]);
    expect(boot.bootAssets).toHaveBeenCalledOnce();
    expect(useTableAssets.getState().indexReady).toBe(true);
  });

  it('the first scene reports to the screen, with the tokens pack art asked for', async () => {
    let mode: string | undefined;
    boot.ensureMapAssets.mockImplementationOnce(async (_pm, ids, cb) => {
      expect(ids).toEqual(['gg-forge:wall', 'gg-demo:wolf']);
      cb?.(p(1, 4));
      mode = useTableAssets.getState().map?.mode;
      cb?.(p(4, 4));
    });
    await ensureSceneAssets(MAP, ['gg-demo:wolf']);
    expect(mode).toBe('screen');
    expect(useTableAssets.getState().map).toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('after the first scene, swaps report to the pill', async () => {
    markFirstSceneDone();
    let mode: string | undefined;
    boot.ensureMapAssets.mockImplementationOnce(async (_pm, _ids, cb) => {
      cb?.(p(0, 2));
      mode = useTableAssets.getState().map?.mode;
      cb?.(p(2, 2));
    });
    await ensureSceneAssets(MAP);
    expect(mode).toBe('pill');
  });

  it('a set that fails toasts and never throws', async () => {
    boot.ensureMapAssets.mockRejectedValueOnce(new Error('offline'));
    await expect(ensureSceneAssets(MAP)).resolves.toBeUndefined();
    expect(toast.error).toHaveBeenCalledOnce();
  });

  it('never fetches the library on its own', async () => {
    await ensureSceneAssets(MAP);
    markFirstSceneDone();
    await new Promise((r) => setTimeout(r, 10));
    expect(boot.installLibrary).not.toHaveBeenCalled();
  });

  it('the DM library runs forge first, pauses through the signal and resumes', async () => {
    let signal!: AbortSignal;
    boot.installLibrary.mockImplementationOnce(async (_pm, order, _cb, s) => {
      expect(order).toEqual(['gg-forge', 'gg-demo']);
      signal = s!;
      await new Promise<void>((r) => s!.addEventListener('abort', () => r()));
    });
    const first = runLibrary();
    await vi.waitFor(() => expect(signal).toBeDefined());
    pauseLibrary();
    await first;
    expect(signal.aborted).toBe(true);
    expect(useTableAssets.getState().library.status).toBe('paused');
    resumeLibrary();
    await vi.waitFor(() => expect(useTableAssets.getState().library.status).toBe('done'));
  });

  it('sizes the library as what the bundled packs still lack', () => {
    expect(librarySize()).toBe(18_600_000);
  });
});
