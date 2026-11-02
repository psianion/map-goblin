// Every path edit as one Command (one undo entry). Callers run `undoManager.execute()` on
// the result; null means there is no such path or nothing to change. Point edits replace
// the whole point list, and a run of the same edit on the same point (a drag, a wheel
// burst) folds into one entry through the undo manager's coalescing window.

import type { PathChild, PathPoint } from '../shared/types';
import type { Command, Layer } from './types';
import { AddChildCommand, UpdateChildCommand, createChildRemovalCommand } from './commands';
import { useStore } from './store';

/** The path fields an edit may write. Points go through the point edits below. */
export type PathPatch = Partial<Omit<PathChild, 'id' | 'childType' | 'points'>>;

function findPath(layers: readonly Layer[], id: string): { layerId: string; path: PathChild } | null {
  for (const layer of layers) {
    if (layer.type !== 'dungeon') continue;
    for (const c of layer.children) if (c.id === id && c.childType === 'path') return { layerId: layer.id, path: c };
  }
  return null;
}

const positive = (n: number | undefined): boolean => n === undefined || (Number.isFinite(n) && n > 0);

/** A drawn path onto `layerId`, as one entry. */
export function addPath(layerId: string, path: PathChild): Command {
  return new AddChildCommand('Draw path', layerId, path);
}

export function removePath(id: string): Command | null {
  const found = findPath(useStore.getState().layers, id);
  return found ? createChildRemovalCommand(found.layerId, id, 'Delete path') : null;
}

/**
 * One entry for an edit of path `id`'s own fields. `undefined` on a key removes it. A width
 * that is not a positive number is refused (null), as is an empty patch.
 */
export function setPathFields(id: string, patch: PathPatch, label = 'Edit path'): Command | null {
  const found = findPath(useStore.getState().layers, id);
  if (!found || Object.keys(patch).length === 0) return null;
  if ('width' in patch && (patch.width === undefined || !positive(patch.width))) return null;
  const before: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) before[key] = (found.path as unknown as Record<string, unknown>)[key];
  return new UpdateChildCommand(label, found.layerId, id, before as PathPatch, patch);
}

/** Before and after point lists for one path. Folds a following edit with the same key. */
class PathPointsCommand implements Command {
  readonly label: string;
  readonly coalesceKey: string;
  private readonly layerId: string;
  private readonly pathId: string;
  private readonly before: PathPoint[];
  private after: PathPoint[];

  constructor(label: string, coalesceKey: string, layerId: string, pathId: string, before: PathPoint[], after: PathPoint[]) {
    this.label = label;
    this.coalesceKey = coalesceKey;
    this.layerId = layerId;
    this.pathId = pathId;
    this.before = structuredClone(before);
    this.after = structuredClone(after);
  }

  execute(): void {
    useStore.getState().updateChild(this.layerId, this.pathId, { points: structuredClone(this.after) });
  }

  undo(): void {
    useStore.getState().updateChild(this.layerId, this.pathId, { points: structuredClone(this.before) });
  }

  merge(next: Command): boolean {
    if (!(next instanceof PathPointsCommand) || next.coalesceKey !== this.coalesceKey) return false;
    this.after = structuredClone(next.after);
    return true;
  }
}

/**
 * The shared shape of every point edit: `edit` gets a copy of the points and returns the new
 * list, or null to refuse. `key` names the edit for coalescing; edits that should never fold
 * (insert, remove) carry a unique one.
 */
function editPoints(
  id: string,
  label: string,
  key: string,
  edit: (points: PathPoint[]) => PathPoint[] | null,
): Command | null {
  const found = findPath(useStore.getState().layers, id);
  if (!found) return null;
  const before = found.path.points;
  const after = edit(structuredClone(before));
  if (!after) return null;
  return new PathPointsCommand(label, key, found.layerId, id, before, after);
}

const inRange = (points: PathPoint[], index: number) => Number.isInteger(index) && index >= 0 && index < points.length;
let uniqueEdit = 0;

/** Inserts `point` before `index` (`index` = length appends). */
export function insertPathPoint(id: string, index: number, point: PathPoint): Command | null {
  return editPoints(id, 'Add point', `path:${id}:insert:${++uniqueEdit}`, (points) => {
    if (!Number.isInteger(index) || index < 0 || index > points.length || !positive(point.width)) return null;
    points.splice(index, 0, structuredClone(point));
    return points;
  });
}

/** Removes the point at `index`. Refused when it would leave fewer than two. */
export function removePathPoint(id: string, index: number): Command | null {
  return editPoints(id, 'Remove point', `path:${id}:remove:${++uniqueEdit}`, (points) => {
    if (!inRange(points, index) || points.length <= 2) return null;
    points.splice(index, 1);
    return points;
  });
}

function editPoint(
  id: string,
  index: number,
  label: string,
  kind: string,
  edit: (point: PathPoint) => PathPoint | null,
): Command | null {
  return editPoints(id, label, `path:${id}:${kind}:${index}`, (points) => {
    if (!inRange(points, index)) return null;
    const next = edit(points[index]);
    if (!next) return null;
    points[index] = next;
    return points;
  });
}

export function movePathPoint(id: string, index: number, x: number, y: number): Command | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return editPoint(id, index, 'Move point', 'move', (p) => ({ ...p, x, y }));
}

/** `undefined` takes the point back to the widths around it. */
export function setPathPointWidth(id: string, index: number, width: number | undefined): Command | null {
  if (!positive(width)) return null;
  return editPoint(id, index, 'Point width', 'width', (p) => {
    const next = { ...p, width };
    if (width === undefined) delete next.width;
    return next;
  });
}

/** `undefined` takes the point back to the heights around it. */
export function setPathPointHeight(id: string, index: number, height: number | undefined): Command | null {
  if (height !== undefined && !Number.isFinite(height)) return null;
  return editPoint(id, index, 'Point height', 'height', (p) => {
    const next = { ...p, height };
    if (height === undefined) delete next.height;
    return next;
  });
}

/** Handles relative to the point; `null` = sharp corner, `undefined` = auto tangent. */
export function setPathPointHandles(id: string, index: number, handles: PathPoint['handles']): Command | null {
  return editPoint(id, index, 'Point handles', 'handles', (p) => {
    const next = { ...p, handles: handles && structuredClone(handles) };
    if (handles === undefined) delete next.handles;
    return next;
  });
}
