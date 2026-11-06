// How a SettingDef reaches the core store. Most defs name a dot path inside
// `tools.settings`; the rest carry their own read and write.

import type { Binding, SettingDef } from './types';

type Bag = Record<string, unknown>;

function isBag(v: unknown): v is Bag {
  return typeof v === 'object' && v !== null;
}

/** A binding to `tools.settings.<path>`, e.g. 'regularPolygon.sides'. */
export function settingsPath<T>(path: string): Binding<T> {
  const keys = path.split('.');
  const last = keys[keys.length - 1];
  return {
    read(state) {
      let at: unknown = state.tools.settings;
      for (const k of keys) at = isBag(at) ? at[k] : undefined;
      return at as T;
    },
    write(store, value) {
      store.setState((draft) => {
        let at: Bag = draft.tools.settings as unknown as Bag;
        for (const k of keys.slice(0, -1)) {
          // An optional group absent on old settings (plateau) is created on first write.
          if (!isBag(at[k])) at[k] = {};
          at = at[k] as Bag;
        }
        at[last] = value;
      });
    },
  };
}

const resolved = new WeakMap<object, Binding<unknown>>();

/** The def's binding: its own, or the one its path derives. */
export function bindingOf<T>(def: SettingDef<T>): Binding<T> {
  const known = resolved.get(def);
  if (known) return known as Binding<T>;
  const b = def.bind ?? settingsPath<T>(def.path as string);
  resolved.set(def, b as Binding<unknown>);
  return b;
}
