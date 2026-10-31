import { useMemo, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Copy, EyeOff, FlipHorizontal2, FlipVertical2, Lock, LockOpen, MoreHorizontal, RotateCw, Trash2 } from 'lucide-react';
import { useStore } from '@/store/store';
import { resolveSelection, isLockedObject } from '@dnd/core/src/store/selectionResolve';
import { cardActions, type CardAction } from './cardModels';
import { openCanvasMenuRef, type CanvasMenuPayload } from '@/components/canvas/canvasMenuRef';
import { runSelectionVerb } from '@/shortcuts/defaultShortcuts';
import { getChildBounds, getWallBounds } from '@dnd/core/src/engine/hitTest';
import './selection-actions.css';

/*
 * The selection card's action row (board S5, option B): the verbs the floating bar used
 * to carry, in one fixed place on every card. A verb that cannot act on the selection is
 * left out rather than greyed, so the row only ever offers what will do something.
 */

const BUTTONS: Record<CardAction, { label: string; key?: string; icon: ReactNode }> = {
  flipH: { label: 'Flip horizontal', key: 'Shift H', icon: <FlipHorizontal2 size={14} strokeWidth={1.75} /> },
  flipV: { label: 'Flip vertical', key: 'Shift V', icon: <FlipVertical2 size={14} strokeWidth={1.75} /> },
  rotate: { label: 'Rotate 90°', key: 'Shift R', icon: <RotateCw size={14} strokeWidth={1.75} /> },
  duplicate: { label: 'Duplicate', key: 'Ctrl D', icon: <Copy size={14} strokeWidth={1.75} /> },
  lock: { label: 'Lock', key: 'Ctrl Shift L', icon: <Lock size={14} strokeWidth={1.75} /> },
  unlock: { label: 'Unlock', key: 'Ctrl Shift L', icon: <LockOpen size={14} strokeWidth={1.75} /> },
  hide: { label: 'Hide', key: 'Ctrl Shift H', icon: <EyeOff size={14} strokeWidth={1.75} /> },
  delete: { label: 'Delete', key: 'Del', icon: <Trash2 size={14} strokeWidth={1.75} /> },
  more: { label: 'More', icon: <MoreHorizontal size={14} strokeWidth={1.75} /> },
};

/** The menu the canvas would open for the current selection, at a viewport point. */
function menuPayload(x: number, y: number): CanvasMenuPayload | null {
  const s = useStore.getState();
  const ids = s.selection.selectedIds;
  const sel = resolveSelection(s, ids);
  const first = sel.children[0]?.child;
  const wall = sel.walls[0]?.wall;
  const room = sel.rooms[0];
  const box = first ? getChildBounds(first) : wall ? getWallBounds(wall) : null;
  const world = box
    ? { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    : room
      ? { x: room.room.anchor[0], y: room.room.anchor[1] }
      : { x: 0, y: 0 };
  const total = sel.children.length + sel.walls.length + sel.rooms.length;
  if (total === 0) return null;
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

/** The action row under a card's title. Renders nothing when no verb applies. */
export function CardActions() {
  const ids = useStore((s) => s.selection.selectedIds);
  // Lock state and kinds of the members, by value, so a drag that moves them redraws nothing.
  const key = useStore(
    useShallow((s) => {
      const sel = resolveSelection(s, s.selection.selectedIds);
      return [
        ...sel.children.map(({ child }) => `${child.childType}:${isLockedObject(child) ? 1 : 0}`),
        ...sel.walls.map(({ wall }) => `wall:${isLockedObject(wall) ? 1 : 0}`),
        ...sel.rooms.map(() => 'room'),
      ];
    }),
  );
  const actions = useMemo(
    () => cardActions(resolveSelection(useStore.getState(), ids)),
    // `key` carries everything the row depends on besides the ids.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ids, key.join('|')],
  );
  if (actions.length === 0) return null;
  const button = (a: CardAction) => {
    const b = BUTTONS[a];
    return (
      <button
        key={a}
        type="button"
        className="v2-ib v2-ib--sm"
        aria-label={b.label}
        data-tip={b.label}
        data-tip-key={b.key}
        data-testid={`v2-sel-act-${a}`}
        onClick={(e) => {
          if (a === 'more') {
            const r = e.currentTarget.getBoundingClientRect();
            const payload = menuPayload(r.left, r.bottom + 4);
            if (payload) openCanvasMenuRef.current?.(payload);
            return;
          }
          runSelectionVerb(a);
        }}
      >
        {b.icon}
      </button>
    );
  };
  // Delete and More are pinned right on every card, so Delete is always second from the
  // right and never sits where another card has Flip H.
  const right = actions.filter((a) => PINNED_RIGHT.has(a));
  const left = actions.filter((a) => !PINNED_RIGHT.has(a));
  return (
    <div className="v2-sel__acts" role="toolbar" aria-label="Selection actions" data-testid="v2-sel-actions">
      {left.length > 0 && (
        <div className="v2-sel__actgroup" data-testid="v2-sel-acts-left">
          {left.map(button)}
        </div>
      )}
      <div className="v2-sel__actgroup v2-sel__actgroup--right" data-testid="v2-sel-acts-right">
        {right.map(button)}
      </div>
    </div>
  );
}

/** The verbs that sit at the row's right end, in this order. */
const PINNED_RIGHT = new Set<CardAction>(['delete', 'more']);

/** A locked object's card says so, under its action row (whose Unlock gets it back). */
export function LockedNote() {
  return (
    <p className="v2-sel__lockednote" data-testid="v2-sel-locked-note">
      Locked: unlock to edit
    </p>
  );
}

/** A card's fields, every one of them read-only while the object is locked. */
export function LockFields({ locked, children }: { locked: boolean; children: ReactNode }) {
  return (
    <fieldset className="v2-sel__lockset" disabled={locked} data-testid="v2-sel-lockset">
      {children}
    </fieldset>
  );
}
