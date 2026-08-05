// src/shortcuts/defaultShortcuts.ts
// Default keyboard shortcut bindings — file.save and file.load wired to save/load pipeline.

import { saveMap } from '@/io/saveLoad';
import { useStore } from '@/store/store';
import { undoManager } from '@/store/undoManager';
import { notify, notifyCoalesce } from '@/lib/toast';
import { AddChildCommand, RemoveChildCommand, CompositeCommand, UpdateChildCommand } from '@/store/commands';
import type { AnyChild, DungeonLayer } from '@/store/types';
import { selectLayerForChild } from '@/store/selectors';
import { noEditableLayerMessage } from '@dnd/core/src/engine/tools/layerGuard';
import { snapshotChild, transformChild } from '@dnd/core/src/engine/tools/childTransform';
import { translateTangents } from '@dnd/core/src/shared/bezier';
import { togglePopoverRef } from '@/components/toolbar/toolConstants';
import { zoomToFitRef } from '@/components/toolbar/zoomToFitRef';

/** Set by App.tsx so the shortcut system can trigger the file picker */
export const importImageRef: { current: (() => void) | null } = { current: null };

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
    const layer = selectLayerForChild(store, id);
    if (!layer) continue;
    if (layer.locked) return 'Layer is locked';
    if (!layer.visible) return 'Layer is hidden';
  }
  return null;
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

/** Selected children paired with their owning layer, in selection order. */
function selectedChildEntries(
  store: ReturnType<typeof useStore.getState>,
): { layer: DungeonLayer; child: AnyChild }[] {
  const out: { layer: DungeonLayer; child: AnyChild }[] = [];
  for (const id of store.selection.selectedIds) {
    const layer = selectLayerForChild(store, id);
    if (!layer) continue;
    const child = layer.children.find((c) => c.id === id);
    if (child) out.push({ layer, child });
  }
  return out;
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
  const cmds = selectedChildEntries(store)
    .map(({ layer, child }) => {
      const snap = snapshotChild(child);
      if (snap.kind === 'none') return null;
      const after = transformChild(snap, t);
      const before: Partial<AnyChild> = {};
      for (const key of Object.keys(after)) {
        (before as Record<string, unknown>)[key] = structuredClone(
          (child as unknown as Record<string, unknown>)[key],
        );
      }
      return new UpdateChildCommand('Nudge', layer.id, child.id, before, after);
    })
    .filter((c): c is UpdateChildCommand => c !== null);
  if (cmds.length === 0) return false;
  undoManager.execute(cmds.length === 1 ? cmds[0] : new CompositeCommand('Nudge', cmds));
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
  const cmds: UpdateChildCommand[] = [];
  for (const { layer, child } of selectedChildEntries(store)) {
    if (child.childType === 'asset') {
      const key = axis === 'h' ? 'flipX' : 'flipY';
      cmds.push(
        new UpdateChildCommand(label, layer.id, child.id, { [key]: child[key] } as Partial<AnyChild>, {
          [key]: !child[key],
        } as Partial<AnyChild>),
      );
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
      cmds.push(new UpdateChildCommand(label, layer.id, child.id, before, after));
    }
  }
  if (cmds.length === 0) return false;
  undoManager.execute(cmds.length === 1 ? cmds[0] : new CompositeCommand(label, cmds));
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
  const cmds: UpdateChildCommand[] = [];
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
    const before: Partial<AnyChild> = {};
    for (const key of Object.keys(after)) {
      (before as Record<string, unknown>)[key] = structuredClone(
        (child as unknown as Record<string, unknown>)[key],
      );
    }
    cmds.push(new UpdateChildCommand('Rotate 90°', layer.id, child.id, before, after));
  }
  if (cmds.length === 0) return false;
  undoManager.execute(cmds.length === 1 ? cmds[0] : new CompositeCommand('Rotate 90°', cmds));
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
  // N for note — T is terrain and X is the rough-mode toggle.
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
  x: () => {
    const s = useStore.getState();
    const next = !s.tools.roughMode;
    s.setRoughMode(next);
    notify.subtle(next ? 'Rough mode' : 'Smooth mode', { icon: 'tool' });
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
      notify.subtle('Nothing to undo', { icon: 'undo' });
      return;
    }
    undoManager.undo();
    notifyCoalesce('undo', 'Undo', { duration: 1500, icon: 'undo' });
  },
  'ctrl+shift+z': () => {
    if (!undoManager.canRedo()) {
      notify.subtle('Nothing to redo', { icon: 'redo' });
      return;
    }
    undoManager.redo();
    notifyCoalesce('redo', 'Redo', { duration: 1500, icon: 'redo' });
  },
  'ctrl+y': () => {
    if (!undoManager.canRedo()) {
      notify.subtle('Nothing to redo', { icon: 'redo' });
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

    // Region-based copy (Alt+drag legacy)
    if (store.selection.selectedRegion) {
      const region = store.selection.selectedRegion;
      const layer = store.layers.find(
        (l): l is DungeonLayer => l.id === store.ui.activeLayerId && l.type === 'dungeon',
      );
      if (layer) store.setRegionClipboard({ region, style: { ...layer.style } });
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
      const cmds = store.selection.clipboard.children.map((child) => {
        const newChild = structuredClone(child);
        newChild.id = crypto.randomUUID();
        newChild.name = `${child.name} (copy)`;
        if ('position' in newChild) {
          (newChild as AnyChild & { position: { x: number; y: number } }).position = {
            x: (newChild as AnyChild & { position: { x: number; y: number } }).position.x + 1,
            y: (newChild as AnyChild & { position: { x: number; y: number } }).position.y + 1,
          };
        } else if ('transform' in newChild && newChild.transform) {
          newChild.transform.translate = [
            newChild.transform.translate[0] + 1,
            newChild.transform.translate[1] + 1,
          ];
        } else if (newChild.childType === 'zone') {
          // Zones keep their position inside `shape` — without this a pasted
          // zone lands exactly on top of the original.
          newChild.shape = newChild.shape.kind === 'rect'
            ? { ...newChild.shape, x: newChild.shape.x + 1, y: newChild.shape.y + 1 }
            : {
                ...newChild.shape,
                position: { x: newChild.shape.position.x + 1, y: newChild.shape.position.y + 1 },
              };
        } else if ('contours' in newChild) {
          // Shapes and water carry their geometry in rings, not a position —
          // without this branch they pasted exactly on top of the original.
          newChild.contours = newChild.contours.map((ring) =>
            ring.map(([x, y]): [number, number] => [x + 1, y + 1]),
          );
          newChild.tangents = translateTangents(newChild.tangents, 1, 1);
        }
        return new AddChildCommand('Paste child', activeLayerId, newChild);
      });
      undoManager.execute(new CompositeCommand('Paste', cmds));
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
    const newIds: string[] = [];
    const cmds = selectedChildEntries(store).map(({ layer, child }) => {
      const copy = structuredClone(child);
      copy.id = crypto.randomUUID();
      copy.name = `${child.name} (copy)`;
      if ('position' in copy && !Array.isArray(copy.position)) {
        copy.position = { x: copy.position.x + 1, y: copy.position.y + 1 };
      } else if ('position' in copy && Array.isArray(copy.position)) {
        copy.position = [copy.position[0] + 1, copy.position[1] + 1];
      } else if ('transform' in copy && copy.transform) {
        copy.transform.translate = [copy.transform.translate[0] + 1, copy.transform.translate[1] + 1];
      } else if ('contours' in copy) {
        copy.contours = copy.contours.map((ring) =>
          ring.map(([x, y]): [number, number] => [x + 1, y + 1]),
        );
        copy.tangents = translateTangents(copy.tangents, 1, 1);
      }
      newIds.push(copy.id);
      return new AddChildCommand('Duplicate child', layer.id, copy);
    });
    if (cmds.length === 0) return false;
    undoManager.execute(cmds.length === 1 ? cmds[0] : new CompositeCommand('Duplicate', cmds));
    // Selection follows the copies, so Ctrl+D, drag, Ctrl+D chains work.
    store.setSelectedIds(newIds);
    notify.subtle(cmds.length === 1 ? 'Duplicated' : `Duplicated ${cmds.length} items`, { icon: 'copy' });
  },
  'shift+h': () => flipSelection('h'),
  'shift+v': () => flipSelection('v'),
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
    const modes: Array<'auto' | 'manual' | 'fullscreen'> = ['auto', 'manual', 'fullscreen'];
    const idx = modes.indexOf(state.ui.focusMode);
    const next = modes[(idx + 1) % 3];
    state.setFocusMode(next);
    const labels = { auto: 'Focus: Auto', manual: 'Focus: Manual', fullscreen: 'Focus: Fullscreen' };
    notify.subtle(labels[next], { icon: 'focus' });
  },
  'ctrl+shift+m': () => {
    const state = useStore.getState();
    state.togglePanel('left');
    notify.subtle(state.ui.leftPanelOpen ? 'Maps panel closed' : 'Maps panel opened', { icon: 'map' });
  },
  'ctrl+shift+n': () => {
    // Mirrors the maps panel "New Map" button (MapsSidePanel.handleNewMap).
    useStore
      .getState()
      .createNewMap()
      .then(() => notify.success('New map created'))
      .catch((err) => {
        console.error('[shortcuts] Failed to create map:', err);
        notify.error('Failed to create map');
      });
  },
  'ctrl+x': (): void | false => {
    const store = useStore.getState();
    if (store.tools.activeTool !== 'select') return false;

    // Object-based cut: copy then delete
    if (store.selection.selectedIds.length > 0) {
      const reason = blockedChildrenLayerReason(store, store.selection.selectedIds);
      if (reason) {
        notify.warning(reason);
        return;
      }

      // Copy first
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
      }

      // Delete selected
      const commands = store.selection.selectedIds.map((id) => {
        const layer = selectLayerForChild(store, id);
        return new RemoveChildCommand('Cut', layer?.id ?? '', id);
      });
      const cutCount = store.selection.selectedIds.length;
      undoManager.execute(new CompositeCommand('Cut', commands));
      notify.action(cutCount === 1 ? 'Cut 1 shape' : `Cut ${cutCount} shapes`, {
        label: 'Undo',
        onClick: () => undoManager.undo(),
        icon: 'scissors',
      });
      store.setSelectedIds([]);
      return;
    }

    // Region-based cut (Alt+drag legacy)
    if (store.selection.selectedRegion) {
      const region = store.selection.selectedRegion;
      const activeLayerId = store.ui.activeLayerId;
      const layer = store.layers.find(
        (l): l is DungeonLayer => l.id === activeLayerId && l.type === 'dungeon',
      );
      if (layer) {
        store.setRegionClipboard({ region, style: { ...layer.style } });
      }
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

    const delCount = store.selection.selectedIds.length;
    const delCmds = store.selection.selectedIds.map((id) => {
      const layer = selectLayerForChild(store, id);
      return new RemoveChildCommand('Delete', layer?.id ?? '', id);
    });
    undoManager.execute(new CompositeCommand('Delete selected', delCmds));
    notify.action(delCount === 1 ? 'Deleted 1 shape' : `Deleted ${delCount} shapes`, {
      label: 'Undo',
      onClick: () => undoManager.undo(),
      icon: 'trash',
    });
    store.setSelectedIds([]);
  },
  'backspace': (): void | false => {
    return toolKeyMap['delete']?.() ?? false;
  },
};

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
    { id: 'tool.wall',           keys: 'w',           category: 'Tools', label: 'Wall' },
    { id: 'tool.ruler',          keys: 'm',           category: 'Tools', label: 'Measure' },
    { id: 'tool.text',           keys: 'n',           category: 'Tools', label: 'Label' },
    { id: 'tool.door',           keys: 'd',           category: 'Tools', label: 'Door' },
    { id: 'tool.light',          keys: 'l',           category: 'Tools', label: 'Light' },
    { id: 'tool.zone',           keys: 'z',           category: 'Tools', label: 'Zone' },
    { id: 'mode.erase',          keys: 'e',           category: 'Tools', label: 'Toggle Erase' },
    { id: 'mode.rough',          keys: 'x',           category: 'Tools', label: 'Toggle Rough' },
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
    { id: 'edit.flipH',          keys: 'shift+h',     category: 'Edit',  label: 'Flip Horizontal' },
    { id: 'edit.flipV',          keys: 'shift+v',     category: 'Edit',  label: 'Flip Vertical' },
    { id: 'edit.nudge',          keys: 'ArrowLeft',   category: 'Edit',  label: 'Nudge 1 square (arrows)' },
    { id: 'edit.nudgeFine',      keys: 'shift+ArrowLeft', category: 'Edit', label: 'Nudge ¼ square' },
    { id: 'view.fitToContent',   keys: 'ctrl+0',      category: 'View',  label: 'Fit to Content' },
    { id: 'view.focusMode',      keys: '`',           category: 'View',  label: 'Cycle Focus Mode' },
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
