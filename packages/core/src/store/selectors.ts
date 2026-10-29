import type { MapBuilderStore, ChildGroupInfo, DungeonLayer, AnyChild, LightChild, Layer, AssetCategory, WallSegment } from './types';

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

/**
 * A drawn wall the selection may hold by id, with its layer. Walls live in
 * `standaloneWalls`, not `children`, so the child lookups above never find them.
 */
export function selectWallById(
  s: MapBuilderStore,
  wallId: string,
): { wall: WallSegment; layer: DungeonLayer } | undefined {
  for (const layer of s.layers) {
    if (layer.type !== 'dungeon') continue;
    const wall = (layer.standaloneWalls ?? []).find((w) => w.id === wallId);
    if (wall) return { wall, layer };
  }
  return undefined;
}

/** The layer owning a selected id, child or drawn wall. */
export function selectLayerForSelected(s: MapBuilderStore, id: string): DungeonLayer | undefined {
  return selectLayerForChild(s, id) ?? selectWallById(s, id)?.layer;
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

/**
 * The level the map is showing: `ui.activeLevelId` when it names a level, else the first. The
 * editor's level picker sets it; the table sets it to the seat's viewed level. '' on a map
 * with no levels.
 */
export function shownLevelId(state: Pick<MapBuilderStore, 'levels' | 'ui'>): string {
  const levels = state.levels ?? [];
  return levels.some((l) => l.id === state.ui.activeLevelId) ? state.ui.activeLevelId : (levels[0]?.id ?? '');
}

/** Whether `layer` belongs to the shown level. A layer naming no known level is on the first; background is on all. */
export function isOnShownLevel(state: Pick<MapBuilderStore, 'levels' | 'ui'>, layer: Layer): boolean {
  const levels = state.levels ?? [];
  if (levels.length <= 1 || layer.type === 'background') return true;
  const own = levels.some((l) => l.id === layer.levelId) ? layer.levelId : levels[0]!.id;
  return own === shownLevelId(state);
}

/**
 * Whether `layer` is drawn right now: effectively visible (its flag, narrowed by solo) and on
 * the shown level. Layers of other levels are hidden from the scene graph, their lights,
 * walls, props and shadows from the lighting pass.
 */
export function isLayerShown(state: MapBuilderStore, layer: Layer): boolean {
  return isLayerEffectivelyVisible(state, layer) && isOnShownLevel(state, layer);
}
