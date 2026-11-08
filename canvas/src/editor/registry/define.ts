// Helpers that type a def where it is written and hand it back in the registry's shape.
//
// A def is checked against its own value type here (schema, default, options and render
// all agree on T), then widened so tools, families and cards can hold defs of mixed types.

import type { CardDef, CardFieldDef, FamilyDef, ObjectKind, SettingDef, ToolDef } from './types';

export function defineSetting<T>(def: SettingDef<T>): SettingDef {
  return def as unknown as SettingDef;
}

export function defineCardField<K extends ObjectKind, T>(def: CardFieldDef<K, T>): CardFieldDef<K> {
  return def as unknown as CardFieldDef<K>;
}

export function defineTool(def: ToolDef): ToolDef {
  return def;
}

export function defineFamily(def: FamilyDef): FamilyDef {
  return def;
}

export function defineCard<K extends ObjectKind>(def: CardDef<K>): CardDef {
  return def as unknown as CardDef;
}
