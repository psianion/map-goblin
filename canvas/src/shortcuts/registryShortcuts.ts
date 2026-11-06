// The tool and family keys, generated from the registry (plan 7.4). The hand-written global
// chords stay in defaultShortcuts.ts; the new shell installs these beside them with
// setRegistryShortcuts. Also here: the collision check the tests run, and the one table the
// shortcuts sheet lists both parts from.

import { useStore } from '@/store/store';
import type { CardDef, FamilyDef, Registry, SettingDef, ToolDef } from '@/editor/registry';
import type { Settings } from '@/editor/registry/settings';
import { POINTER_HINTS, SHORTCUT_GROUPS, SHORTCUTS, toTool, type Shortcut } from './defaultShortcuts';
import { formatCombo } from './formatCombo';

export type KeyKind = 'rail' | 'family' | 'tool' | 'dock' | 'previous' | 'verb';

export interface RegistryShortcut extends Shortcut {
  kind: KeyKind;
  /** The family a tool key belongs to. */
  family?: FamilyDef['id'];
  /** The tool a rail, tool or dock key is for. */
  tool?: string;
  /** The card a verb key acts from. */
  card?: string;
  /** What declared the key: a setting id, a verb id, a tool id, a family id. */
  source: string;
}

/** What the shell lends the keys: its flyout, the tool in hand, the last tool, the card on show. */
export interface ShellKeyActions {
  flyout(): FamilyDef['id'] | null;
  setFlyout(family: FamilyDef['id'] | null): void;
  pickTool(tool: ToolDef): void;
  activeTool(): ToolDef | undefined;
  lastTool(): ToolDef | undefined;
  /** The card showing for a single pick, if any. */
  card(): CardDef | null;
}

/** Previous tool: off X, which is the Text family's. */
export const PREVIOUS_TOOL_KEY = 'q';

/**
 * Letters held for one owner in every family, whatever tool is in hand. N is Node mode (the
 * shared dock setting and the cards' Node mode verb), so no tool may take N: Label moves off
 * it when the Text family registers.
 */
export const RESERVED_KEYS: Record<string, { label: string; owners: readonly string[] }> = {
  n: { label: 'Node mode', owners: ['edit.nodeMode', 'nodeMode'] },
};

const lower = (key: string) => key.toLowerCase();

function visible(def: SettingDef, settings: Settings): boolean {
  return !def.visibleWhen || def.visibleWhen((id) => settings.getSetting(id));
}

/** The registry's keys, wired to the shell. */
export function registryShortcuts(registry: Registry, settings: Settings, shell: ShellKeyActions): RegistryShortcut[] {
  const out: RegistryShortcut[] = [];
  const base = { group: 'Tools' as const, scope: 'canvas' as const };
  const familyInHand = () => {
    const t = shell.activeTool();
    return t ? registry.familyOfTool(t.id)?.id : undefined;
  };

  for (const t of registry.rail) {
    out.push({
      ...base, kind: 'rail', id: `rail.${t.id}`, combo: lower(t.key), label: t.label, tool: t.id, source: t.id,
      run: () => {
        shell.setFlyout(null);
        shell.pickTool(t);
      },
    });
  }

  for (const f of registry.families) {
    out.push({
      ...base, kind: 'family', id: `family.${f.id}`, combo: lower(f.key), label: f.label, family: f.id, source: f.id,
      run: () => shell.setFlyout(shell.flyout() === f.id ? null : f.id),
    });
    for (const t of f.tools) {
      out.push({
        ...base, kind: 'tool', id: `tool.${t.id}`, combo: lower(t.key), label: t.label, family: f.id, tool: t.id, source: t.id,
        // From the family's open flyout, or straight away while one of its tools is in hand.
        when: () => (shell.flyout() !== null ? shell.flyout() === f.id : familyInHand() === f.id),
        run: () => {
          shell.pickTool(t);
          shell.setFlyout(null);
        },
      });
    }
  }

  for (const t of registry.tools) {
    // An open flyout owns the letters: the tool's own keys stand down until it closes.
    const inHand = () => shell.activeTool()?.id === t.id && shell.flyout() === null;
    for (const s of t.settings) {
      if (s.control === 'seg') {
        for (const o of s.options ?? []) {
          if (!o.key) continue;
          out.push({
            ...base, kind: 'dock', id: `dock.${t.id}.${s.id}.${String(o.value)}`, combo: lower(o.key), label: `${s.label}: ${o.label}`,
            tool: t.id, source: s.id,
            when: () => inHand() && visible(s, settings),
            run: () => void settings.setSetting(s.id, o.value),
          });
        }
      } else if (s.control === 'switch' && s.key) {
        out.push({
          ...base, kind: 'dock', id: `dock.${t.id}.${s.id}`, combo: lower(s.key), label: s.label, tool: t.id, source: s.id,
          when: () => inHand() && visible(s, settings),
          run: () => void settings.setSetting(s.id, settings.getSetting(s.id) !== true),
        });
      }
    }
    for (const k of t.keys ?? []) {
      out.push({
        ...base, kind: 'dock', id: `key.${t.id}.${k.id}`, combo: k.combo, label: k.label, tool: t.id, source: k.id,
        when: inHand,
        run: (e) => (k.run ? k.run(useStore) : toTool(e)),
      });
    }
  }

  out.push({
    ...base, kind: 'previous', id: 'tool.previous', combo: PREVIOUS_TOOL_KEY, label: 'Previous tool', source: 'tool.previous',
    // A rail tool in hand (Select) and a family tool to go back to.
    when: () => {
      const t = shell.activeTool();
      return !!t && !registry.familyOfTool(t.id) && !!shell.lastTool() && shell.flyout() === null;
    },
    run: () => {
      const last = shell.lastTool();
      if (last) shell.pickTool(last);
    },
  });

  for (const c of registry.cards) {
    for (const v of c.verbs) {
      if (!v.key) continue;
      out.push({
        ...base, group: 'Selection', kind: 'verb', id: `verb.${c.kind}.${v.id}`, combo: lower(v.key), label: v.label, card: c.kind, source: v.id,
        when: () => shell.flyout() === null && shell.card()?.kind === c.kind && (!v.when || v.when(useStore.getState())),
        run: () => v.run(useStore),
      });
    }
  }
  return out;
}

/** The hand-written chords the new shell keeps: everything but the old editor's tool keys. */
export function globalShortcuts(): Shortcut[] {
  return SHORTCUTS.filter((s) => !s.legacy);
}

export interface KeyCollision {
  combo: string;
  ids: string[];
  /** Where both are live: the tool in hand and the open flyout. */
  context: string;
}

/**
 * Every combo two keys answer at the same moment, for some tool in hand and some open
 * flyout. Rail and family keys and the hand-written chords are always live; a family's tool
 * keys while its flyout is open or, with no flyout, one of its tools is in hand; with no
 * flyout, a tool's dock keys while it is in hand, Previous tool under a rail tool and a
 * card's verb keys while that card shows. Hand-written chords sharing a combo are ordered on
 * purpose and are not reported, and the node editor's keys are its own for a session.
 */
export function keyCollisions(registry: Registry, keys: readonly RegistryShortcut[], globals: readonly Shortcut[] = globalShortcuts()): KeyCollision[] {
  const out: KeyCollision[] = [];
  const always = [
    ...globals.filter((s) => !s.alias && s.group !== 'Node editing'),
    ...keys.filter((k) => k.kind === 'rail' || k.kind === 'family'),
  ];
  const tools: (ToolDef | undefined)[] = [undefined, ...registry.tools];
  const flyouts: (FamilyDef['id'] | null)[] = [null, ...registry.families.map((f) => f.id)];
  for (const tool of tools) {
    const family = tool ? registry.familyOfTool(tool.id)?.id : undefined;
    const rail = !!tool && !family;
    const cards: (string | null)[] = rail && tool?.selectionPanel ? [null, ...registry.cards.map((c) => c.kind)] : [null];
    for (const flyout of flyouts) {
      const toolsOf = flyout ?? family;
      for (const card of cards) {
        const open = flyout === null;
        const live = [
          ...always,
          ...keys.filter((k) => k.kind === 'tool' && k.family === toolsOf),
          ...(open ? keys.filter((k) => k.kind === 'dock' && k.tool === tool?.id) : []),
          ...(open && rail ? keys.filter((k) => k.kind === 'previous') : []),
          ...(open ? keys.filter((k) => k.kind === 'verb' && k.card === card) : []),
        ];
        const byCombo = new Map<string, Shortcut[]>();
        for (const s of live) byCombo.set(s.combo, [...(byCombo.get(s.combo) ?? []), s]);
        for (const [combo, list] of byCombo) {
          const ids = [...new Set(list.map((s) => s.id))];
          if (ids.length < 2 || !list.some((s) => 'kind' in s)) continue;
          out.push({ combo, ids, context: `${tool?.id ?? 'no tool'}${flyout ? `, ${flyout} flyout` : ''}${card ? `, ${card} card` : ''}` });
        }
      }
    }
  }
  // One report per combo and set of ids.
  const seen = new Set<string>();
  return out.filter((c) => {
    const key = `${c.combo}|${[...c.ids].sort().join(',')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Keys on a reserved letter declared by anything but its owner. */
export function reservedViolations(keys: readonly RegistryShortcut[]): RegistryShortcut[] {
  return keys.filter((k) => {
    const reserved = RESERVED_KEYS[k.combo];
    return reserved !== undefined && !reserved.owners.includes(k.source);
  });
}

export interface SheetRow {
  id: string;
  label: string;
  keys: string[];
}

export interface SheetSection {
  title: string;
  rows: SheetRow[];
}

function rowsOf(list: readonly { id: string; label: string; combo: string; alias?: true }[], mac?: boolean): SheetRow[] {
  const byId = new Map<string, SheetRow>();
  for (const s of list) {
    if (s.alias) continue;
    const row = byId.get(s.id);
    const key = /click|drag/.test(s.combo) ? s.combo.replace('alt+', 'Alt ').replace(/^./, (c) => c.toUpperCase()) : formatCombo(s.combo, mac);
    if (row) {
      if (!row.keys.includes(key)) row.keys.push(key);
    } else byId.set(s.id, { id: s.id, label: s.label, keys: [key] });
  }
  return [...byId.values()];
}

/**
 * The shortcuts sheet's one table: the rail and the families, each family's tools and the
 * keys each tool answers in hand, Select's keys, then the hand-written chords by group.
 */
export function shortcutTable(registry: Registry, keys: readonly RegistryShortcut[], mac?: boolean): SheetSection[] {
  const of = (pred: (k: RegistryShortcut) => boolean) => keys.filter(pred);
  const sections: SheetSection[] = [{ title: 'Rail', rows: rowsOf(of((k) => k.kind === 'rail' || k.kind === 'family'), mac) }];
  for (const f of registry.families) {
    const rows = rowsOf(of((k) => k.kind === 'tool' && k.family === f.id), mac);
    for (const t of f.tools) {
      rows.push(
        ...rowsOf(of((k) => k.kind === 'dock' && k.tool === t.id), mac).map((r) => ({ ...r, id: r.id, label: `${t.label} · ${r.label}` })),
      );
    }
    sections.push({ title: f.label, rows });
  }
  const select = rowsOf(of((k) => k.kind === 'previous' || k.kind === 'verb'), mac);
  // A verb on several cards (Node mode) is one row.
  const verbs = new Map<string, SheetRow>();
  for (const r of select) {
    const known = verbs.get(r.label);
    if (!known) {
      verbs.set(r.label, r);
      continue;
    }
    for (const k of r.keys) if (!known.keys.includes(k)) known.keys.push(k);
  }
  sections.push({ title: 'Select', rows: [...verbs.values()] });
  const globals = globalShortcuts();
  for (const group of SHORTCUT_GROUPS) {
    const list = [...globals.filter((s) => s.group === group), ...POINTER_HINTS.filter((p) => p.group === group)];
    if (list.length > 0) sections.push({ title: group, rows: rowsOf(list, mac) });
  }
  return sections.filter((s) => s.rows.length > 0);
}
