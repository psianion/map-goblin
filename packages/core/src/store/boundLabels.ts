import { useStore } from './store';
import type { DungeonLayer, Layer, LabelBinding, TextChild } from './types';
import { boundText, type BoundTarget } from '../shared/labelStyles';
import { measureLabel } from '../engine/labelMetrics';
import { resolveDoors, resolveWalls } from '../shared/wallResolve';

/**
 * Bound labels: a Room name or Number pin follows its room, a Door tag its door.
 *
 * The label keeps `position` as the stored truth (the bot, the table and hit testing read it)
 * and `offset` from the target's anchor. When the anchor moves, the label moves by the same
 * amount; when the label moves and the anchor did not, the offset takes the new place. Its text
 * follows the target's name or number. Core does this rather than the renderer, so every
 * surface that reads the document reads the same thing.
 */

/** One label's fields to bring in step, `undefined` values removing the key. */
export interface BoundLabelPatch {
  layerId: string;
  id: string;
  patch: Partial<TextChild>;
}

/** Where each followed target's anchor stood at the last sync, keyed `kind:id`. */
export type BoundAnchors = ReadonlyMap<string, readonly [number, number]>;

const keyOf = (b: LabelBinding): string => `${b.kind}:${b.id}`;
const isDungeon = (l: Layer): l is DungeonLayer => l.type === 'dungeon';
const same = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;
const EMPTY: BoundAnchors = new Map();

/** The targets on the map, keyed. `pending` holds rooms that exist but have no anchor yet. */
function targetsOf(layers: readonly Layer[], doors: boolean): { targets: Map<string, BoundTarget>; pending: Set<string> } {
  const targets = new Map<string, BoundTarget>();
  const pending = new Set<string>();
  for (const layer of layers) {
    if (!isDungeon(layer)) continue;
    for (const room of layer.rooms ?? []) {
      const key = `room:${room.id}`;
      // A room read from a file before its anchor is derived is still there; not a delete.
      if (!Array.isArray(room.anchor)) pending.add(key);
      else targets.set(key, { binding: { kind: 'room', id: room.id }, name: room.name, number: room.number, anchor: [room.anchor[0], room.anchor[1]] });
    }
    if (!doors || !layer.children.some((c) => c.childType === 'door')) continue;
    for (const r of resolveDoors(layer, resolveWalls(layer))) {
      targets.set(`door:${r.door.id}`, {
        binding: { kind: 'door', id: r.door.id },
        name: r.door.name,
        anchor: [r.position[0], r.position[1]],
      });
    }
  }
  return { targets, pending };
}

/**
 * The patches that bring every bound label in step with its target, and the anchors to pass
 * back next time. With `last` absent (the first sync) no anchor counts as moved, so a label's
 * own position wins. No bound label = no work.
 */
export function syncBoundLabels(
  state: { layers: readonly Layer[] },
  last?: BoundAnchors,
): { patches: BoundLabelPatch[]; anchors: BoundAnchors } {
  const bound: { layerId: string; child: TextChild & { bound: LabelBinding } }[] = [];
  for (const layer of state.layers) {
    if (!isDungeon(layer)) continue;
    for (const c of layer.children) {
      if (c.childType === 'text' && c.bound) bound.push({ layerId: layer.id, child: c as TextChild & { bound: LabelBinding } });
    }
  }
  if (bound.length === 0) return { patches: [], anchors: EMPTY };

  const { targets, pending } = targetsOf(state.layers, bound.some((b) => b.child.bound.kind === 'door'));
  const anchors = new Map<string, readonly [number, number]>();
  const patches: BoundLabelPatch[] = [];
  for (const { layerId, child } of bound) {
    const key = keyOf(child.bound);
    if (pending.has(key)) continue;
    const target = targets.get(key);
    // The target is gone: the label stays where it is, with the last text it had.
    if (!target) {
      patches.push({ layerId, id: child.id, patch: { bound: undefined, offset: undefined } });
      continue;
    }
    anchors.set(key, target.anchor);
    const [ax, ay] = target.anchor;
    const prev = last?.get(key);
    const moved = !!prev && (!same(prev[0], ax) || !same(prev[1], ay));
    const patch: Partial<TextChild> = {};
    const off = child.offset ?? [0, 0];
    if (moved) {
      const x = ax + off[0];
      const y = ay + off[1];
      if (!same(x, child.position.x) || !same(y, child.position.y)) patch.position = { x, y };
    } else {
      const ox = child.position.x - ax;
      const oy = child.position.y - ay;
      if (!child.offset || !same(ox, off[0]) || !same(oy, off[1])) patch.offset = [ox, oy];
    }
    const text = boundText(child.style, target);
    if (text !== child.text) {
      patch.text = text;
      Object.assign(patch, measureLabel(text, child.fontSize, child));
    }
    if (Object.keys(patch).length > 0) patches.push({ layerId, id: child.id, patch });
  }
  return { patches, anchors };
}

/** Writes the patches straight into the store: no undo entry, they follow what undo restores. */
export function applyBoundLabelPatches(patches: readonly BoundLabelPatch[]): void {
  if (patches.length === 0) return;
  useStore.setState((s) => {
    for (const p of patches) {
      const layer = s.layers.find((l) => l.id === p.layerId);
      if (!layer || !isDungeon(layer)) continue;
      const child = layer.children.find((c) => c.id === p.id) as unknown as Record<string, unknown> | undefined;
      if (!child) continue;
      for (const [k, v] of Object.entries(p.patch)) {
        if (v === undefined) delete child[k];
        else child[k] = v;
      }
    }
  });
}

/**
 * Keep bound labels in step with their rooms and doors for as long as the editor or the table
 * is mounted. Runs only when the layers change; returns the cleanup.
 */
export function installBoundLabelSync(): () => void {
  let last: BoundAnchors | undefined;
  let writing = false;
  const run = (state: { layers: readonly Layer[] }) => {
    if (writing) return;
    const { patches, anchors } = syncBoundLabels(state, last);
    last = anchors;
    if (patches.length === 0) return;
    writing = true;
    try {
      applyBoundLabelPatches(patches);
    } finally {
      writing = false;
    }
  };
  run(useStore.getState());
  return useStore.subscribe((state, prev) => {
    if (state.layers !== prev.layers) run(state);
  });
}
