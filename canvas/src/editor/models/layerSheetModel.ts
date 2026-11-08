import type { Layer, SublayerVisibility } from '@/store/types';

/** What the layer sheet is open on: a layer, or the map-wide terrain paint. */
export type SheetTarget = Layer | 'terrain';

export type SheetSection = 'name' | 'opacity' | 'show' | 'edges' | 'actions' | 'background' | 'terrain' | 'trace' | 'battlemap';

/**
 * A Battlemap layer: a dungeon layer holding imported pictures and nothing else (no floors,
 * walls, props, water or patches). Its sheet is about the picture.
 */
export function isBattlemapLayer(layer: Layer): boolean {
  return (
    layer.type === 'dungeon' &&
    layer.children.length > 0 &&
    layer.children.every((c) => c.childType === 'asset' && c.objectType === 'image') &&
    (layer.standaloneWalls?.length ?? 0) === 0 &&
    !layer.water &&
    (layer.materials?.length ?? 0) === 0
  );
}

/** The groups the sheet shows, top to bottom. */
export function sheetSections(target: SheetTarget): SheetSection[] {
  if (target === 'terrain') return ['terrain'];
  // A trace's sheet is frame 14's: its own rows, name and opacity among them.
  if (target.type === 'image') return ['trace'];
  // A Battlemap layer's: name, kind, the switches and opacity, the grid row, its picture.
  if (isBattlemapLayer(target)) return ['battlemap', 'show', 'actions'];
  const out: SheetSection[] = ['name'];
  // The background's colour and texture come before its opacity (board L5).
  if (target.type === 'background') out.push('background');
  out.push('opacity');
  if (showRows(target).length > 0) out.push('show');
  // Rooms live in the dock's Rooms tab and the rooms sheet, not here.
  if (target.type === 'dungeon') out.push('edges', 'actions');
  return out;
}

const SHOW_LABELS: [keyof SublayerVisibility, string][] = [
  ['floor', 'Floor'],
  ['grid', 'Grid'],
  ['walls', 'Walls and doors'],
  ['labels', 'Labels'],
  ['zones', 'Zones'],
];

/** Rows a layer saved before them never stored; absent reads as shown. */
const OPTIONAL_ROWS = new Set<keyof SublayerVisibility>(['labels', 'zones']);

/** The sublayer switches a layer actually has; a layer without sublayers gets none. */
export function showRows(layer: Layer): { key: keyof SublayerVisibility; label: string }[] {
  const vis = 'sublayerVisibility' in layer ? (layer.sublayerVisibility as Partial<SublayerVisibility> | undefined) : undefined;
  if (!vis) return [];
  // A Battlemap layer has no floor, walls, labels or zones to hide: only its grid.
  const battlemap = isBattlemapLayer(layer);
  return SHOW_LABELS.filter(([key]) => (typeof vis[key] === 'boolean' || OPTIONAL_ROWS.has(key)) && (!battlemap || key === 'grid')).map(
    ([key, label]) => ({ key, label }),
  );
}

/** Whether a show row is on: absent optional rows are. */
export function rowShown(vis: Partial<SublayerVisibility>, key: keyof SublayerVisibility): boolean {
  return vis[key] !== false;
}

export type RenameOutcome = { kind: 'commit'; name: string } | { kind: 'unchanged' } | { kind: 'empty' };

/** A name is trimmed; blank is refused, the same name is a no-op. */
export function checkRename(draft: string, current: string): RenameOutcome {
  const name = draft.trim();
  if (!name) return { kind: 'empty' };
  if (name === current) return { kind: 'unchanged' };
  return { kind: 'commit', name };
}

/**
 * The layers the grid popover's Grid lines colour goes to: the active layer, whose floor grid
 * draws in it, and every layer on the same level holding a picture, whose grid over the
 * picture draws in its own layer's colour (a battlemap's layer is not the active one once it
 * is lined up, so without this the swatch would change nothing over the picture). Active
 * layer first; none when the active layer is not a dungeon layer.
 */
export function gridColourLayerIds(layers: readonly Layer[], active: Layer | null): string[] {
  if (!active || active.type !== 'dungeon') return [];
  const holdsPicture = (l: Layer) => l.type === 'dungeon' && l.children.some((c) => c.childType === 'asset' && c.objectType === 'image');
  const others = layers.filter((l) => l.id !== active.id && l.levelId === active.levelId && holdsPicture(l)).map((l) => l.id);
  return [active.id, ...others];
}
