// The registry's rules (plan section 7.3), checked against whatever is registered. Pure:
// registry.test.ts runs it on the real registry and on broken fixtures.

import { bindingOf } from './binding';
import type { CardFieldDef, EditorState, Home, SettingDef } from './types';
import type { RegistryInput } from './index';

export type Rule =
  | 'unique-id'
  | 'one-home'
  | 'unique-key'
  | 'custom-render'
  | 'default-parses'
  | 'has-hint'
  | 'binding'
  | 'tabs';

export const RULES: readonly Rule[] = [
  'unique-id',
  'one-home',
  'unique-key',
  'custom-render',
  'default-parses',
  'has-hint',
  'binding',
  'tabs',
];

export interface Problem {
  rule: Rule;
  message: string;
}

const HOMES: readonly Home[] = ['dock', 'panel', 'card'];

/** Plain data compares by value; defaults are always plain data. */
function same(a: unknown, b: unknown): boolean {
  return Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Every problem in the registry. With `fresh` (a default core state), also checks that
 * each binding reads a value there that equals the def's default, so the registry and
 * the core store's factories never disagree about where a tool starts.
 */
export function validateRegistry(reg: RegistryInput, fresh?: EditorState): Problem[] {
  const problems: Problem[] = [];
  const fail = (rule: Rule, message: string) => problems.push({ rule, message });

  // Each definition once, however many tools reference it.
  const toolSettings = new Set<SettingDef>(reg.shared);
  const tools = [...reg.rail, ...reg.families.flatMap((f) => f.tools)];
  for (const t of tools) for (const s of t.settings) toolSettings.add(s);
  const cardFields = new Set<CardFieldDef>(reg.cards.flatMap((c) => c.fields));
  const defs = [...toolSettings, ...cardFields];

  const byId = new Map<string, number>();
  for (const d of defs) byId.set(d.id, (byId.get(d.id) ?? 0) + 1);
  for (const [id, n] of byId) if (n > 1) fail('unique-id', `${n} definitions share the id "${id}"`);

  for (const d of defs) if (!HOMES.includes(d.home)) fail('one-home', `"${d.id}" has no valid home`);
  for (const t of tools) {
    for (const s of t.settings) {
      if (s.home === 'card') fail('one-home', `tool "${t.id}" lists "${s.id}", whose home is the card`);
    }
  }
  for (const f of cardFields) if (f.home !== 'card') fail('one-home', `card field "${f.id}" is homed in the ${f.home}`);

  const keyClash = (scope: string, entries: { id: string; key: string }[]) => {
    const seen = new Map<string, string>();
    for (const { id, key } of entries) {
      const k = key.toUpperCase();
      const other = seen.get(k);
      if (other) fail('unique-key', `${scope}: "${id}" and "${other}" both take ${k}`);
      else seen.set(k, id);
    }
  };
  keyClash('rail', [...reg.rail, ...reg.families]);
  for (const f of reg.families) keyClash(`family "${f.id}"`, [...f.tools]);

  for (const d of defs) {
    if (d.control === 'custom' && !d.render) fail('custom-render', `"${d.id}" is custom but has no render`);
  }

  for (const d of defs) {
    if (!d.schema.safeParse(d.default).success) fail('default-parses', `"${d.id}" default does not parse`);
  }

  for (const t of tools) if (typeof t.hint !== 'function') fail('has-hint', `tool "${t.id}" has no hint`);

  // A tab's id is unique within its tool and is not the tool's own (the first tab); its
  // settings are other tools' dock settings, registered there, never this tool's own.
  for (const t of tools) {
    const ids = new Set<string>([t.id]);
    for (const tab of t.tabs ?? []) {
      if (ids.has(tab.id)) fail('tabs', `tool "${t.id}" has two tabs "${tab.id}"`);
      ids.add(tab.id);
      for (const s of tab.settings ?? []) {
        if (t.settings.includes(s)) fail('tabs', `tool "${t.id}" tab "${tab.id}" lists its own setting "${s.id}"`);
        else if (!toolSettings.has(s)) fail('tabs', `tool "${t.id}" tab "${tab.id}" lists "${s.id}", which no tool registers`);
        else if (s.home !== 'dock') fail('tabs', `tool "${t.id}" tab "${tab.id}" lists "${s.id}", which is not a dock setting`);
      }
    }
  }

  for (const d of toolSettings) {
    const hasPath = typeof d.path === 'string' && d.path.length > 0;
    if (hasPath === Boolean(d.bind)) {
      fail('binding', `"${d.id}" needs exactly one of path or bind`);
      continue;
    }
    // A default that does not parse is already reported above.
    if (!fresh || !d.schema.safeParse(d.default).success) continue;
    const value = bindingOf(d).read(fresh);
    if (!same(value, d.default)) {
      fail('binding', `"${d.id}" reads ${JSON.stringify(value)} on a fresh store, default is ${JSON.stringify(d.default)}`);
    }
  }

  return problems;
}
