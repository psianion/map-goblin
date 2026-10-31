// src/io/autosave.ts
// Debounced autosave of the active map.
//
// Autosave trigger: debounced 5 s after the last document change (15 s at most
// after the first unsaved one), brought forward for a one-click setting (see
// isSettingsChange). Skipped while a map
// switch is in flight (the store's isMapSwitching flag).

import { useStore } from '@/store/store';
import { notify } from '@/lib/toast';
import { ROOM_RUNTIME_KEYS } from '@dnd/core/src/shared/types';

// ─── What counts as an unsaved change ─────────────────────────────────────────

/** The slices `getSerializableState` actually writes to a save file. */
interface DocumentSlices {
  mapSettings: unknown;
  /** The map's levels. Optional so callers holding an older shape still type. */
  levels?: unknown;
  grid: { visible?: unknown; snapDivision?: unknown };
  layers: readonly object[];
  assets: { customImages: unknown };
  /** Splat bitmaps live outside customImages now — their rev is the change signal. */
  terrainSplats: { rev: number };
  /** Triggers, notes and room keys. Optional so callers holding an older shape still type. */
  prep?: unknown;
}

/**
 * Fields on a layer that are recomputed from its geometry rather than authored.
 *
 * `mergedFloor` is the boolean-op cache the engine fills in once the scene is
 * built (and `getSerializableState` strips it before saving). It gets rewritten
 * during a boot nobody touched, which is what left every session ending "dirty".
 * A real edit changes the geometry it comes from, so ignoring it loses nothing.
 */
const DERIVED_LAYER_FIELDS = ['mergedFloor'];

/**
 * A layer's rooms as the file holds them: each room without its derived face,
 * centroid, doors… Rooms are authored now (name, number, anchor, look), so they
 * count — but `syncRooms` rewrites the derived half on every boot, and that alone
 * must not read as an edit.
 */
function authoredRooms(rooms: unknown): string {
  if (!Array.isArray(rooms)) return '';
  return JSON.stringify(
    rooms.map((room: Record<string, unknown>) => {
      const out = { ...room };
      for (const key of ROOM_RUNTIME_KEYS) delete out[key];
      return out;
    }),
  );
}

/** Whether one layer field differs, reading `rooms` through its authored half. */
function fieldDiffers(key: string, a: unknown, b: unknown): boolean {
  if (a === b) return false;
  if (key === 'rooms') return authoredRooms(a) !== authoredRooms(b);
  return true;
}

/**
 * Layer fields set by a single pick in a settings control (opacity, name, which
 * parts show, the style chips) rather than drawn. Like map settings they save
 * promptly: a layer opacity left for a few seconds before a reload used to come
 * back at 100% because it waited out the drawing debounce.
 */
const SETTING_LAYER_FIELDS = new Set([
  'name',
  'visible',
  'locked',
  'opacity',
  'style',
  'sublayerVisibility',
  // A room or area edit (a rename, a number, a look, an area) is a pick in a
  // field, like a layer name; so is moving a layer to another level.
  'rooms',
  'areas',
  'levelId',
  'backgroundColor',
  'backgroundTexture',
  'textureScale',
  'textureTint',
  'presetLock',
]);

/** The authored fields that differ between two versions of a layer. */
function changedLayerFields(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  if (a === b) return [];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const derived of DERIVED_LAYER_FIELDS) keys.delete(derived);
  return [...keys].filter((k) => fieldDiffers(k, a[k], b[k]));
}

/** Layers, ignoring the derived fields above. */
function layersDiffer(next: readonly object[], prev: readonly object[]): boolean {
  if (next === prev) return false;
  if (next.length !== prev.length) return true;
  return next.some(
    (layer, i) => changedLayerFields(layer as Record<string, unknown>, prev[i] as Record<string, unknown>).length > 0,
  );
}

/** Object fields that are one click, like a layer's eye: a lock or a hide on a child or a wall. */
const FLAG_FIELDS = new Set(['locked', 'visible']);

/**
 * Do two lists of children (or walls) differ only in their lock / hide flags? Same length,
 * same ids in order, and every entry that changed changed nothing but `locked` / `visible`.
 */
function onlyFlagChanges(next: unknown, prev: unknown): boolean {
  if (!Array.isArray(next) || !Array.isArray(prev) || next.length !== prev.length) return false;
  for (let i = 0; i < next.length; i++) {
    const a = next[i] as Record<string, unknown>;
    const b = prev[i] as Record<string, unknown>;
    if (a === b) continue;
    if (a.id !== b.id) return false;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) if (a[k] !== b[k] && !FLAG_FIELDS.has(k)) return false;
  }
  return true;
}

/** Did only layer settings change (see SETTING_LAYER_FIELDS), with no drawing mixed in? */
function onlyLayerSettingsChanged(next: readonly object[], prev: readonly object[]): boolean {
  if (next === prev || next.length !== prev.length) return false;
  let any = false;
  for (let i = 0; i < next.length; i++) {
    const a = next[i] as Record<string, unknown>;
    const b = prev[i] as Record<string, unknown>;
    if (a.id !== b.id) return false;
    for (const k of changedLayerFields(a, b)) {
      const flagsOnly = (k === 'children' || k === 'standaloneWalls') && onlyFlagChanges(a[k], b[k]);
      if (!SETTING_LAYER_FIELDS.has(k) && !flagsOnly) return false;
      any = true;
    }
  }
  return any;
}

/**
 * Did this store change touch the saved document?
 *
 * The autosave subscriber used to fire on *any* state change — selecting a tool,
 * panning the camera, the asset packs finishing their install. Those scheduled
 * saves on a boot where the user did nothing. Only the slices that end up in a
 * save file count.
 */
export function isDocumentChange(next: DocumentSlices, prev: DocumentSlices): boolean {
  if (isSettingsChange(next, prev)) return true;
  if (next.assets.customImages !== prev.assets.customImages) return true;
  if (next.terrainSplats.rev !== prev.terrainSplats.rev) return true;
  return layersDiffer(next.layers, prev.layers);
}

/**
 * A one-click setting: the map settings, the grid fields the file keeps (shown,
 * snap division), a layer's settings (see SETTING_LAYER_FIELDS), a lock or hide on its
 * children and walls (see onlyFlagChanges), or a prep edit (a trigger, a note, a room key:
 * each a pick or a field in a sheet). Snap on/off is left out — it is the DM's per-browser
 * preference (io/snapPref.ts) and is not written to the map.
 *
 * These are single discrete picks, not a stream of strokes to coalesce, so they
 * are saved promptly rather than after the drawing debounce — a reload a few
 * seconds after choosing 1/4 snap used to bring the map back at 1/2.
 */
export function isSettingsChange(next: DocumentSlices, prev: DocumentSlices): boolean {
  if (next.mapSettings !== prev.mapSettings) return true;
  if (next.levels !== prev.levels) return true;
  if (next.prep !== prev.prep) return true;
  if (onlyLayerSettingsChanged(next.layers, prev.layers)) return true;
  if (next.grid === prev.grid) return false;
  return next.grid.visible !== prev.grid.visible || next.grid.snapDivision !== prev.grid.snapDivision;
}

// ─── Autosave Subscriber ──────────────────────────────────────────────────────

let _debounceTimer: ReturnType<typeof setTimeout> | null = null;
/** When the pending save is due, and whether a prompt (settings) change set it. */
let _dueAt = 0;
let _duePrompt = false;
/** When the first change the pending save holds came in. */
let _firstUnsavedAt = 0;
/**
 * Delay after the last drawing change. Short enough that a reload a few seconds after
 * stamping a prop keeps it (30 s lost stamps); long enough to batch a run of strokes.
 */
export const AUTOSAVE_DELAY_MS = 5_000;
/** The longest a drawing change waits, from the first unsaved one, however the strokes run on. */
export const AUTOSAVE_MAX_WAIT_MS = 15_000;
/** Delay after a one-click setting (see isSettingsChange): just long enough to batch a few picks. */
export const AUTOSAVE_PROMPT_DELAY_MS = 1_500;

/**
 * Start the autosave system.
 * Call once on app mount. Returns a cleanup function for unmount.
 *
 * The subscriber schedules an autosave {@link AUTOSAVE_DELAY_MS} after the last document
 * change, and no later than {@link AUTOSAVE_MAX_WAIT_MS} after the first change still
 * unsaved. A change the listener is told is prompt (a map setting, see
 * `isSettingsChange`) brings the save forward to
 * {@link AUTOSAVE_PROMPT_DELAY_MS}, and later drawing does not push it back out. Whatever is still pending when the page is hidden (tab switched,
 * closed, reloaded) is saved then rather than dropped with the timer.
 *
 * In multi-map mode, the debounced save calls `saveCurrentMap()` on the
 * store, which persists the active map to the new IndexedDB maps store.
 * The store's `isMapSwitching` flag skips the save while a map switch is in
 * flight, so a half-loaded map is never written over the one being opened.
 */
export function startAutosave(
  saveCurrentMap: () => Promise<void>,
  subscribe: (listener: (prompt?: boolean) => void) => () => void,
): () => void {
  const runSave = () => {
    _debounceTimer = null;
    _duePrompt = false;
    // Skip autosave during map switch
    if (useStore.getState().isMapSwitching) return;

    saveCurrentMap()
      .then(() => {
        notify.subtle('Autosaved', { icon: 'save' });
      })
      .catch((err: unknown) => {
        console.error('[autosave] save failed:', err);
        notify.action('Autosave failed — your changes may not be saved', {
          label: 'Retry',
          onClick: () => {
            saveCurrentMap()
              .then(() => {
                notify.subtle('Autosaved', { icon: 'save' });
              })
              .catch((retryErr: unknown) => {
                console.error('[autosave] retry failed:', retryErr);
                notify.error('Autosave retry failed — save manually to avoid losing work');
              });
          },
        });
      });
  };

  const handleChange = (prompt = false) => {
    const now = Date.now();
    if (_debounceTimer === null) _firstUnsavedAt = now;
    let due = prompt
      ? now + AUTOSAVE_PROMPT_DELAY_MS
      : Math.min(now + AUTOSAVE_DELAY_MS, _firstUnsavedAt + AUTOSAVE_MAX_WAIT_MS);
    // A prompt save already on the way keeps its slot: strokes that follow it
    // would otherwise slide the setting back out to the drawing delay.
    if (_debounceTimer !== null && _duePrompt) due = Math.min(due, _dueAt);
    _duePrompt = prompt || (_debounceTimer !== null && _duePrompt);
    _dueAt = due;

    if (_debounceTimer !== null) clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(runSave, Math.max(0, due - now));
  };

  // Leaving the page: a pending save is written now rather than lost with the timer.
  const flush = () => {
    if (_debounceTimer === null) return;
    clearTimeout(_debounceTimer);
    runSave();
  };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') flush();
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', flush);

  const unsubscribe = subscribe(handleChange);

  return () => {
    unsubscribe();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', flush);
    if (_debounceTimer !== null) {
      clearTimeout(_debounceTimer);
      _debounceTimer = null;
    }
    _duePrompt = false;
  };
}
