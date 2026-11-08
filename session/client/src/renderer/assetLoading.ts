/**
 * The table's asset loading: the boot (pack metadata and the bundled index), the sets each
 * scene needs, and, for the DM only and only when asked, the full library. Players only
 * ever download what the scenes they are shown use.
 */
import { create } from 'zustand';
import { notify } from '@dnd/ui/toast';
import type { DownloadPillPack, LoadProgress } from '@dnd/ui';
import type { SerializedMapData } from '@dnd/core/src/store/types';
import {
  bootAssets,
  collectMapTextureIds,
  ensureMapAssets,
  getAssetPackManager,
  installLibrary,
  type AssetProgress,
} from './assetBoot';

/** Walls and floors before props: every map needs the first. */
export const LIBRARY_ORDER = ['gg-forge', 'gg-demo'];

type LibraryStatus = 'idle' | 'running' | 'paused' | 'done' | 'failed';

interface TableAssetState {
  indexReady: boolean;
  /** The first scene is drawn; later scenes load in the pill. */
  firstSceneDone: boolean;
  /** A scene's sets are downloading: on the loading screen the first time, else the pill. */
  map: { mode: 'screen' | 'pill'; progress: LoadProgress } | null;
  library: { status: LibraryStatus; progress: LoadProgress; packId?: string };
  pillHidden: boolean;
}

const ZERO: LoadProgress = { filesDone: 0, filesTotal: 0, bytesDone: 0, bytesTotal: 0 };

const initial = (): TableAssetState => ({
  indexReady: false,
  firstSceneDone: false,
  map: null,
  library: { status: 'idle', progress: ZERO },
  pillHidden: false,
});

export const useTableAssets = create<TableAssetState>(initial);

const counts = (p: AssetProgress): LoadProgress => ({
  filesDone: p.filesDone,
  filesTotal: p.filesTotal,
  bytesDone: p.bytesDone,
  bytesTotal: p.bytesTotal,
});

let boot: Promise<void> | null = null;

/** Pack metadata and the bundled index, shared by the join prefetch and the renderer. Never rejects. */
export function startAssetBoot(): Promise<void> {
  boot ??= bootAssets(getAssetPackManager())
    .catch((err) => console.warn('[tableAssets] asset pack boot failed:', err))
    .finally(() => useTableAssets.setState({ indexReady: true }));
  return boot;
}

let seq = 0;

/**
 * The sets a scene draws with, its tokens' pack art included. Before the first scene is
 * drawn the progress is the loading screen's; after, the pill's. Never throws: a set that
 * fails draws its fallback, with a toast.
 */
export async function ensureSceneAssets(map: SerializedMapData, tokenAssetIds: string[] = []): Promise<void> {
  const mine = ++seq;
  const mode = useTableAssets.getState().firstSceneDone ? 'pill' : 'screen';
  let last: LoadProgress = ZERO;
  let failed = false;
  try {
    await startAssetBoot();
    const ids = collectMapTextureIds(map, tokenAssetIds);
    if (mine === seq) useTableAssets.setState({ map: { mode, progress: ZERO } });
    await ensureMapAssets(getAssetPackManager(), ids, (p) => {
      last = counts(p);
      if (mine === seq) useTableAssets.setState({ map: { mode, progress: last } });
    });
  } catch (err) {
    console.warn('[tableAssets] scene textures failed:', err);
    failed = true;
  }
  if (failed || last.filesDone < last.filesTotal) {
    notify.error("Some of this scene's art couldn't be downloaded. It draws as placeholders.");
  }
  if (mine === seq) useTableAssets.setState({ map: null });
}

/** The first scene is on screen: later scenes swap behind the pill. */
export function markFirstSceneDone(): void {
  if (!useTableAssets.getState().firstSceneDone) useTableAssets.setState({ firstSceneDone: true });
}

let controller: AbortController | null = null;

/** The DM's "Download the full library": every set not yet stored, `gg-forge` first. */
export async function runLibrary(): Promise<void> {
  const { status } = useTableAssets.getState().library;
  if (status === 'running' || status === 'done') return;
  const own = new AbortController();
  controller = own;
  useTableAssets.setState((s) => ({ library: { ...s.library, status: 'running' }, pillHidden: false }));
  let last: LoadProgress = ZERO;
  try {
    await startAssetBoot();
    await installLibrary(
      getAssetPackManager(),
      LIBRARY_ORDER,
      (p) => {
        if (own.signal.aborted) return;
        last = counts(p);
        useTableAssets.setState({ library: { status: 'running', progress: last, packId: p.packId } });
      },
      own.signal,
    );
    if (own.signal.aborted) return;
    // installLibrary logs and skips a set that fails; files left over mean it did not finish.
    if (last.filesDone < last.filesTotal) throw new Error(`${last.filesTotal - last.filesDone} files did not download`);
    useTableAssets.setState((s) => ({ library: { ...s.library, status: 'done', packId: undefined } }));
  } catch (err) {
    if (own.signal.aborted) return;
    console.warn('[tableAssets] library download failed:', err);
    notify.error("The asset library couldn't finish downloading.");
    useTableAssets.setState((s) => ({ library: { ...s.library, status: 'failed' } }));
  } finally {
    if (controller === own) controller = null;
  }
}

export function pauseLibrary(): void {
  if (useTableAssets.getState().library.status !== 'running') return;
  controller?.abort();
  controller = null;
  useTableAssets.setState((s) => ({ library: { ...s.library, status: 'paused' } }));
}

export function resumeLibrary(): void {
  if (useTableAssets.getState().library.status === 'paused') void runLibrary();
}

export function hidePill(): void {
  useTableAssets.setState({ pillHidden: true });
}

/** What the library still has to download, from the manifests; 0 before the boot has them. */
export function librarySize(): number {
  const pm = getAssetPackManager();
  return LIBRARY_ORDER.flatMap((id) => pm.getAssetSetStatus(id))
    .filter((s) => !s.installed)
    .reduce((n, s) => n + s.bytes, 0);
}

/** The pill's per-pack lines: packs before the live one are done, after it waiting. */
export function libraryPacks(packId: string | undefined, status: LibraryStatus, progress: LoadProgress): DownloadPillPack[] {
  const at = packId ? LIBRARY_ORDER.indexOf(packId) : status === 'done' ? LIBRARY_ORDER.length : 0;
  return LIBRARY_ORDER.map((id, i) => ({
    id,
    label: id,
    status: i < at ? 'done' : i === at ? 'active' : 'waiting',
    progress: i === at ? progress : undefined,
  }));
}

/** Tests only. */
export function resetTableAssets(): void {
  boot = null;
  seq = 0;
  controller = null;
  useTableAssets.setState(initial());
}
