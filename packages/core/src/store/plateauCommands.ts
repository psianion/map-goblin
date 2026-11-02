// Plateau, opening and crossing-rule edits as Commands (one undo entry each). Callers run
// `undoManager.execute()` on the result; null means there is no such target or nothing to
// change.

import type { CrossingKind, OpeningChild, ShapeChild } from '../shared/types';
import type { Command, Layer, MapRules } from './types';
import { AddChildCommand, UpdateChildCommand, createChildRemovalCommand } from './commands';
import { useStore } from './store';

/** The plateau fields a floor shape carries (`ShapeChild.height` and the rest). */
export type PlateauPatch = Partial<
  Pick<ShapeChild, 'height' | 'edge' | 'edgeArt' | 'slopeWidth' | 'contourLines' | 'sightOverride' | 'crossingId'>
>;

function findChild<T extends 'shape' | 'opening'>(
  layers: readonly Layer[],
  id: string,
  kind: T,
): { layerId: string; child: Extract<ShapeChild | OpeningChild, { childType: T }> } | null {
  for (const layer of layers) {
    if (layer.type !== 'dungeon') continue;
    for (const c of layer.children) {
      if (c.id === id && c.childType === kind) {
        return { layerId: layer.id, child: c as Extract<ShapeChild | OpeningChild, { childType: T }> };
      }
    }
  }
  return null;
}

/**
 * One entry for the plateau fields of floor shape `id`. Heights are whole cells (rounded);
 * a slope width must be positive. `undefined` on a key removes it, back to its default.
 */
export function setPlateauFields(id: string, patch: PlateauPatch, label = 'Edit plateau'): Command | null {
  const found = findChild(useStore.getState().layers, id, 'shape');
  if (!found || Object.keys(patch).length === 0) return null;
  const after: PlateauPatch = { ...patch };
  if (after.height !== undefined) {
    if (!Number.isFinite(after.height)) return null;
    after.height = Math.round(after.height);
  }
  if (after.slopeWidth !== undefined && !(Number.isFinite(after.slopeWidth) && after.slopeWidth > 0)) return null;
  const before: Record<string, unknown> = {};
  for (const key of Object.keys(after)) before[key] = (found.child as unknown as Record<string, unknown>)[key];
  return new UpdateChildCommand(label, found.layerId, id, before as PlateauPatch, after);
}

export function addOpening(layerId: string, opening: OpeningChild): Command {
  return new AddChildCommand(`Add ${opening.kind}`, layerId, opening);
}

export function removeOpening(id: string): Command | null {
  const found = findChild(useStore.getState().layers, id, 'opening');
  return found ? createChildRemovalCommand(found.layerId, id, `Delete ${found.child.kind}`) : null;
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
