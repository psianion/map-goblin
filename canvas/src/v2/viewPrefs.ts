import { useSyncExternalStore } from 'react';
import { useStore } from '@/store/store';
import type { LightDefaults, UISlice } from '@/store/types';
import { LIGHT_PRESETS, lightPreset, presetDefaults, type LightPresetId } from '@dnd/core/src/store/lightPresets';

/**
 * How the editor is viewed, remembered per browser: the focus mode (the store holds the
 * live value, this remembers it across reloads) and the lit preview (canvas-side only; the
 * store never sees it). Storage can be unavailable, in which case a choice lasts the session.
 */

export type FocusMode = 'auto' | 'manual' | 'fullscreen';

/** The order the backtick cycles through. */
export const FOCUS_MODES: readonly FocusMode[] = ['auto', 'manual', 'fullscreen'];

export const FOCUS_MODE_KEY = 'mapbuilder-focus-mode';
/** Where v1 kept the mode. Read once, moved to the new key, then dropped. */
export const LEGACY_FOCUS_MODE_KEY = 'focusMode';
export const LIT_PREVIEW_KEY = 'mapbuilder-lit-preview';

function isFocusMode(value: unknown): value is FocusMode {
  return value === 'auto' || value === 'manual' || value === 'fullscreen';
}

/** The remembered focus mode; Auto when nothing (or nothing valid) was saved. */
export function loadFocusMode(): FocusMode {
  try {
    const saved = localStorage.getItem(FOCUS_MODE_KEY);
    if (isFocusMode(saved)) return saved;
    const legacy = localStorage.getItem(LEGACY_FOCUS_MODE_KEY);
    if (legacy !== null) {
      localStorage.removeItem(LEGACY_FOCUS_MODE_KEY);
      if (isFocusMode(legacy)) {
        localStorage.setItem(FOCUS_MODE_KEY, legacy);
        return legacy;
      }
    }
  } catch {
    /* storage unavailable */
  }
  return 'auto';
}

export function saveFocusMode(mode: FocusMode): void {
  try {
    localStorage.setItem(FOCUS_MODE_KEY, mode);
  } catch {
    /* private mode: the choice lasts the session */
  }
}

/** The mode after `mode` in the backtick's cycle. */
export function nextFocusMode(mode: FocusMode): FocusMode {
  return FOCUS_MODES[(FOCUS_MODES.indexOf(mode) + 1) % FOCUS_MODES.length];
}

let stopFocusMode: (() => void) | null = null;

/**
 * Put the remembered focus mode in the store and keep remembering it. Called once, before
 * the editor's first render, so the saved mode is never overwritten by the store's default.
 *
 * Starting a new map resets the whole store, focus mode included; that is not the DM
 * changing their mind, so the remembered mode is put back instead of the default saved.
 * A reset is told apart by what it takes with it: a focus change on its own only ever
 * touches the ui slice, a reset replaces the layers and tools in the same update.
 */
export function initFocusMode(): void {
  if (stopFocusMode) return;
  let remembered = loadFocusMode();
  if (useStore.getState().ui.focusMode !== remembered) useStore.getState().setFocusMode(remembered);
  stopFocusMode = useStore.subscribe((s, prev) => {
    const mode = s.ui.focusMode;
    if (mode === prev.ui.focusMode || mode === remembered) return;
    const reset = s.layers !== prev.layers && s.tools !== prev.tools;
    if (reset) {
      useStore.getState().setFocusMode(remembered);
      return;
    }
    remembered = mode;
    saveFocusMode(mode);
  });
}

// ── Room view ─────────────────────────────────────────────

export const ROOM_PREFS_KEY = 'mapbuilder-room-prefs';

/** The room view preferences that outlive a reload: labels, divider, room walls, the sheet. */
export type RoomPrefs = Pick<UISlice, 'roomLabels' | 'dividerMode' | 'roomWalls' | 'roomsSheetOpen'>;

const ROOM_PREF_VALUES: { [K in keyof RoomPrefs]: readonly RoomPrefs[K][] } = {
  roomLabels: ['off', 'numbers', 'both'],
  dividerMode: ['threshold', 'wall'],
  roomWalls: ['with', 'none'],
  roomsSheetOpen: [true, false],
};

const ROOM_PREF_KEYS = Object.keys(ROOM_PREF_VALUES) as (keyof RoomPrefs)[];

/** What was saved, key by key; a key missing or holding something unknown is left out. */
export function loadRoomPrefs(): Partial<RoomPrefs> {
  try {
    const raw = JSON.parse(localStorage.getItem(ROOM_PREFS_KEY) ?? '{}') as Record<string, unknown>;
    const out: Partial<Record<keyof RoomPrefs, unknown>> = {};
    for (const key of ROOM_PREF_KEYS) {
      if ((ROOM_PREF_VALUES[key] as readonly unknown[]).includes(raw[key])) out[key] = raw[key];
    }
    return out as Partial<RoomPrefs>;
  } catch {
    return {};
  }
}

export function saveRoomPrefs(prefs: RoomPrefs): void {
  try {
    localStorage.setItem(ROOM_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* private mode: the choice lasts the session */
  }
}

function roomPrefsOf(ui: UISlice): RoomPrefs {
  return { roomLabels: ui.roomLabels, dividerMode: ui.dividerMode, roomWalls: ui.roomWalls, roomsSheetOpen: ui.roomsSheetOpen };
}

function applyRoomPrefs(prefs: Partial<RoomPrefs>): void {
  const s = useStore.getState();
  if (prefs.roomLabels !== undefined && s.ui.roomLabels !== prefs.roomLabels) s.setRoomLabels(prefs.roomLabels);
  if (prefs.dividerMode !== undefined && s.ui.dividerMode !== prefs.dividerMode) s.setDividerMode(prefs.dividerMode);
  if (prefs.roomWalls !== undefined && s.ui.roomWalls !== prefs.roomWalls) s.setRoomWalls(prefs.roomWalls);
  if (prefs.roomsSheetOpen !== undefined && s.ui.roomsSheetOpen !== prefs.roomsSheetOpen) {
    s.setRoomsSheetOpen(prefs.roomsSheetOpen);
  }
}

let stopRoomPrefs: (() => void) | null = null;

/**
 * Put the remembered room view in the store and keep remembering it, the way the focus
 * mode is: called once before the editor's first render, and a store reset (a new map)
 * gets the remembered view back rather than the defaults saved over it.
 */
export function initRoomPrefs(): void {
  if (stopRoomPrefs) return;
  let remembered: RoomPrefs = { ...roomPrefsOf(useStore.getState().ui), ...loadRoomPrefs() };
  applyRoomPrefs(remembered);
  stopRoomPrefs = useStore.subscribe((s, prev) => {
    const next = roomPrefsOf(s.ui);
    if (ROOM_PREF_KEYS.every((k) => next[k] === remembered[k])) return;
    const reset = s.layers !== prev.layers && s.tools !== prev.tools;
    if (reset) {
      applyRoomPrefs(remembered);
      return;
    }
    remembered = next;
    saveRoomPrefs(next);
  });
}

// ── Prop view ─────────────────────────────────────────────

export const PROP_PREFS_KEY = 'mapbuilder-prop-prefs';

/** The prop view preferences that outlive a reload: whether overhead props fade and let clicks through. */
export type PropPrefs = Pick<UISlice, 'seeUnderOverhead'>;

/** What was saved; a missing or unknown value is left out. */
export function loadPropPrefs(): Partial<PropPrefs> {
  try {
    const raw = JSON.parse(localStorage.getItem(PROP_PREFS_KEY) ?? '{}') as Record<string, unknown>;
    return typeof raw.seeUnderOverhead === 'boolean' ? { seeUnderOverhead: raw.seeUnderOverhead } : {};
  } catch {
    return {};
  }
}

export function savePropPrefs(prefs: PropPrefs): void {
  try {
    localStorage.setItem(PROP_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* private mode: the choice lasts the session */
  }
}

function applyPropPrefs(prefs: Partial<PropPrefs>): void {
  const want = prefs.seeUnderOverhead;
  if (want === undefined || useStore.getState().ui.seeUnderOverhead === want) return;
  useStore.getState().setSeeUnderOverhead(want);
}

let stopPropPrefs: (() => void) | null = null;

/**
 * Put the remembered prop view in the store and keep remembering it, as the room view
 * is: a store reset (a new map) gets the remembered view back rather than the default.
 */
export function initPropPrefs(): void {
  if (stopPropPrefs) return;
  let remembered: PropPrefs = { seeUnderOverhead: useStore.getState().ui.seeUnderOverhead, ...loadPropPrefs() };
  applyPropPrefs(remembered);
  stopPropPrefs = useStore.subscribe((s, prev) => {
    const next = s.ui.seeUnderOverhead;
    if (next === remembered.seeUnderOverhead) return;
    const reset = s.layers !== prev.layers && s.tools !== prev.tools;
    if (reset) {
      applyPropPrefs(remembered);
      return;
    }
    remembered = { seeUnderOverhead: next };
    savePropPrefs(remembered);
  });
}

// ── Light brush ───────────────────────────────────────────

export const LIGHT_BRUSH_KEY = 'mapbuilder-light-brush';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The Lights dock's brush (the next light's settings) as saved; the Torch preset when
 * nothing, or nothing valid, was saved. An optional field holding something unknown is
 * dropped and the rest kept.
 */
export function loadLightBrush(): LightDefaults {
  const torch = presetDefaults(lightPreset('torch'));
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(LIGHT_BRUSH_KEY) ?? 'null');
    if (!isObj(raw)) return torch;
    const { color, radius, featherRadius, intensity, falloff } = raw;
    if (typeof color !== 'string' || !isNum(radius) || !isNum(featherRadius) || !isNum(intensity)) return torch;
    if (falloff !== 'linear' && falloff !== 'quadratic') return torch;
    const out: LightDefaults = { color, radius, featherRadius, intensity, falloff };
    if (LIGHT_PRESETS.some((p) => p.id === raw.presetId)) out.presetId = raw.presetId as LightPresetId;
    const { cone, animation, nightOnly } = raw;
    if (isObj(cone) && isNum(cone.angle) && isNum(cone.direction)) out.cone = { angle: cone.angle, direction: cone.direction };
    if (isObj(animation) && (animation.kind === 'flicker' || animation.kind === 'pulse') && isNum(animation.speed)) {
      out.animation = { kind: animation.kind, speed: animation.speed };
    }
    if (isObj(nightOnly) && isNum(nightOnly.min) && isNum(nightOnly.max)) out.nightOnly = { min: nightOnly.min, max: nightOnly.max };
    for (const key of ['throughWalls', 'darkness', 'darkvisionSees'] as const) {
      if (typeof raw[key] === 'boolean') out[key] = raw[key];
    }
    return out;
  } catch {
    return torch;
  }
}

export function saveLightBrush(brush: LightDefaults): void {
  try {
    localStorage.setItem(LIGHT_BRUSH_KEY, JSON.stringify(brush));
  } catch {
    /* private mode: the brush lasts the session */
  }
}

function applyLightBrush(brush: LightDefaults): void {
  useStore.getState().updateToolSettings({ lightDefaults: { ...brush } });
}

let stopLightBrush: (() => void) | null = null;

/**
 * Put the remembered light brush in the store and keep remembering it, as the prop view
 * is: every change to the next light's settings is saved, and a store reset (a new map)
 * gets the remembered brush back rather than the tool default.
 */
export function initLightBrush(): void {
  if (stopLightBrush) return;
  let remembered = loadLightBrush();
  applyLightBrush(remembered);
  stopLightBrush = useStore.subscribe((s, prev) => {
    const next = s.tools.settings.lightDefaults;
    if (next === prev.tools.settings.lightDefaults || next === remembered) return;
    const reset = s.layers !== prev.layers && s.tools !== prev.tools;
    if (reset) {
      applyLightBrush(remembered);
      return;
    }
    remembered = next;
    saveLightBrush(next);
  });
}

// ── Lit preview ───────────────────────────────────────────

const litListeners = new Set<() => void>();
let lit: boolean | null = null;

function readLitPreview(): boolean {
  try {
    return localStorage.getItem(LIT_PREVIEW_KEY) === '1';
  } catch {
    return false;
  }
}

/** Show the map's lighting and mood while editing. Off unless the DM turned it on. */
export function getLitPreview(): boolean {
  if (lit === null) lit = readLitPreview();
  return lit;
}

export function setLitPreview(on: boolean): void {
  if (getLitPreview() === on) return;
  lit = on;
  try {
    localStorage.setItem(LIT_PREVIEW_KEY, on ? '1' : '0');
  } catch {
    /* private mode: the choice lasts the session */
  }
  for (const l of litListeners) l();
}

/** Flips the lit preview and returns the new value. */
export function toggleLitPreview(): boolean {
  setLitPreview(!getLitPreview());
  return getLitPreview();
}

function subscribeLit(listener: () => void): () => void {
  litListeners.add(listener);
  return () => litListeners.delete(listener);
}

export function useLitPreview(): boolean {
  return useSyncExternalStore(subscribeLit, getLitPreview, () => false);
}

// ── Sky & mood: the Preview block's fold ─────────────────

export const SKY_PREVIEW_KEY = 'mapbuilder-sky-preview-open';

/** Whether the Sky & mood sheet's Preview block is open. Folded unless the DM opened it. */
export function getSkyPreviewOpen(): boolean {
  try {
    return localStorage.getItem(SKY_PREVIEW_KEY) === '1';
  } catch {
    return false;
  }
}

export function setSkyPreviewOpen(open: boolean): void {
  try {
    localStorage.setItem(SKY_PREVIEW_KEY, open ? '1' : '0');
  } catch {
    /* private mode: the fold lasts the session */
  }
}

/** Tests only: forget the cached values so the next read goes back to storage. */
export function resetViewPrefsForTests(): void {
  lit = null;
  stopFocusMode?.();
  stopFocusMode = null;
  stopRoomPrefs?.();
  stopRoomPrefs = null;
  stopPropPrefs?.();
  stopPropPrefs = null;
  stopLightBrush?.();
  stopLightBrush = null;
}
