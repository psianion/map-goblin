/**
 * The canvas's asset loading: the boot (pack metadata and the bundled index), the sets
 * the open map needs (behind the loading screen the first time, in the pill after), and the
 * rest of the library in the background once a map is on screen, with Pause and Resume.
 */
import { create } from 'zustand';
import { notify } from '@dnd/ui/toast';
import type { DownloadPillPack, LoadProgress } from '@dnd/ui';
import { dropPlacedCaveBand } from '@dnd/core/src/store/migration';
import { isBandSet } from '@dnd/core/src/assets/packCatalog';
import { isCaveBandAsset } from '@dnd/core/src/assets/caveWallKit';
import { materialFillId, pieceNameOf } from '@dnd/core/src/assets/materialKit';
import { wallPatchesToFloors } from '@dnd/core/src/shared/caveFloor';
import { patchesToPieces } from '@dnd/core/src/shared/legacyPaint';
import { useStore } from '@/store/store';
import { buildMergedManifest } from '@/engine/manifestBridge';
import {
  bootAssets,
  collectMapTextureIds,
  ensureMapAssets,
  getAssetPackManager,
  installLibrary,
  type AssetProgress,
  type MapTextureSource,
} from './assetBoot';

/** Walls and floors before props: every map needs the first. */
export const LIBRARY_ORDER = ['gg-forge', 'gg-demo'];

type LibraryStatus = 'idle' | 'running' | 'paused' | 'done' | 'failed';

interface AssetLoadingState {
  /** Pack metadata and manifests are in; the catalog is live. */
  indexReady: boolean;
  /** The first map's sets are in (or failed); later opens use the pill. */
  firstMapDone: boolean;
  /** An open map's sets are downloading: behind the screen the first time, else the pill. */
  map: { mode: 'screen' | 'pill'; progress: LoadProgress } | null;
  library: { status: LibraryStatus; progress: LoadProgress; packId?: string };
  /** The pill's ×, for this session. */
  pillHidden: boolean;
  /** Bumped whenever sets land, for surfaces that list them. */
  setsVersion: number;
}

const ZERO: LoadProgress = { filesDone: 0, filesTotal: 0, bytesDone: 0, bytesTotal: 0 };

const initial = (): AssetLoadingState => ({
  indexReady: false,
  firstMapDone: false,
  map: null,
  library: { status: 'idle', progress: ZERO },
  pillHidden: false,
  setsVersion: 0,
});

export const useAssetLoading = create<AssetLoadingState>(initial);

const counts = (p: AssetProgress): LoadProgress => ({
  filesDone: p.filesDone,
  filesTotal: p.filesTotal,
  bytesDone: p.bytesDone,
  bytesTotal: p.bytesTotal,
});

let boot: Promise<void> | null = null;

/**
 * Pack metadata and the bundled index, then the store: the Packs list, the merged manifest,
 * the name shim and the cave band cleanup that need the catalog. Never rejects.
 */
export function startAssetBoot(): Promise<void> {
  boot ??= (async () => {
    const pm = getAssetPackManager();
    try {
      await bootAssets(pm);
      const store = useStore.getState();
      store.setInstalledPacks(
        pm.getInstalledPacks().map((p) => ({
          packId: p.packId,
          name: p.packId,
          version: p.version,
          sizeBytes: p.bundleSize,
          // As stored: a pack installed from a file stays "From file" after a reload.
          bundled: p.bundled,
          installedAt: p.installedAt,
        })),
      );
      const manifests = pm.getPackManifests();
      if (manifests.length > 0) store.setManifest(buildMergedManifest(manifests));
      // The catalog is live now: resolve the "Asset" names a map loaded before this point
      // couldn't (loadFromFile runs the same shim for the opposite ordering).
      store.applyAssetNameShim();
      // Same ordering problem for the load migration's cave band cleanup, which needs the
      // catalog to tell a band kit and its pieces apart, and for a 3.10 wall patch's floors,
      // which need the catalog to name the material's fill.
      const { layers, levels } = useStore.getState();
      // The patches left waiting for a band set's fill become pieces now too.
      const kept = patchesToPieces(
        wallPatchesToFloors(dropPlacedCaveBand(layers, levels, { isBandSet, isCaveBandAsset }), materialFillId),
        { fillOf: materialFillId, nameOf: pieceNameOf },
      );
      if (kept !== layers) useStore.setState({ layers: kept });
      pm.checkForUpdates()
        .then((updates) => {
          if (updates.length > 0) useStore.getState().setAvailableUpdates(updates);
        })
        .catch(() => {});
    } catch (err) {
      console.warn('[assetLoading] Asset pack boot failed:', err);
    } finally {
      useAssetLoading.setState({ indexReady: true });
    }
  })();
  return boot;
}

const OFFLINE = "Some map art couldn't be downloaded. It draws as placeholders until you're back online.";

let mapRun: { key: string; promise: Promise<void> } | null = null;
/** The latest open: an older one finishing never clears a newer one's screen or pill. */
let mapSeq = 0;

/**
 * The sets an opened map draws with. The map is already in the store, so the renderer
 * builds while they land. The first open covers the canvas with the loading screen; later
 * ones show the pill. A failure toasts and the map keeps its fallbacks.
 */
export function loadMapAssets(map: MapTextureSource): Promise<void> {
  let ids: string[];
  try {
    ids = collectMapTextureIds(map);
  } catch (err) {
    console.warn('[assetLoading] Could not list the map textures:', err);
    ids = [];
  }
  const key = [...ids].sort().join('|');
  if (mapRun?.key === key) return mapRun.promise;
  const seq = ++mapSeq;
  const promise = (async () => {
    const mode = useAssetLoading.getState().firstMapDone ? 'pill' : 'screen';
    useAssetLoading.setState({ map: { mode, progress: ZERO } });
    let last: LoadProgress = ZERO;
    let failed = false;
    try {
      await startAssetBoot();
      await ensureMapAssets(getAssetPackManager(), ids, (p) => {
        last = counts(p);
        if (seq === mapSeq) useAssetLoading.setState({ map: { mode, progress: last } });
      });
    } catch (err) {
      console.warn('[assetLoading] Map textures failed:', err);
      failed = true;
    }
    if (failed || last.filesDone < last.filesTotal) notify.error(OFFLINE);
    if (mapRun?.key === key) mapRun = null;
    useAssetLoading.setState((s) => ({ map: seq === mapSeq ? null : s.map, firstMapDone: true, setsVersion: s.setsVersion + 1 }));
    scheduleLibrary();
  })();
  mapRun = { key, promise };
  return promise;
}

let scheduled = false;
let controller: AbortController | null = null;

/** The library starts once, when the browser is idle after the first map is on screen. */
function scheduleLibrary(): void {
  if (scheduled) return;
  scheduled = true;
  const start = () => void runLibrary();
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(start, { timeout: 5000 });
  else setTimeout(start, 1000);
}

/** Every set not yet installed, `gg-forge` first. Also the Packs sheet's "Download everything now". */
export async function runLibrary(): Promise<void> {
  const { status } = useAssetLoading.getState().library;
  if (status === 'running' || status === 'done') return;
  scheduled = true;
  const own = new AbortController();
  controller = own;
  useAssetLoading.setState((s) => ({ library: { ...s.library, status: 'running' } }));
  let last: LoadProgress = ZERO;
  try {
    await startAssetBoot();
    await installLibrary(
      getAssetPackManager(),
      LIBRARY_ORDER,
      (p) => {
        if (own.signal.aborted) return;
        last = counts(p);
        useAssetLoading.setState((s) => ({
          library: { status: 'running', progress: last, packId: p.packId },
          setsVersion: s.setsVersion + 1,
        }));
      },
      own.signal,
    );
    if (own.signal.aborted) return;
    // installLibrary logs and skips a set that fails; files left over mean it did not finish.
    if (last.filesDone < last.filesTotal) throw new Error(`${last.filesTotal - last.filesDone} files did not download`);
    useAssetLoading.setState((s) => ({ library: { ...s.library, status: 'done', packId: undefined }, setsVersion: s.setsVersion + 1 }));
  } catch (err) {
    if (own.signal.aborted) return;
    console.warn('[assetLoading] Library download failed:', err);
    notify.error("The asset library couldn't finish downloading. Maps still draw with what is here.");
    useAssetLoading.setState((s) => ({ library: { ...s.library, status: 'failed' } }));
  } finally {
    if (controller === own) controller = null;
  }
}

export function pauseLibrary(): void {
  if (useAssetLoading.getState().library.status !== 'running') return;
  controller?.abort();
  controller = null;
  useAssetLoading.setState((s) => ({ library: { ...s.library, status: 'paused' } }));
}

/** Starts the library again; sets already stored are skipped. */
export function resumeLibrary(): void {
  if (useAssetLoading.getState().library.status !== 'paused') return;
  void runLibrary();
}

export function hidePill(): void {
  useAssetLoading.setState({ pillHidden: true });
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
export function resetAssetLoading(): void {
  boot = null;
  mapRun = null;
  mapSeq = 0;
  scheduled = false;
  controller = null;
  useAssetLoading.setState(initial());
}
