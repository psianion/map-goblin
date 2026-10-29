// src/shortcuts/defaultShortcuts.ts
// Default keyboard shortcut bindings — file.save and file.load wired to save/load pipeline.

import { saveMap } from '@/io/saveLoad';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import { notify, notifyCoalesce } from '@/lib/toast';
import {
  CompositeCommand,
  createChildRemovalCommand,
  createSelectionRemovalCommand,
  type SelectionRemoval,
} from '@/store/commands';
import {
  createDuplicateCommand,
  createPropPatchCommand,
  createZOrderCommand,
  type PropPatch,
  type ZOrderOp,
} from '@dnd/core/src/store/propEdits';
import type { AnyChild, DungeonLayer } from '@/store/types';
import { conditionZoneId } from '@dnd/core/src/shared/prep';
import { selectLayerForChild, selectLayerForSelected, selectWallById } from '@/store/selectors';
import { noEditableLayerMessage } from '@dnd/core/src/engine/tools/layerGuard';
import { snapshotChild, transformChild } from '@dnd/core/src/engine/tools/childTransform';
import { openNewMapRef, togglePopoverRef } from '@/components/toolbar/toolConstants';
import { zoomToFitRef } from '@/components/toolbar/zoomToFitRef';
import { groupSelection, selectionGroup, ungroupSelection } from '@/canvas/groupActions';
import { getEditorDesk } from '@dnd/core/src/engine/editorDesk';
import { nextFocusMode, toggleLitPreview } from '@/v2/viewPrefs';

/** Set by App.tsx so the shortcut system can trigger the file picker */
export const importImageRef: { current: (() => void) | null } = { current: null };

/** The v2 editor (`/v2`): the only place the Props verbs (z-order, lock, replace) are offered. */
export const isV2Route = (): boolean => /^\/v2(\/|$)/.test(window.location.pathname);

/** Something is selected and every selected child is a prop (pack art or an imported image). */
function selectionIsAllProps(): boolean {
  const store = useStore.getState();
  const ids = store.selection.selectedIds;
  return (
    ids.length > 0 &&
    ids.every((id) => selectLayerForChild(store, id)?.children.find((c) => c.id === id)?.childType === 'asset')
  );
}

/** A locked prop: the canvas verbs pass over it; the layer panel and Unlock still reach it. */
function isLockedChild(store: ReturnType<typeof useStore.getState>, id: string): boolean {
  const child = selectLayerForChild(store, id)?.children.find((c) => c.id === id);
  return child?.childType === 'asset' && !!child.locked;
}

/** Said when a verb finds nothing but locked props to act on. */
const LOCKED_MESSAGE = 'Locked: unlock to edit';

/**
 * Delete/cut via the layers panel selection go through `selectLayerForChild`
 * rather than a canvas pointer that already sat on a resolved, editable
 * layer — so nothing had checked the OWNING layer's lock/visible state before
 * this. Blocks the whole batch on the first offender rather than filtering:
 * a delete that silently drops some of what was selected is more surprising
 * than one that refuses outright.
 */
function blockedChildrenLayerReason(store: ReturnType<typeof useStore.getState>, ids: string[]): string | null {
  for (const id of ids) {
    // A drawn wall, or a room, answers to its layer's lock the same way a child does.
    const layer =
      selectLayerForSelected(store, id) ??
      store.layers.find(
        (l): l is DungeonLayer => l.type === 'dungeon' && (l.rooms ?? []).some((r) => r.id === id),
      );
    if (!layer) continue;
    if (layer.locked) return 'Layer is locked';
    if (!layer.visible) return 'Layer is hidden';
  }
  return null;
}

const counted = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * The delete toast: "Deleted 1 shape" as it always read for children, with the walls
 * and the doors that went with them named when there are any.
 */
export function deletedMessage(r: Pick<SelectionRemoval, 'children' | 'walls' | 'doors' | 'rooms'>): string {
  const parts: string[] = [];
  const rooms = r.rooms ?? 0;
  if (r.children > 0 || (r.walls === 0 && r.doors === 0 && rooms === 0)) parts.push(counted(r.children, 'shape', 'shapes'));
  if (rooms > 0) parts.push(counted(rooms, 'room', 'rooms'));
  if (r.walls > 0) parts.push(counted(r.walls, 'wall', 'walls'));
  if (r.doors > 0) parts.push(counted(r.doors, 'door', 'doors'));
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  return `Deleted ${list}`;
}

/**
 * Selection-scoped shortcuts (duplicate, flip, nudge) only make sense with the
 * select tool active, something selected, and no node-edit session claiming
 * the keyboard — arrows while editing a wall's nodes must not shove the whole
 * shape around.
 */
function selectionShortcutsApply(store: ReturnType<typeof useStore.getState>): boolean {
  return (
    store.tools.activeTool === 'select' &&
    store.selection.selectedIds.length > 0 &&
    !store.tools.nodeEditWallId &&
    !store.tools.shapeNodeEditId
  );
}

/** Selected children paired with their owning layer, in selection order. Locked props sit out. */
function selectedChildEntries(
  store: ReturnType<typeof useStore.getState>,
): { layer: DungeonLayer; child: AnyChild }[] {
  const out: { layer: DungeonLayer; child: AnyChild }[] = [];
  for (const id of store.selection.selectedIds) {
    const layer = selectLayerForChild(store, id);
    if (!layer) continue;
    const child = layer.children.find((c) => c.id === id);
    if (child && !(child.childType === 'asset' && child.locked)) out.push({ layer, child });
  }
  return out;
}

/** The values `child` holds now for each key `after` writes, so undo restores exactly those. */
function beforeFor(child: AnyChild, after: Partial<AnyChild>): Partial<AnyChild> {
  const before: Partial<AnyChild> = {};
  for (const key of Object.keys(after)) {
    (before as Record<string, unknown>)[key] = structuredClone(
      (child as unknown as Record<string, unknown>)[key],
    );
  }
  return before;
}

/**
 * Move every selected child by (dx, dy) world squares as one undo entry.
 * Goes through childTransform so shapes bake their pending transform the same
 * way a gizmo drag does. Returns false when nothing was nudged, so the key
 * event can fall through to whoever wants arrows next.
 */
function nudgeSelection(dx: number, dy: number): void | false {
  const store = useStore.getState();
  if (!selectionShortcutsApply(store)) return false;
  const reason = blockedChildrenLayerReason(store, store.selection.selectedIds);
  if (reason) {
    notify.warning(reason);
    return;
  }
  const t = {
    translateX: dx, translateY: dy, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0, anchorY: 0,
  };
  const edits: PropPatch[] = [];
  for (const { layer, child } of selectedChildEntries(store)) {
    const snap = snapshotChild(child);
    if (snap.kind === 'none') continue;
    const after = transformChild(snap, t);
    edits.push({ layerId: layer.id, id: child.id, before: beforeFor(child, after), after });
  }
  if (edits.length === 0) return false;
  // Through the prop patch: the lights attached to a nudged prop come along.
  undoManager.execute(createPropPatchCommand('Nudge', edits));
}

/**
 * Flip selected children in place. Assets toggle flipX/flipY (the sprite
 * mirrors, bounds don't change); shapes and water mirror their rings about
 * their own bbox centre, order reversed so winding survives. Text and lights
 * have nothing to mirror and pass through unchanged.
 */
function flipSelection(axis: 'h' | 'v'): void | false {
  const store = useStore.getState();
  if (!selectionShortcutsApply(store)) return false;
  const reason = blockedChildrenLayerReason(store, store.selection.selectedIds);
  if (reason) {
    notify.warning(reason);
    return;
  }
  const label = axis === 'h' ? 'Flip horizontal' : 'Flip vertical';
  const edits: PropPatch[] = [];
  for (const { layer, child } of selectedChildEntries(store)) {
    if (child.childType === 'asset') {
      const key = axis === 'h' ? 'flipX' : 'flipY';
      edits.push({
        layerId: layer.id,
        id: child.id,
        before: { [key]: child[key] } as Partial<AnyChild>,
        after: { [key]: !child[key] } as Partial<AnyChild>,
      });
    } else if (child.childType === 'shape' || child.childType === 'water') {
      // Mirror the baked rings about the child's own centre.
      const snap = snapshotChild(child);
      if (snap.kind !== 'rings') continue;
      const pts = snap.contours.flat();
      if (pts.length === 0) continue;
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      const mirrorPt = ([x, y]: [number, number]): [number, number] =>
        axis === 'h' ? [2 * cx - x, y] : [x, 2 * cy - y];
      const mirrored = snap.contours.map((ring) => ring.map(mirrorPt).reverse());
      // Curve handles mirror with their ring — and because the ring's order is
      // reversed, each vertex's incoming edge becomes its outgoing one, so the
      // in/out pair swaps sides too.
      const mirroredTangents = snap.tangents?.map((rt, r) =>
        Array.from({ length: snap.contours[r]?.length ?? 0 }, (_, i) => {
          const vt = rt?.[i];
          return vt
            ? {
                ...(vt.tout ? { tin: mirrorPt(vt.tout) } : {}),
                ...(vt.tin ? { tout: mirrorPt(vt.tin) } : {}),
              }
            : null;
        }).reverse(),
      );
      // Only shapes carry an optional baked-in transform; snapshotChild folded
      // it into the rings above, so the patch must clear it on shapes only.
      const before = (child.childType === 'shape'
        ? { contours: structuredClone(child.contours), tangents: structuredClone(child.tangents), transform: child.transform }
        : { contours: structuredClone(child.contours), tangents: structuredClone(child.tangents) }) as Partial<AnyChild>;
      const after = (child.childType === 'shape'
        ? { contours: mirrored, tangents: mirroredTangents, transform: undefined }
        : { contours: mirrored, tangents: mirroredTangents }) as Partial<AnyChild>;
      edits.push({ layerId: layer.id, id: child.id, before, after });
    }
  }
  if (edits.length === 0) return false;
  // The lights attached to a flipped prop mirror with it.
  undoManager.execute(createPropPatchCommand(label, edits));
  notify.subtle(label, { icon: 'tool' });
}

/**
 * Rotate the selection a quarter turn clockwise, each child about its own
 * centre. Exported for the floating action bar — it has no key binding.
 */
export function rotateSelection90(): void | false {
  const store = useStore.getState();
  if (!selectionShortcutsApply(store)) return false;
  const reason = blockedChildrenLayerReason(store, store.selection.selectedIds);
  if (reason) {
    notify.warning(reason);
    return;
  }
  const edits: PropPatch[] = [];
  for (const { layer, child } of selectedChildEntries(store)) {
    const snap = snapshotChild(child);
    if (snap.kind === 'none' || snap.kind === 'radius') continue; // lights have no orientation
    let anchorX = 0;
    let anchorY = 0;
    if (snap.kind === 'rings') {
      const pts = snap.contours.flat();
      if (pts.length === 0) continue;
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      anchorX = (Math.min(...xs) + Math.max(...xs)) / 2;
      anchorY = (Math.min(...ys) + Math.max(...ys)) / 2;
    } else {
      anchorX = snap.position.x;
      anchorY = snap.position.y;
    }
    const after = transformChild(snap, {
      translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: Math.PI / 2, anchorX, anchorY,
    });
    edits.push({ layerId: layer.id, id: child.id, before: beforeFor(child, after), after });
  }
  if (edits.length === 0) return false;
  // The lights attached to a turned prop turn with it.
  undoManager.execute(createPropPatchCommand('Rotate 90°', edits));
}

/** Restack the selected children (array order is draw order), one undo entry. v2 only. */
function orderSelection(op: ZOrderOp): void | false {
  if (!isV2Route()) return false;
  const store = useStore.getState();
  if (!selectionShortcutsApply(store)) return false;
  const reason = blockedChildrenLayerReason(store, store.selection.selectedIds);
  if (reason) {
    notify.warning(reason);
    return;
  }
  const ids = selectedChildEntries(store).map(({ child }) => child.id);
  const cmd = ids.length > 0 ? createZOrderCommand(ids, op) : null;
  if (!cmd) return;
  undoManager.execute(cmd);
}

// Keyed by key-combo string (e.g. 'ctrl+s') to match what onKeyDown builds.
const toolKeyMap: Record<string, () => void | false> = {
  // Tool selection
  v: () => { useStore.getState().setActiveTool('select'); notify.subtle('Select', { icon: 'tool' }); },
  g: () => { useStore.getState().setActiveTool('pan'); notify.subtle('Pan', { icon: 'tool' }); },
  r: () => {
    const s = useStore.getState();
    if (s.tools.activeTool === 'rectangle') {
      togglePopoverRef.current?.();
    } else {
      s.setActiveTool('rectangle');
      notify.subtle('Rectangle', { icon: 'tool' });
    }
  },
  p: () => {
    const s = useStore.getState();
    if (s.tools.activeTool === 'polygon') {
      togglePopoverRef.current?.();
    } else {
      s.setActiveTool('polygon');
      notify.subtle('Polygon', { icon: 'tool' });
    }
  },
  h: () => {
    const s = useStore.getState();
    if (s.tools.activeTool === 'regularPolygon') {
      togglePopoverRef.current?.();
    } else {
      s.setActiveTool('regularPolygon');
      notify.subtle('Regular Polygon', { icon: 'tool' });
    }
  },
  a: () => {
    const s = useStore.getState();
    if (s.tools.activeTool === 'path') {
      togglePopoverRef.current?.();
    } else {
      s.setActiveTool('path');
      notify.subtle('Path', { icon: 'tool' });
    }
  },
  d: () => {
    const s = useStore.getState();
    if (s.tools.activeTool === 'door') {
      togglePopoverRef.current?.();
    } else {
      s.setActiveTool('door');
      notify.subtle('Door', { icon: 'tool' });
    }
  },
  w: () => {
    const s = useStore.getState();
    if (s.tools.activeTool === 'wall') {
      togglePopoverRef.current?.();
    } else {
      s.setActiveTool('wall');
      notify.subtle('Wall', { icon: 'tool' });
    }
  },
  l: () => {
    const s = useStore.getState();
    if (s.tools.activeTool === 'light') {
      togglePopoverRef.current?.();
    } else {
      s.setActiveTool('light');
      notify.subtle('Light', { icon: 'tool' });
    }
  },
  b: () => {
    const s = useStore.getState();
    if (s.tools.activeTool === 'scatterBrush') {
      togglePopoverRef.current?.();
    } else {
      s.setActiveTool('scatterBrush');
      notify.subtle('Props', { icon: 'tool' });
    }
  },
  t: () => {
    const s = useStore.getState();
    if (s.tools.activeTool === 'terrain') {
      togglePopoverRef.current?.();
    } else {
      s.setActiveTool('terrain');
      notify.subtle('Terrain Brush', { icon: 'tool' });
    }
  },
  u: () => {
    const s = useStore.getState();
    if (s.tools.activeTool === 'water') {
      togglePopoverRef.current?.();
    } else {
      s.setActiveTool('water');
      notify.subtle('Water', { icon: 'tool' });
    }
  },
  m: () => {
    // No popover: the ruler has nothing to configure.
    useStore.getState().setActiveTool('ruler');
    notify.subtle('Measure', { icon: 'tool' });
  },
  // N for note — T is terrain.
  n: () => {
    useStore.getState().setActiveTool('text');
    notify.subtle('Label', { icon: 'tool' });
  },
  z: () => {
    const s = useStore.getState();
    if (s.tools.activeTool === 'zone') {
      togglePopoverRef.current?.();
    } else {
      s.setActiveTool('zone');
      notify.subtle('Zone', { icon: 'tool' });
    }
  },
  // Mode toggles
  e: () => {
    const s = useStore.getState();
    const next = !s.tools.eraseMode;
    s.setEraseMode(next);
    notify.subtle(next ? 'Erase mode' : 'Draw mode', { icon: 'tool' });
  },
  c: () => {
    const s = useStore.getState();
    const next = !s.tools.curveMode;
    s.setCurveMode(next);
    notify.subtle(next ? 'Curve mode' : 'Straight mode', { icon: 'tool' });
  },
  // Undo / redo
  'ctrl+z': () => {
    if (!undoManager.canUndo()) {
      // Full-weight toast, not subtle: a quiet "nothing happened" here reads
      // as undo being broken, not as an empty history.
      notifyCoalesce('undo', 'Nothing to undo', { duration: 1500, icon: 'undo' });
      return;
    }
    undoManager.undo();
    notifyCoalesce('undo', 'Undo', { duration: 1500, icon: 'undo' });
  },
  'ctrl+shift+z': () => {
    if (!undoManager.canRedo()) {
      notifyCoalesce('redo', 'Nothing to redo', { duration: 1500, icon: 'redo' });
      return;
    }
    undoManager.redo();
    notifyCoalesce('redo', 'Redo', { duration: 1500, icon: 'redo' });
  },
  'ctrl+y': () => {
    if (!undoManager.canRedo()) {
      notifyCoalesce('redo', 'Nothing to redo', { duration: 1500, icon: 'redo' });
      return;
    }
    undoManager.redo();
    notifyCoalesce('redo', 'Redo', { duration: 1500, icon: 'redo' });
  },
  'ctrl+s': () => {
    saveMap().then((saved) => {
      if (saved) notify.success('Map saved');
    }).catch((err: unknown) => {
      console.error('[save] failed:', err);
      notify.error('Save failed — see console for details.');
    });
  },
  'ctrl+o': () => {
    import('@/io/saveLoad')
      .then(({ loadMap }) => {
        loadMap().catch((err: unknown) => {
          console.error('[load] failed:', err);
          notify.error('Open failed — see console for details.');
        });
      })
      .catch(() => {
        console.error('[load] could not import saveLoad module');
      });
  },
  'ctrl+c': (): void | false => {
    const store = useStore.getState();
    if (store.tools.activeTool !== 'select') return false;

    // Object-based copy: copy selected children
    if (store.selection.selectedIds.length > 0) {
      const children = store.selection.selectedIds
        .map((id) => {
          for (const layer of store.layers) {
            if (layer.type !== 'dungeon') continue;
            const child = layer.children.find((c) => c.id === id);
            if (child) return structuredClone(child);
          }
          return undefined;
        })
        .filter(Boolean);
      if (children.length > 0) {
        store.setClipboard({ children: children as AnyChild[] });
        notify.subtle(children.length === 1 ? 'Copied' : `Copied ${children.length} items`, { icon: 'copy' });
      }
      return;
    }
  },
  'ctrl+v': (): void | false => {
    const store = useStore.getState();

    // Object-based paste: duplicate children with new IDs
    if (store.selection.clipboard && store.selection.clipboard.children.length > 0) {
      const activeLayerId = store.ui.activeLayerId;
      // Same exists/dungeon/unlocked/visible check the canvas guards
      // pointerDown with — paste is a canvas-triggered mutation too, and had
      // none of it. Duplicated here rather than imported: the core helper's
      // notify channel and this file's @/lib/toast are wired separately.
      const activeLayer = store.layers.find(
        (l): l is DungeonLayer => l.id === activeLayerId && l.type === 'dungeon',
      );
      if (!activeLayer) {
        notify.warning(noEditableLayerMessage());
        return;
      }
      if (activeLayer.locked) {
        notify.warning('Layer is locked');
        return;
      }
      if (!activeLayer.visible) {
        notify.warning('Layer is hidden');
        return;
      }
      // The one duplicate path: copies offset one square, attached lights glued to the
      // copies, no copy left pointing at a group the layer does not have.
      const { command } = createDuplicateCommand(store.layers, [], {
        children: store.selection.clipboard.children,
        targetLayerId: activeLayerId,
        label: 'Paste',
      });
      if (!command) return;
      undoManager.execute(command);
      const count = store.selection.clipboard.children.length;
      notify.action(count === 1 ? 'Pasted 1 shape' : `Pasted ${count} shapes`, {
        label: 'Undo',
        onClick: () => undoManager.undo(),
        icon: 'paste',
      });
      return;
    }

    // Region-based paste not implemented in v2.0
    return false;
  },
  'ctrl+d': (): void | false => {
    const store = useStore.getState();
    if (!selectionShortcutsApply(store)) return false;
    const reason = blockedChildrenLayerReason(store, store.selection.selectedIds);
    if (reason) {
      notify.warning(reason);
      return;
    }
    // Duplicate into each child's own layer — unlike paste, which targets the
    // active layer — offset one square like paste so the copy is visible.
    const ids = selectedChildEntries(store).map(({ child }) => child.id);
    const { command, newIds } = createDuplicateCommand(store.layers, ids);
    if (!command) return false;
    undoManager.execute(command);
    // Selection follows the copies, so Ctrl+D, drag, Ctrl+D chains work.
    store.setSelectedIds(newIds);
    notify.subtle(newIds.length === 1 ? 'Duplicated' : `Duplicated ${newIds.length} items`, { icon: 'copy' });
  },
  // No canGroupSelection() gate: groupSelection warns with the specific reason
  // when it refuses, and a silently swallowed Ctrl+G is the bug.
  'ctrl+g': (): void => {
    // On v2 a group of props clicks as one by default (Group board); v1 keeps plain groups.
    groupSelection(isV2Route() && selectionIsAllProps());
  },
  'ctrl+shift+g': (): void | false => {
    if (!selectionGroup()) return false;
    ungroupSelection();
  },
  'shift+h': () => flipSelection('h'),
  'shift+v': () => flipSelection('v'),
  // Draw order. With Shift held the bracket keys arrive as braces on most layouts.
  'ctrl+]': () => orderSelection('forward'),
  'ctrl+[': () => orderSelection('backward'),
  'ctrl+shift+]': () => orderSelection('front'),
  'ctrl+shift+}': () => orderSelection('front'),
  'ctrl+shift+[': () => orderSelection('back'),
  'ctrl+shift+{': () => orderSelection('back'),
  'arrowleft': () => nudgeSelection(-1, 0),
  'arrowright': () => nudgeSelection(1, 0),
  'arrowup': () => nudgeSelection(0, -1),
  'arrowdown': () => nudgeSelection(0, 1),
  'shift+arrowleft': () => nudgeSelection(-0.25, 0),
  'shift+arrowright': () => nudgeSelection(0.25, 0),
  'shift+arrowup': () => nudgeSelection(0, -0.25),
  'shift+arrowdown': () => nudgeSelection(0, 0.25),
  'ctrl+i': () => {
    importImageRef.current?.();
  },
  'shift+?': () => {
    useStore.getState().showModal({ type: 'shortcutReference', props: {} });
  },
  '?': () => {
    // Fallback: some keyboards/layouts produce '?' as e.key without shift flag
    useStore.getState().showModal({ type: 'shortcutReference', props: {} });
  },
  'ctrl+0': () => {
    zoomToFitRef.current?.();
    notify.subtle('Zoom to fit', { icon: 'focus' });
  },
  '`': () => {
    const state = useStore.getState();
    const next = nextFocusMode(state.ui.focusMode);
    state.setFocusMode(next);
    const labels = { auto: 'Focus: Auto', manual: 'Focus: Manual', fullscreen: 'Focus: Fullscreen' };
    notify.subtle(labels[next], { icon: 'focus' });
  },
  // Only where the editor lies on a desk (v2): without one the view is always lit.
  i: (): void | false => {
    if (!getEditorDesk()) return false;
    notify.subtle(toggleLitPreview() ? 'Lit preview on' : 'Lit preview off', { icon: 'eye' });
  },
  // v1 only: the v2 editor has no maps side panel to toggle.
  'ctrl+shift+m': (): void | false => {
    if (getEditorDesk()) return false;
    const state = useStore.getState();
    state.togglePanel('left');
    notify.subtle(state.ui.leftPanelOpen ? 'Maps panel closed' : 'Maps panel opened', { icon: 'map' });
  },
  'ctrl+shift+n': () => {
    // On /v2 the route registers its own New map dialog here.
    if (openNewMapRef.current) {
      openNewMapRef.current();
      return;
    }
    // Opens the New map dialog — the same one the maps panel's "New Map" button opens,
    // mounted once in App.tsx off this modal state so the shortcut works with the panel
    // closed. Enter commits, so the fast path is still two keystrokes.
    useStore.getState().showModal({ type: 'newMap', props: { mode: 'create' } });
  },
  'ctrl+x': (): void | false => {
    const store = useStore.getState();
    if (store.tools.activeTool !== 'select') return false;

    // Object-based cut: copy then delete. The clipboard holds children only, so a drawn
    // wall in the selection stays where it is (Delete removes it); so does a locked prop.
    const cutIds = store.selection.selectedIds.filter(
      (id) => !selectWallById(store, id) && !isLockedChild(store, id),
    );
    if (cutIds.length === 0 && store.selection.selectedIds.length > 0) return;
    if (cutIds.length > 0) {
      const reason = blockedChildrenLayerReason(store, cutIds);
      if (reason) {
        notify.warning(reason);
        return;
      }

      // Copy first
      const children = cutIds
        .map((id) => {
          for (const layer of store.layers) {
            if (layer.type !== 'dungeon') continue;
            const child = layer.children.find((c) => c.id === id);
            if (child) return structuredClone(child);
          }
          return undefined;
        })
        .filter(Boolean);
      if (children.length > 0) {
        store.setClipboard({ children: children as AnyChild[] });
      }

      // Delete selected
      warnOrphanedTriggers(store, cutIds);
      const commands = cutIds.map((id) => {
        const layer = selectLayerForChild(store, id);
        return createChildRemovalCommand(layer?.id ?? '', id, 'Cut');
      });
      const cutCount = cutIds.length;
      undoManager.execute(new CompositeCommand('Cut', commands));
      notify.action(cutCount === 1 ? 'Cut 1 shape' : `Cut ${cutCount} shapes`, {
        label: 'Undo',
        onClick: () => undoManager.undo(),
        icon: 'scissors',
      });
      store.setSelectedIds([]);
      return;
    }

    // Region selection (Alt+drag legacy): cutting it just clears it
    if (store.selection.selectedRegion) {
      store.setSelectedRegion(null);
    }
  },
  'delete': (): void | false => {
    const store = useStore.getState();
    if (store.selection.selectedIds.length === 0) return false;

    const reason = blockedChildrenLayerReason(store, store.selection.selectedIds);
    if (reason) {
      notify.warning(reason);
      return;
    }

    // A locked prop stays; the rest of the selection goes.
    const ids = store.selection.selectedIds.filter((id) => !isLockedChild(store, id));
    if (ids.length === 0) {
      notify.warning(LOCKED_MESSAGE);
      return;
    }
    warnOrphanedTriggers(store, ids);
    // Drawn walls ride in the same selection; their doors go with them, in this one step.
    const removal = createSelectionRemovalCommand(ids, 'Delete', 'Delete selected');
    if (removal.command) {
      undoManager.execute(removal.command);
      notify.action(deletedMessage(removal), {
        label: 'Undo',
        onClick: () => undoManager.undo(),
        icon: 'trash',
      });
    }
    store.setSelectedIds([]);
  },
  'backspace': (): void | false => {
    return toolKeyMap['delete']?.() ?? false;
  },
};

/**
 * Triggers keyed to a removed zone become unreachable from every screen while
 * still riding along in saves/publishes — say so before the zone goes, since
 * prep edits sit outside the undo stack even though the zone itself comes
 * back on undo. ZoneTool's own delete path carries the same warning; this
 * covers the global Delete/Backspace/Cut shortcuts, which bypass the tool.
 */
function warnOrphanedTriggers(
  store: ReturnType<typeof useStore.getState>,
  removedIds: string[],
): void {
  const removed = new Set(removedIds);
  const orphaned = store.prep?.triggers.filter((t) => removed.has(conditionZoneId(t.when) ?? '')).length ?? 0;
  if (orphaned > 0) {
    notify.warning(
      `Zone deleted — ${orphaned} trigger${orphaned === 1 ? ' now references' : 's now reference'} nothing (undo restores the zone)`,
    );
  }
}

export interface ShortcutDefinition {
  id: string;
  keys: string;
  category: string;
  label: string;
}

export function createDefaultShortcuts(): ShortcutDefinition[] {
  return [
    { id: 'tool.select',         keys: 'v',           category: 'Tools', label: 'Select' },
    { id: 'tool.pan',            keys: 'g',           category: 'Tools', label: 'Pan' },
    { id: 'tool.rectangle',      keys: 'r',           category: 'Tools', label: 'Rectangle' },
    { id: 'tool.polygon',        keys: 'p',           category: 'Tools', label: 'Polygon' },
    { id: 'tool.regularPolygon', keys: 'h',           category: 'Tools', label: 'Regular Polygon' },
    { id: 'tool.path',           keys: 'a',           category: 'Tools', label: 'Path' },
    { id: 'tool.terrain',        keys: 't',           category: 'Tools', label: 'Terrain' },
    { id: 'tool.water',          keys: 'u',           category: 'Tools', label: 'Water' },
    { id: 'tool.wall',           keys: 'w',           category: 'Tools', label: 'Wall' },
    { id: 'tool.ruler',          keys: 'm',           category: 'Tools', label: 'Measure' },
    { id: 'tool.text',           keys: 'n',           category: 'Tools', label: 'Label' },
    { id: 'tool.door',           keys: 'd',           category: 'Tools', label: 'Door' },
    { id: 'tool.light',          keys: 'l',           category: 'Tools', label: 'Light' },
    { id: 'tool.scatterBrush',   keys: 'b',           category: 'Tools', label: 'Props' },
    { id: 'tool.propsMirror',    keys: 'f',           category: 'Tools', label: 'Mirror prop (Props tool)' },
    { id: 'tool.zone',           keys: 'z',           category: 'Tools', label: 'Zone' },
    { id: 'tool.room',           keys: 'o',           category: 'Tools', label: 'Room' },
    { id: 'mode.erase',          keys: 'e',           category: 'Tools', label: 'Toggle Erase' },
    { id: 'mode.curve',          keys: 'c',           category: 'Tools', label: 'Toggle Curve' },
    { id: 'edit.undo',           keys: 'ctrl+z',      category: 'Edit',  label: 'Undo' },
    { id: 'edit.redo',           keys: 'ctrl+y',      category: 'Edit',  label: 'Redo' },
    { id: 'edit.redoAlt',        keys: 'ctrl+shift+z', category: 'Edit', label: 'Redo (Alt)' },
    { id: 'edit.deleteAlt',      keys: 'Backspace',   category: 'Edit',  label: 'Delete (Alt)' },
    { id: 'file.save',           keys: 'ctrl+s',      category: 'File',  label: 'Save' },
    { id: 'file.load',           keys: 'ctrl+o',      category: 'File',  label: 'Open' },
    { id: 'file.export',         keys: 'ctrl+e',      category: 'File',  label: 'Export' }, // handler is in App.tsx (needs React state)
    { id: 'file.import',         keys: 'ctrl+i',      category: 'File',  label: 'Import Image' },
    { id: 'edit.copy',           keys: 'ctrl+c',      category: 'Edit',  label: 'Copy' },
    { id: 'edit.paste',          keys: 'ctrl+v',      category: 'Edit',  label: 'Paste' },
    { id: 'edit.cut',            keys: 'ctrl+x',      category: 'Edit',  label: 'Cut' },
    { id: 'edit.delete',         keys: 'Delete',      category: 'Edit',  label: 'Delete' },
    { id: 'edit.duplicate',      keys: 'ctrl+d',      category: 'Edit',  label: 'Duplicate' },
    { id: 'edit.group',          keys: 'ctrl+g',      category: 'Edit',  label: 'Group Selection' },
    { id: 'edit.ungroup',        keys: 'ctrl+shift+g', category: 'Edit', label: 'Ungroup' },
    { id: 'edit.flipH',          keys: 'shift+h',     category: 'Edit',  label: 'Flip Horizontal' },
    { id: 'edit.flipV',          keys: 'shift+v',     category: 'Edit',  label: 'Flip Vertical' },
    { id: 'edit.forward',        keys: 'ctrl+]',      category: 'Edit',  label: 'Bring Forward' },
    { id: 'edit.backward',       keys: 'ctrl+[',      category: 'Edit',  label: 'Send Backward' },
    { id: 'edit.front',          keys: 'ctrl+shift+]', category: 'Edit', label: 'Bring to Front' },
    { id: 'edit.back',           keys: 'ctrl+shift+[', category: 'Edit', label: 'Send to Back' },
    { id: 'edit.nudge',          keys: 'ArrowLeft',   category: 'Edit',  label: 'Nudge 1 square (arrows)' },
    { id: 'edit.nudgeFine',      keys: 'shift+ArrowLeft', category: 'Edit', label: 'Nudge ¼ square' },
    { id: 'view.fitToContent',   keys: 'ctrl+0',      category: 'View',  label: 'Fit to Content' },
    { id: 'view.focusMode',      keys: '`',           category: 'View',  label: 'Cycle Focus Mode' },
    { id: 'view.litPreview',     keys: 'i',           category: 'View',  label: 'Toggle Lit Preview' },
    { id: 'view.toggleMaps',     keys: 'ctrl+shift+m', category: 'View', label: 'Toggle Maps Panel' },
    { id: 'file.newMap',         keys: 'ctrl+shift+n', category: 'File', label: 'New Map' },
    { id: 'view.shortcuts',      keys: '?',           category: 'View',  label: 'Shortcut Reference' },
    // Layers panel — documentation-only, like file.export above: these live
    // as row-level keydown handling / dnd-kit sensors in the panel
    // components, not in toolKeyMap, so they're listed here purely for the
    // reference dialog.
    // L2: 'ArrowUp+ArrowDown' and 'enter+space' below used to be single
    // entries — formatKeyCombo only knows how to split on '+' and render a
    // chord ("press both at once"), which is wrong for keys that are
    // alternatives. Split into one entry per key instead.
    { id: 'layers.navigateDown', keys: 'ArrowDown',   category: 'Layers', label: 'Navigate Panel' },
    { id: 'layers.navigateUp',   keys: 'ArrowUp',      category: 'Layers', label: 'Navigate Panel' },
    { id: 'layers.select',       keys: 'enter',       category: 'Layers', label: 'Select' },
    { id: 'layers.rename',       keys: 'f2',           category: 'Layers', label: 'Rename (or double-click)' },
    { id: 'layers.toggleVisible', keys: 'space',       category: 'Layers', label: 'Show/Hide' },
    { id: 'layers.delete',       keys: 'Delete',       category: 'Layers', label: 'Delete' },
    { id: 'layers.solo',         keys: 'alt+click',    category: 'Layers', label: 'Solo Layer' },
    { id: 'layers.exitSolo',     keys: 'escape',       category: 'Layers', label: 'Exit Solo' },
    { id: 'layers.selectChildren', keys: 'ctrl+click', category: 'Layers', label: 'Select All Children' },
    { id: 'layers.rowMenu',      keys: 'shift+f10',    category: 'Layers', label: 'Row Menu' },
    { id: 'layers.reorderEnter', keys: 'enter',       category: 'Layers', label: 'Grab/Drop Reorder (on grip)' },
    { id: 'layers.reorderSpace', keys: 'space',       category: 'Layers', label: 'Grab/Drop Reorder (on grip)' },
  ];
}

/** Pass a key-combo string (e.g. 'ctrl+s'). Returns true if handled. */
export function handleShortcut(keyCombo: string): boolean {
  const handler = toolKeyMap[keyCombo];
  if (handler) {
    const result = handler();
    return result !== false;
  }
  return false;
}
