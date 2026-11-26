// What the surfaces read from the registry and the store: the tool in hand, its family,
// a setting's value, and the card for what is picked. Nothing here knows any one tool.

import { useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStoreWithEqualityFn } from 'zustand/traditional';
import { useStore } from '@/store/store';
import { entrancePick, resolveSelection, stairsPick } from '@dnd/core/src/store/selectionResolve';
import { soleRoomTarget } from '@/editor/models/selectionModel';
import { bindingOf, type CardDef, type EditorState, type FamilyDef, type ObjectKind, type Registry, type SettingDef, type ToolDef } from '@/editor/registry';
import { useRegistry } from '@/editor/shell/registryContext';
import { useShell, type ShellSheet } from '@/editor/shell/shellStore';

/**
 * The registry tool driving the core tool in hand, if any does. Where several tools share
 * one core tool (Stamp and Scatter), each says through `inHand` whether it is the one.
 */
export function toolForEngine(registry: Registry, engine: string, state: EditorState = useStore.getState()): ToolDef | undefined {
  return registry.tools.find((t) => t.engine.some((e) => e === engine) && (!t.inHand || t.inHand(state)));
}

/**
 * The tool in hand as the shell shows it: an entry whose sheet is open (Sky) stands in for the
 * core tool it holds (shell/sheetHold.ts), else the registry tool driving the core tool.
 */
export function toolInHand(registry: Registry, state: EditorState = useStore.getState(), sheet: ShellSheet = useShell.getState().sheet): ToolDef | undefined {
  const entry = typeof sheet === 'string' ? registry.tools.find((t) => t.sheet === sheet) : undefined;
  return entry ?? toolForEngine(registry, state.tools.activeTool, state);
}

/**
 * Puts `tool` in hand: its first core tool, unless one of its core tools already is. An entry
 * with a sheet (Sky) opens it instead; the sheet holds the tool in hand until it closes. A pick
 * while it is open closes it first, handing the held tool back, then takes the new one.
 */
export function pickTool(tool: ToolDef): void {
  if (tool.sheet) {
    useShell.getState().openSheet(tool.sheet);
    return;
  }
  if (useShell.getState().held !== null) {
    useShell.getState().closeSheet();
    // This is a pick, not the held tool coming back.
    useShell.setState({ spaceReturn: null });
  }
  const state = useStore.getState();
  if (!tool.engine.includes(state.tools.activeTool)) state.setActiveTool(tool.engine[0]);
  tool.onPick?.(useStore);
}

export function useActiveTool(): ToolDef | undefined {
  const { registry } = useRegistry();
  const sheet = useShell((s) => s.sheet);
  // The tool's id, so a store change that leaves the same tool in hand re-renders nothing.
  const id = useStore((s) => toolInHand(registry, s, sheet)?.id);
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

/** Plain data compared by value: settings hold numbers, strings, lists and small records. */
export function sameValue(a: unknown, b: unknown): boolean {
  return Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b);
}

/**
 * A setting's value. A binding may build its value afresh on every read (a list, a record);
 * one equal by value to the last counts as no change, so the control never re-renders
 * without end.
 */
export function useSettingValue<T>(def: SettingDef<T>): T {
  return useStoreWithEqualityFn(useStore, (s) => bindingOf(def).read(s), sameValue);
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
  // An area (the rooms list's group header) or a level (Level settings) is picked by its id; a
  // flight of stairs or a cave mouth by its own (`stairsSelectionId`, `entranceSelectionId`).
  if (kinds.length === 0) {
    const stairs = ids.length === 1 ? stairsPick(state, ids[0]) : null;
    if (stairs && registry.cardForKind('stairs')) return { kind: 'stairs', layer: stairs.layer.name || 'Unnamed layer' };
    const mouth = ids.length === 1 ? entrancePick(state, ids[0]) : null;
    if (mouth && registry.cardForKind('entrance')) return { kind: 'entrance', layer: mouth.layer.name || 'Unnamed layer' };
    const scope = soleRoomTarget(state, ids);
    if (scope && scope.kind !== 'room' && registry.cardForKind(scope.kind)) {
      return { kind: scope.kind, layer: scope.kind === 'area' ? scope.layer.name || 'Unnamed layer' : '' };
    }
    return null;
  }
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
    const scope = soleRoomTarget(s, s.selection.selectedIds);
    const own = scope?.kind === 'area' ? scope.area : scope?.kind === 'level' ? scope.level : (stairsPick(s, s.selection.selectedIds[0] ?? '')?.span ?? entrancePick(s, s.selection.selectedIds[0] ?? '')?.span ?? null);
    return sel.children[0]?.child ?? sel.walls[0]?.wall ?? sel.rooms[0]?.room ?? own;
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
