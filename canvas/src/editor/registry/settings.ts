// Reading and writing tool settings by id. The values live in the core store; this is the
// parse boundary in front of it. A write that does not parse is refused: setSetting returns
// false, writes nothing and, in dev, warns once per setting. Engine-side writes (the wheel
// turning a stamp) stay typed core code and do not pass through here.
//
// Prefs: settings that differ from their default are saved per browser under one key and
// loaded back through the same parse, so a bad or stale saved value is dropped, never
// written. Settings with `persist: false` are skipped both ways.

import { bindingOf } from './binding';
import type { Registry } from './index';
import type { CoreStore, SettingDef } from './types';

export const TOOL_SETTINGS_KEY = 'mapbuilder-tool-settings';

export interface Settings {
  getSetting(id: string): unknown;
  /** Parses, then writes through the binding. False when the id is unknown or the value does not parse. */
  setSetting(id: string, value: unknown): boolean;
  /** Puts every saved setting the tool lists back to its default. */
  resetTool(toolId: string): void;
  /** Applies saved values that parse; returns the ids it dropped. */
  loadPrefs(saved: unknown): string[];
  /** The saved form: every persisted setting that differs from its default. */
  prefsSnapshot(): Record<string, unknown>;
  /** Loads from localStorage, then saves on every change. Returns the unsubscribe. */
  initPrefs(): () => void;
}

const warned = new Set<string>();

function warnOnce(id: string, why: string): void {
  if (!import.meta.env.DEV || warned.has(id)) return;
  warned.add(id);
  console.warn(`Tool setting "${id}": ${why}`);
}

function persisted(def: SettingDef): boolean {
  return def.persist !== false;
}

function same(a: unknown, b: unknown): boolean {
  return Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b);
}

function readStorage(): unknown {
  try {
    const raw = localStorage.getItem(TOOL_SETTINGS_KEY);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeStorage(snapshot: Record<string, unknown>): void {
  try {
    localStorage.setItem(TOOL_SETTINGS_KEY, JSON.stringify(snapshot));
  } catch {
    /* private mode or a full quota: the settings last the session */
  }
}

export function createSettings(reg: Registry, store: CoreStore): Settings {
  const savedDefs = () => {
    const out = new Set<SettingDef>();
    for (const t of reg.tools) for (const s of t.settings) if (persisted(s)) out.add(s);
    for (const s of reg.shared) if (persisted(s)) out.add(s);
    return [...out];
  };

  const write = (def: SettingDef, value: unknown): boolean => {
    const parsed = def.schema.safeParse(value);
    if (!parsed.success) {
      warnOnce(def.id, `refused ${JSON.stringify(value)}`);
      return false;
    }
    bindingOf(def).write(store, parsed.data);
    return true;
  };

  const settings: Settings = {
    getSetting(id) {
      const def = reg.settingById(id);
      return def ? bindingOf(def).read(store.getState()) : undefined;
    },
    setSetting(id, value) {
      const def = reg.settingById(id);
      if (!def) {
        warnOnce(id, 'no such setting');
        return false;
      }
      return write(def, value);
    },
    resetTool(toolId) {
      for (const def of reg.toolById(toolId)?.settings ?? []) {
        if (persisted(def)) bindingOf(def).write(store, def.default);
      }
    },
    loadPrefs(saved) {
      if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) return [];
      const dropped: string[] = [];
      for (const [id, value] of Object.entries(saved)) {
        const def = reg.settingById(id);
        if (!def || !persisted(def) || !write(def, value)) dropped.push(id);
      }
      return dropped;
    },
    prefsSnapshot() {
      const state = store.getState();
      const out: Record<string, unknown> = {};
      for (const def of savedDefs()) {
        const value = bindingOf(def).read(state);
        if (!same(value, def.default)) out[def.id] = value;
      }
      return out;
    },
    initPrefs() {
      let remembered = readStorage();
      settings.loadPrefs(remembered);
      const defs = savedDefs();
      return store.subscribe((s, prev) => {
        // A new or opened map resets the tools to the factory defaults; the DM's saved
        // settings come back rather than being overwritten (as initLightBrush does).
        if (s.layers !== prev.layers && s.tools !== prev.tools) {
          settings.loadPrefs(remembered);
          return;
        }
        if (defs.every((d) => same(bindingOf(d).read(s), bindingOf(d).read(prev)))) return;
        const snapshot = settings.prefsSnapshot();
        remembered = snapshot;
        writeStorage(snapshot);
      });
    },
  };
  return settings;
}

