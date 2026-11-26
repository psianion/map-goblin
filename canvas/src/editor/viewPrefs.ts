import { useSyncExternalStore } from 'react';
import { useStore } from '@/store/store';
import type { LightDefaults, TimeOfDay, UISlice } from '@/store/types';
import { LIGHT_PRESETS, lightPreset, presetDefaults, type LightPresetId } from '@dnd/core/src/store/lightPresets';
import { onLightPlaced } from '@dnd/core/src/engine/tools/LightTool';
import { notify } from '@dnd/ui/toast';

/**
 * How the editor is viewed, remembered per browser: the focus mode (the store holds the
 * live value, this remembers it across reloads) and Preview as (canvas-side; the store only
 * sees its time). Storage can be unavailable, in which case a choice lasts the session.
 */

export type FocusMode = 'auto' | 'manual' | 'fullscreen';

/** The order the backtick cycles through. */
export const FOCUS_MODES: readonly FocusMode[] = ['auto', 'manual', 'fullscreen'];

export const FOCUS_MODE_KEY = 'mapbuilder-focus-mode';
/** Where v1 kept the mode. Read once, moved to the new key, then dropped. */
export const LEGACY_FOCUS_MODE_KEY = 'focusMode';
/** Where the lit switch was kept before Preview as. Read once, moved over, then dropped. */
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

// ── Marquee filter ────────────────────────────────────────

export const MARQUEE_FILTER_KEY = 'mapbuilder-marquee-filter';

type MarqueeFilter = UISlice['marqueeFilter'];

/** What the marquee picks, as saved: Everything unless "This tab's kind" was saved. */
export function loadMarqueeFilter(): MarqueeFilter {
  try {
    return localStorage.getItem(MARQUEE_FILTER_KEY) === 'tab' ? 'tab' : 'all';
  } catch {
    return 'all';
  }
}

let stopMarqueePrefs: (() => void) | null = null;

/**
 * Put the remembered marquee filter in the store and keep remembering it, as the prop view
 * is: a store reset (a new map) keeps the DM's choice rather than the default.
 */
export function initMarqueePrefs(): void {
  if (stopMarqueePrefs) return;
  let remembered = loadMarqueeFilter();
  if (useStore.getState().ui.marqueeFilter !== remembered) useStore.getState().setMarqueeFilter(remembered);
  stopMarqueePrefs = useStore.subscribe((s, prev) => {
    const next = s.ui.marqueeFilter;
    if (next === remembered) return;
    const reset = s.layers !== prev.layers && s.tools !== prev.tools;
    if (reset) {
      useStore.getState().setMarqueeFilter(remembered);
      return;
    }
    remembered = next;
    try {
      localStorage.setItem(MARQUEE_FILTER_KEY, next);
    } catch {
      /* private mode: the choice lasts the session */
    }
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

// ── Preview as ────────────────────────────────────────────

/** What the editor draws the map under: unlit, or lit at one of the four times. */
export type PreviewPref = 'unlit' | TimeOfDay;

export const PREVIEW_KEY = 'mapbuilder-preview';

const TIMES: readonly TimeOfDay[] = ['dawn', 'day', 'dusk', 'night'];
const isTime = (v: unknown): v is TimeOfDay => TIMES.includes(v as TimeOfDay);

/** Display names, for the status chip and the toasts. */
export const TIME_NAMES: Record<TimeOfDay, string> = { dawn: 'Dawn', day: 'Day', dusk: 'Dusk', night: 'Night' };

const previewListeners = new Set<() => void>();
let preview: PreviewPref | null = null;
/** The time `I` and `litOnForEdit` go back to: the last one picked, Day at first. */
let lastTime: TimeOfDay = 'day';

/** The saved pick; with none, the old lit switch read once (on is Day), then dropped. */
function readPreview(): PreviewPref {
  try {
    const saved = localStorage.getItem(PREVIEW_KEY);
    if (saved === 'unlit' || isTime(saved)) return saved;
    const legacy = localStorage.getItem(LIT_PREVIEW_KEY);
    if (legacy !== null) {
      localStorage.removeItem(LIT_PREVIEW_KEY);
      const moved: PreviewPref = legacy === '1' ? 'day' : 'unlit';
      localStorage.setItem(PREVIEW_KEY, moved);
      return moved;
    }
  } catch {
    /* storage unavailable */
  }
  return 'unlit';
}

/** How the map is previewed while editing. Unlit unless the DM picked a time. */
export function getPreview(): PreviewPref {
  if (preview === null) {
    preview = readPreview();
    if (preview !== 'unlit') lastTime = preview;
  }
  return preview;
}

/** The time the preview is lit at, or would be lit at once turned on. */
export function previewTime(): TimeOfDay {
  getPreview();
  return lastTime;
}

export function setPreview(next: PreviewPref): void {
  if (getPreview() === next) return;
  preview = next;
  if (next !== 'unlit') lastTime = next;
  try {
    localStorage.setItem(PREVIEW_KEY, next);
  } catch {
    /* private mode: the choice lasts the session */
  }
  for (const l of previewListeners) l();
}

/** Unlit to the last picked time and back (the `I` key); returns the new pick. */
export function togglePreview(): PreviewPref {
  setPreview(getPreview() === 'unlit' ? previewTime() : 'unlit');
  return getPreview();
}

/** The status chip's words: "Preview · Dusk", or "Unlit". */
export function previewLabel(pick: PreviewPref): string {
  return pick === 'unlit' ? 'Unlit' : `Preview · ${TIME_NAMES[pick]}`;
}

export const LIT_ON_TOAST = 'Preview lit · press I to toggle';

/**
 * A change only the lit preview shows (a light placed; the place or the shadows set in the
 * Sky sheet): light the preview at the last picked time, with one toast saying so. Never
 * turns it off.
 */
export function litOnForEdit(): void {
  if (getPreview() !== 'unlit') return;
  setPreview(previewTime());
  notify.subtle(LIT_ON_TOAST, { icon: 'eye' });
}

let stopLitOnLight: (() => void) | null = null;

/** Placing a light with the Light tool lights the preview (`litOnForEdit`). Called once. */
export function initLitOnLight(): void {
  stopLitOnLight ??= onLightPlaced(litOnForEdit);
}

function subscribePreview(listener: () => void): () => void {
  previewListeners.add(listener);
  return () => previewListeners.delete(listener);
}

export function usePreview(): PreviewPref {
  return useSyncExternalStore(subscribePreview, getPreview, () => 'unlit' as const);
}

export const LAYERS_SHEET_FILTER_KEY = 'mapbuilder-layers-sheet-filter';

/** The Layers sheet's last filter text; empty when none was kept. */
export function loadLayersSheetFilter(): string {
  try {
    return localStorage.getItem(LAYERS_SHEET_FILTER_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveLayersSheetFilter(text: string): void {
  try {
    if (text) localStorage.setItem(LAYERS_SHEET_FILTER_KEY, text);
    else localStorage.removeItem(LAYERS_SHEET_FILTER_KEY);
  } catch {
    /* private mode: the filter lasts the session */
  }
}

// ── Light icons ───────────────────────────────────────────

export const LIGHT_ICONS_KEY = 'mapbuilder-light-icons';

const lightIconListeners = new Set<() => void>();
let lightIcons: boolean | null = null;

/**
 * Whether the canvas draws the light and darkness bulbs (View > Light icons). On unless this
 * browser turned them off; never saved in the map. The Light tool in hand and a selected light
 * still show theirs (`canvas/lightIcons.ts`).
 */
export function getLightIcons(): boolean {
  if (lightIcons === null) {
    try {
      lightIcons = localStorage.getItem(LIGHT_ICONS_KEY) !== 'off';
    } catch {
      lightIcons = true;
    }
  }
  return lightIcons;
}

export function setLightIcons(on: boolean): void {
  if (getLightIcons() === on) return;
  lightIcons = on;
  try {
    localStorage.setItem(LIGHT_ICONS_KEY, on ? 'on' : 'off');
  } catch {
    /* private mode: the choice lasts the session */
  }
  for (const l of lightIconListeners) l();
}

export function subscribeLightIcons(listener: () => void): () => void {
  lightIconListeners.add(listener);
  return () => lightIconListeners.delete(listener);
}

export function useLightIcons(): boolean {
  return useSyncExternalStore(subscribeLightIcons, getLightIcons, () => true);
}

/** Tests only: forget the cached values so the next read goes back to storage. */
export function resetViewPrefsForTests(): void {
  preview = null;
  lightIcons = null;
  lastTime = 'day';
  stopFocusMode?.();
  stopFocusMode = null;
  stopRoomPrefs?.();
  stopRoomPrefs = null;
  stopPropPrefs?.();
  stopPropPrefs = null;
  stopMarqueePrefs?.();
  stopMarqueePrefs = null;
  stopLightBrush?.();
  stopLightBrush = null;
  stopLitOnLight?.();
  stopLitOnLight = null;
}
