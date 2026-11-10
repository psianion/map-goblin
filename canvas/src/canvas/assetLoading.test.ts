import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssetProgress } from './assetBoot';

// A mocked manager behind the adapter: every tier call is a spy the test drives.
const pm = {
  getInstalledPacks: vi.fn(() => []),
  getPackManifests: vi.fn(() => []),
  checkForUpdates: vi.fn(async () => []),
};
const boot = {
  bootAssets: vi.fn(async () => {}),
  ensureMapAssets: vi.fn(async (_pm: unknown, _ids: string[], _cb?: (p: AssetProgress) => void) => {}),
  installLibrary: vi.fn(async (_pm: unknown, _order: string[], _cb?: (p: AssetProgress) => void, _signal?: AbortSignal) => {}),
  collectMapTextureIds: vi.fn((_map: unknown) => ['gg-forge:wall', 'gg-demo:barrel']),
};
vi.mock('./assetBoot', () => ({
  getAssetPackManager: () => pm,
  bootAssets: (...a: Parameters<typeof boot.bootAssets>) => boot.bootAssets(...a),
  ensureMapAssets: (...a: Parameters<typeof boot.ensureMapAssets>) => boot.ensureMapAssets(...a),
  installLibrary: (...a: Parameters<typeof boot.installLibrary>) => boot.installLibrary(...a),
  collectMapTextureIds: (m: unknown) => boot.collectMapTextureIds(m),
}));
const toast = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('@dnd/ui/toast', () => ({ notify: { error: toast.error, info: vi.fn(), success: vi.fn() } }));

const { useAssetLoading, loadMapAssets, startAssetBoot, runLibrary, pauseLibrary, resumeLibrary, libraryPacks, resetAssetLoading, LIBRARY_ORDER } =
  await import('./assetLoading');

const MAP = { mapSettings: {}, layers: [] } as never;
const p = (phase: AssetProgress['phase'], filesDone: number, filesTotal: number, packId?: string): AssetProgress => ({
  phase,
  packId,
  filesDone,
  filesTotal,
  bytesDone: filesDone * 100,
  bytesTotal: filesTotal * 100,
});

// Idle callbacks wait here until a test runs them, so none leaks into the next test.
let idle: (() => void)[] = [];

beforeEach(() => {
  resetAssetLoading();
  vi.clearAllMocks();
  idle = [];
  vi.stubGlobal('requestIdleCallback', (cb: () => void) => idle.push(cb));
});
afterEach(() => vi.unstubAllGlobals());

describe('asset boot', () => {
  it('boots once and marks the index ready', async () => {
    await Promise.all([startAssetBoot(), startAssetBoot()]);
    expect(boot.bootAssets).toHaveBeenCalledOnce();
    expect(useAssetLoading.getState().indexReady).toBe(true);
  });

  it('still marks the index ready when the boot fails, so the screen lifts', async () => {
    boot.bootAssets.mockRejectedValueOnce(new Error('offline'));
    await startAssetBoot();
    expect(useAssetLoading.getState().indexReady).toBe(true);
  });
});

describe('opening a map', () => {
  it('first open is the screen with progress, after boot, then the library starts on idle', async () => {
    let release!: () => void;
    boot.ensureMapAssets.mockImplementationOnce(async (_pm, ids, cb) => {
      expect(boot.bootAssets).toHaveBeenCalled();
      expect(ids).toEqual(['gg-forge:wall', 'gg-demo:barrel']);
      cb?.(p('map', 3, 12));
      await new Promise<void>((r) => (release = r));
      cb?.(p('map', 12, 12));
    });
    const run = loadMapAssets(MAP);
    await vi.waitFor(() => expect(useAssetLoading.getState().map?.progress.filesDone).toBe(3));
    expect(useAssetLoading.getState().map?.mode).toBe('screen');
    release();
    await run;
    expect(useAssetLoading.getState().map).toBeNull();
    expect(useAssetLoading.getState().firstMapDone).toBe(true);
    expect(toast.error).not.toHaveBeenCalled();
    expect(idle).toHaveLength(1);
    idle[0]();
    await vi.waitFor(() => expect(boot.installLibrary).toHaveBeenCalledOnce());
    expect(boot.installLibrary.mock.calls[0][1]).toEqual(['gg-forge', 'gg-demo']);
  });

  it('a later open uses the pill', async () => {
    await loadMapAssets(MAP);
    boot.collectMapTextureIds.mockReturnValueOnce(['gg-demo:tree']);
    let mode: string | undefined;
    boot.ensureMapAssets.mockImplementationOnce(async () => {
      mode = useAssetLoading.getState().map?.mode;
    });
    await loadMapAssets(MAP);
    expect(mode).toBe('pill');
  });

  it('the same textures asked twice share one download', async () => {
    await Promise.all([loadMapAssets(MAP), loadMapAssets(MAP)]);
    expect(boot.ensureMapAssets).toHaveBeenCalledOnce();
  });

  it('files left over at the end toast, and the map is still marked done', async () => {
    boot.ensureMapAssets.mockImplementationOnce(async (_pm, _ids, cb) => cb?.(p('map', 2, 5)));
    await loadMapAssets(MAP);
    expect(toast.error).toHaveBeenCalledOnce();
    expect(useAssetLoading.getState().firstMapDone).toBe(true);
  });

  it('a throw toasts too', async () => {
    boot.ensureMapAssets.mockRejectedValueOnce(new Error('offline'));
    await loadMapAssets(MAP);
    expect(toast.error).toHaveBeenCalledOnce();
  });
});

describe('the library', () => {
  it('Pause aborts the signal, Resume starts it again', async () => {
    const signals: AbortSignal[] = [];
    boot.installLibrary.mockImplementationOnce(async (_pm, _order, cb, signal) => {
      signals.push(signal!);
      cb?.(p('library', 10, 100, 'gg-forge'));
      await new Promise<void>((r) => signal!.addEventListener('abort', () => r()));
    });
    const first = runLibrary();
    await vi.waitFor(() => expect(useAssetLoading.getState().library.progress.filesDone).toBe(10));
    expect(useAssetLoading.getState().library.status).toBe('running');
    pauseLibrary();
    await first;
    expect(signals[0].aborted).toBe(true);
    expect(useAssetLoading.getState().library.status).toBe('paused');
    resumeLibrary();
    await vi.waitFor(() => expect(useAssetLoading.getState().library.status).toBe('done'));
    expect(boot.installLibrary).toHaveBeenCalledTimes(2);
  });

  it('a failure toasts and leaves the status failed', async () => {
    boot.installLibrary.mockRejectedValueOnce(new Error('offline'));
    await runLibrary();
    expect(toast.error).toHaveBeenCalledOnce();
    expect(useAssetLoading.getState().library.status).toBe('failed');
  });

  it('lists packs before the live one as done and after it as waiting', () => {
    const lines = libraryPacks('gg-demo', 'running', p('library', 1, 2));
    expect(lines.map((l) => [l.id, l.status])).toEqual([
      [LIBRARY_ORDER[0], 'done'],
      [LIBRARY_ORDER[1], 'active'],
    ]);
    expect(libraryPacks(undefined, 'done', p('library', 2, 2)).every((l) => l.status === 'done')).toBe(true);
  });
});
