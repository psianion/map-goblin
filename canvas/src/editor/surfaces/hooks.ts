// What the surfaces read from the registry and the store: the tool in hand, its family,
// a setting's value, and the card for what is picked. Nothing here knows any one tool.

import { useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '@/store/store';
import { resolveSelection } from '@dnd/core/src/store/selectionResolve';
import { bindingOf, type CardDef, type EditorState, type FamilyDef, type ObjectKind, type Registry, type SettingDef, type ToolDef } from '@/editor/registry';
import { useRegistry } from '@/editor/shell/registryContext';
import { useShell } from '@/editor/shell/shellStore';

/**
 * The registry tool driving the core tool in hand, if any does. Where several tools share
 * one core tool (Stamp and Scatter), each says through `inHand` whether it is the one.
 */
export function toolForEngine(registry: Registry, engine: string, state: EditorState = useStore.getState()): ToolDef | undefined {
  return registry.tools.find((t) => t.engine.some((e) => e === engine) && (!t.inHand || t.inHand(state)));
}

/** Puts `tool` in hand: its first core tool, unless one of its core tools already is. */
export function pickTool(tool: ToolDef): void {
  const state = useStore.getState();
  if (!tool.engine.includes(state.tools.activeTool)) state.setActiveTool(tool.engine[0]);
  tool.onPick?.(useStore);
}

export function useActiveTool(): ToolDef | undefined {
  const { registry } = useRegistry();
  // The tool's id, so a store change that leaves the same tool in hand re-renders nothing.
  const id = useStore((s) => toolForEngine(registry, s.tools.activeTool, s)?.id);
  return id ? registry.toolById(id) : undefined;
}

/** The family tool the dock shows: the one in hand, else the last one held (under Select). */
export function useDockTool(): { tool: ToolDef | undefined; drawing: boolean } {
  const { registry } = useRegistry();
  const active = useActiveTool();
  const lastId = useShell((s) => s.lastToolId);
  if (active && registry.familyOfTool(active.id)) return { tool: active, drawing: true };
  return { tool: lastId ? registry.toolById(lastId) : undefined, drawing: false };
}

export function useSettingValue<T>(def: SettingDef<T>): T {
  return useStore((s) => bindingOf(def).read(s));
}

/** Reads any setting by id, for visibility rules. */
export function useSettingGetter(): (id: string) => unknown {
  const { registry } = useRegistry();
  // Re-render on any store change; visibility rules are cheap and few.
  useStore((s) => s.tools);
  return useCallback(
    (id: string) => {
      const def = registry.settingById(id);
      return def ? bindingOf(def).read(useStore.getState()) : undefined;
    },
    [registry],
  );
}

export interface CardTarget {
  card: CardDef;
  object: unknown;
  ids: string[];
  /** The layer the first picked object sits on. */
  layerName: string | null;
}

function cardTarget(registry: Registry, state: EditorState): { kind: ObjectKind; layer: string } | null {
  const ids = state.selection.selectedIds;
  if (ids.length === 0) return null;
  const sel = resolveSelection(state, ids);
  const kinds = Object.keys(sel.kinds) as ObjectKind[];
  if (kinds.length !== 1 || !registry.cardForKind(kinds[0])) return null;
  const kind = kinds[0];
  const first = sel.children[0] ?? sel.walls[0] ?? sel.rooms[0];
  return { kind, layer: first?.layer.name || 'Unnamed layer' };
}

/**
 * The card for the selection: one kind picked and a card registered for it. Mixed picks
 * get the Mixed card in the Select family; until then they show no card.
 */
export function useCardTarget(): CardTarget | null {
  const { registry } = useRegistry();
  const key = useStore((s) => {
    const t = cardTarget(registry, s);
    return t ? `${t.kind}|${t.layer}` : '';
  });
  const ids = useStore(useShallow((s) => s.selection.selectedIds));
  const object = useStore((s) => {
    if (!key) return null;
    const sel = resolveSelection(s, s.selection.selectedIds);
    return sel.children[0]?.child ?? sel.walls[0]?.wall ?? sel.rooms[0]?.room ?? null;
  });
  if (!key || !object) return null;
  const [kind, layerName] = key.split('|') as [ObjectKind, string];
  const card = registry.cardForKind(kind);
  return card ? { card, object, ids, layerName } : null;
}

/** The family that owns `tool`, if any. */
export function useFamilyOf(tool: ToolDef | undefined): FamilyDef | undefined {
  const { registry } = useRegistry();
  return tool ? registry.familyOfTool(tool.id) : undefined;
}
