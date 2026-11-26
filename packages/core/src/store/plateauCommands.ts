// Plateau and crossing-rule edits as Commands (one undo entry each). Callers run
// `undoManager.execute()` on the result; null means there is no such target or nothing to
// change.

import type { CrossingKind, PlateauChild } from '../shared/types';
import type { Command, DungeonLayer, Layer, MapRules } from './types';
import { UpdateChildCommand } from './commands';
import { useStore } from './store';
import { wrapDirection } from '../shared/plateauShade';
import { withMouth } from '../engine/plateauRenderer';

/** The fields of a plateau the card edits. */
export type PlateauPatch = Partial<
  Pick<
    PlateauChild,
    'height' | 'edge' | 'edgeArt' | 'slopeWidth' | 'faceArt' | 'faceDir' | 'topArt' | 'borderWidth' | 'contourLines' | 'sightOverride' | 'crossingId' | 'entrances'
  >
>;

function findPlateau(layers: readonly Layer[], id: string): { layerId: string; child: PlateauChild } | null {
  for (const layer of layers) {
    if (layer.type !== 'dungeon') continue;
    for (const c of layer.children) {
      if (c.id === id && c.childType === 'plateau') return { layerId: layer.id, child: c };
    }
  }
  return null;
}

/**
 * One entry for the fields of plateau `id`. Heights are whole cells (rounded);
 * a slope or border width must be positive, a face or top texture named, a face direction is
 * kept to 0..360. `undefined` on a key removes it, back to its default. A change of cliff art, edge or
 * height works its cave mouths' hollows out again (`withMouth`): they follow its kit's pieces and
 * which way its cliff is walked.
 */
export function setPlateauFields(id: string, patch: PlateauPatch, label = 'Edit plateau'): Command | null {
  const found = findPlateau(useStore.getState().layers, id);
  if (!found || Object.keys(patch).length === 0) return null;
  const after: PlateauPatch = { ...patch };
  if (after.height !== undefined) {
    if (!Number.isFinite(after.height)) return null;
    after.height = Math.round(after.height);
  }
  if (after.slopeWidth !== undefined && !(Number.isFinite(after.slopeWidth) && after.slopeWidth > 0)) return null;
  if (after.borderWidth !== undefined && !(Number.isFinite(after.borderWidth) && after.borderWidth > 0)) return null;
  if (after.faceArt !== undefined && !after.faceArt) return null;
  if (after.topArt !== undefined && !after.topArt) return null;
  if (after.faceDir !== undefined) {
    if (!Number.isFinite(after.faceDir)) return null;
    after.faceDir = wrapDirection(after.faceDir);
  }
  const mouths = found.child.entrances;
  if (mouths?.length && ('edgeArt' in after || 'edge' in after || 'height' in after)) {
    const layer = useStore.getState().layers.find((l): l is DungeonLayer => l.id === found.layerId && l.type === 'dungeon')!;
    const next = { ...found.child, ...after } as PlateauChild;
    after.entrances = mouths.map((s) => withMouth(layer, next, s));
  }
  const before: Record<string, unknown> = {};
  for (const key of Object.keys(after)) before[key] = (found.child as unknown as Record<string, unknown>)[key];
  return new UpdateChildCommand(label, found.layerId, id, before as PlateauPatch, after);
}


/** The map's sight threshold and crossing kinds, before and after; replayed through `setMapRules`. */
class MapRulesCommand implements Command {
  readonly label: string;
  private readonly before: MapRules;
  private readonly after: MapRules;

  constructor(label: string, before: MapRules, after: MapRules) {
    this.label = label;
    this.before = structuredClone(before);
    this.after = structuredClone(after);
  }

  execute(): void {
    useStore.getState().setMapRules(structuredClone(this.after));
  }

  undo(): void {
    useStore.getState().setMapRules(structuredClone(this.before));
  }
}

/** The drop, in whole cells (at least 1), at which plateau tops hide from below. */
export function setSightDropCells(cells: number): Command | null {
  if (!Number.isFinite(cells)) return null;
  const next = Math.max(1, Math.round(cells));
  const now = useStore.getState().mapSettings.sightDropCells;
  if (next === now) return null;
  return new MapRulesCommand('Hide plateau tops', { sightDropCells: now }, { sightDropCells: next });
}

/**
 * The map's whole crossing list, replaced as one entry (add, rename, note, Impassable switch,
 * reorder and delete all come through here). Refused when two kinds share an id.
 */
export function setCrossingKinds(kinds: CrossingKind[], label = 'Crossing kinds'): Command | null {
  if (new Set(kinds.map((k) => k.id)).size !== kinds.length) return null;
  const now = useStore.getState().mapSettings.crossingKinds;
  return new MapRulesCommand(label, { crossingKinds: now }, { crossingKinds: kinds });
}
