import type { MapBuilderStore, ChildGroupInfo, DungeonLayer, AnyChild, LightChild, Layer, AssetCategory } from './types';

export const selectLayers = (s: MapBuilderStore): Layer[] => s.layers;
export const selectActiveLayerId = (s: MapBuilderStore): string => s.ui.activeLayerId;
export const selectSelectedIds = (s: MapBuilderStore): string[] => s.selection.selectedIds;
export const selectHoveredId = (s: MapBuilderStore): string | null => s.selection.hoveredId;

export function selectActiveLayer(state: MapBuilderStore): Layer | undefined {
  const { activeLayerId } = state.ui;
  return state.layers.find((l) => l.id === activeLayerId);
}

/**
 * Whether `layer` should render/be interactive right now — its own authored
 * `visible` flag, narrowed by solo. Solo never writes `layer.visible` (see
 * ui.ts's `toggleSoloLayer`): it is a render-only override, so every
 * consumer that used to read `layer.visible` alone for a rendering or
 * interaction gate must go through this instead, or a soloed map draws (or
 * lets you edit) layers the panel shows as hidden.
 */
export function isLayerEffectivelyVisible(state: MapBuilderStore, layer: Layer): boolean {
  const { solo } = state.ui;
  return layer.visible && (solo == null || layer.type === 'background' || layer.id === solo.layerId);
}

/**
 * Layer-panel child group expand state. Assets default collapsed (they're
 * the bulk decoration — hundreds per layer), every other type defaults
 * expanded; ui.childGroupOverrides stores per-group deviations.
 */
export function isChildGroupExpanded(state: MapBuilderStore, layerId: string, childType: string): boolean {
  const defaultExpanded = childType !== 'asset';
  const overridden = state.ui.childGroupOverrides.includes(`${layerId}:${childType}`);
  return defaultExpanded !== overridden;
}

/** Override key for a named child group — shares ui.childGroupOverrides with the type buckets. */
export function namedGroupKey(layerId: string, groupId: string): string {
  return `${layerId}:group:${groupId}`;
}

/**
 * Named child groups default COLLAPSED — the point of a folder is that it
 * puts its contents away — so here the override set means "expanded", the
 * inverse polarity of most type buckets (assets already work this way).
 */
export function isNamedGroupExpanded(state: MapBuilderStore, layerId: string, groupId: string): boolean {
  return state.ui.childGroupOverrides.includes(namedGroupKey(layerId, groupId));
}

export function selectAllLights(s: MapBuilderStore): LightChild[] {
  return s.layers
    .filter((l): l is DungeonLayer => l.type === 'dungeon')
    .flatMap((l) => l.children.filter((c): c is LightChild => c.childType === 'light'));
}

export function selectChildById(s: MapBuilderStore, childId: string): AnyChild | undefined {
  for (const layer of s.layers) {
    if (layer.type !== 'dungeon') continue;
    const child = layer.children.find((c) => c.id === childId);
    if (child) return child;
  }
  return undefined;
}

export function selectLayerForChild(s: MapBuilderStore, childId: string): DungeonLayer | undefined {
  for (const layer of s.layers) {
    if (layer.type !== 'dungeon') continue;
    if (layer.children.some((c) => c.id === childId)) return layer;
  }
  return undefined;
}

// ─── Child groups ─────────────────────────────────────────

/** Members of `groupId`, in children-array order (which is z-order). */
export function groupMembers(layer: DungeonLayer, groupId: string): AnyChild[] {
  return layer.children.filter((c) => c.groupId === groupId);
}

export function childGroupOf(layer: DungeonLayer, childId: string): ChildGroupInfo | null {
  const child = layer.children.find((c) => c.id === childId);
  if (!child?.groupId) return null;
  return layer.groups?.find((g) => g.id === child.groupId) ?? null;
}

/**
 * Pulls whole groups into a selection: any id that belongs to a group brings
 * its siblings along. `mergedOnly` expands merged groups only — that is the
 * Alt-click path, where a plain group's member is meant to be picked alone.
 * A merged group always expands, with or without the flag.
 */
export function expandIdsForGroups(
  state: MapBuilderStore,
  ids: string[],
  opts?: { mergedOnly?: boolean },
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push(id);
  };
  for (const id of ids) {
    const layer = selectLayerForChild(state, id);
    const group = layer ? childGroupOf(layer, id) : null;
    if (layer && group && (!opts?.mergedOnly || group.merged)) {
      for (const member of groupMembers(layer, group.id)) push(member.id);
    } else {
      push(id);
    }
  }
  return out;
}

export function selectMergedCategories(s: MapBuilderStore): AssetCategory[] {
  return s.assets.manifest?.categories ?? [];
}
