import type { Layer, SublayerVisibility } from '@/store/types';

/** What the layer sheet is open on: a layer, or the map-wide terrain paint. */
export type SheetTarget = Layer | 'terrain';

export type SheetSection = 'name' | 'opacity' | 'show' | 'edges' | 'terrain';

/** The groups the sheet shows, top to bottom. */
export function sheetSections(target: SheetTarget): SheetSection[] {
  if (target === 'terrain') return ['terrain'];
  const out: SheetSection[] = ['name', 'opacity'];
  if (showRows(target).length > 0) out.push('show');
  // Rooms live in the dock's Rooms tab and the rooms sheet, not here.
  if (target.type === 'dungeon') out.push('edges');
  return out;
}

const SHOW_LABELS: [keyof SublayerVisibility, string][] = [
  ['floor', 'Floor'],
  ['grid', 'Grid'],
  ['walls', 'Walls and doors'],
];

/** The sublayer switches a layer actually has; a layer without sublayers gets none. */
export function showRows(layer: Layer): { key: keyof SublayerVisibility; label: string }[] {
  const vis = 'sublayerVisibility' in layer ? (layer.sublayerVisibility as Partial<SublayerVisibility> | undefined) : undefined;
  if (!vis) return [];
  return SHOW_LABELS.filter(([key]) => typeof vis[key] === 'boolean').map(([key, label]) => ({ key, label }));
}

export type RenameOutcome = { kind: 'commit'; name: string } | { kind: 'unchanged' } | { kind: 'empty' };

/** A name is trimmed; blank is refused, the same name is a no-op. */
export function checkRename(draft: string, current: string): RenameOutcome {
  const name = draft.trim();
  if (!name) return { kind: 'empty' };
  if (name === current) return { kind: 'unchanged' };
  return { kind: 'commit', name };
}
