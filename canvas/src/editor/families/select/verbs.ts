// The selection verbs (plan 6.6): Flip H, Flip V, Rotate 90, Duplicate, Lock, Unlock, Hide,
// Delete and More, each shown only when it can act on what is picked (cardActions decides,
// as on the v2 card). Merge for two walls waits on wall joining (plan 8.5).

import {
  Copy,
  EyeOff,
  FlipHorizontal2,
  FlipVertical2,
  Lock,
  LockOpen,
  MoreHorizontal,
  RotateCw,
  Trash2,
} from 'lucide-react';
import { getChildBounds, getWallBounds } from '@dnd/core/src/engine/hitTest';
import { resolveSelection } from '@dnd/core/src/store/selectionResolve';
import type { MapBuilderStore } from '@/store/types';
import { openCanvasMenuRef, type CanvasMenuPayload } from '@/editor/canvasMenuRef';
import { runSelectionVerb, type SelectionVerb } from '@/shortcuts/defaultShortcuts';
import type { EditorState, Verb } from '@/editor/registry/types';
import { cardActions, type CardAction } from './cardModels';

function offers(state: EditorState, action: CardAction): boolean {
  const s = state as MapBuilderStore;
  return cardActions(resolveSelection(s, s.selection.selectedIds)).includes(action);
}

const verb = (id: SelectionVerb, label: string, icon: Verb['icon'], extra: Partial<Verb> = {}): Verb => ({
  id,
  label,
  icon,
  when: (s) => offers(s, id),
  run: () => runSelectionVerb(id),
  ...extra,
});

/** The canvas's own menu for what is picked, opened at a viewport point. */
export function selectionMenu(s: MapBuilderStore, x: number, y: number): CanvasMenuPayload | null {
  const sel = resolveSelection(s, s.selection.selectedIds);
  const first = sel.children[0]?.child;
  const wall = sel.walls[0]?.wall;
  const room = sel.rooms[0];
  const total = sel.children.length + sel.walls.length + sel.rooms.length;
  if (total === 0) return null;
  const box = first ? getChildBounds(first) : wall ? getWallBounds(wall) : null;
  const world = box
    ? { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    : room
      ? { x: room.room.anchor[0], y: room.room.anchor[1] }
      : { x: 0, y: 0 };
  const target: CanvasMenuPayload['target'] =
    sel.rooms.length === total
      ? { kind: 'room', roomId: room!.room.id, layerId: room!.layer.id }
      : total > 1
        ? { kind: 'multi', count: total }
        : wall
          ? { kind: 'wall', wallId: wall.id }
          : { kind: 'child', childId: first!.id };
  return { x, y, world, target };
}

/** More: the canvas menu, under the button that was pressed (it holds focus after the click). */
export const moreVerb: Verb = {
  id: 'more',
  label: 'More',
  icon: MoreHorizontal,
  bar: false,
  when: (s) => offers(s, 'more'),
  run: (store) => {
    const r = (document.activeElement as HTMLElement | null)?.getBoundingClientRect();
    const payload = selectionMenu(store.getState(), r?.left ?? 0, (r?.bottom ?? 0) + 4);
    if (payload) openCanvasMenuRef.current?.(payload);
  },
};

export const SELECTION_VERBS: readonly Verb[] = [
  verb('flipH', 'Flip horizontal', FlipHorizontal2),
  verb('flipV', 'Flip vertical', FlipVertical2, { bar: false }),
  verb('rotate', 'Rotate 90°', RotateCw),
  verb('duplicate', 'Duplicate', Copy),
  verb('lock', 'Lock', Lock),
  verb('unlock', 'Unlock', LockOpen),
  verb('hide', 'Hide', EyeOff, { bar: false }),
  moreVerb,
  verb('delete', 'Delete', Trash2, { danger: true }),
];
