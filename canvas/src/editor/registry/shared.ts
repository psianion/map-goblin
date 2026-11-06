// Settings that are global in the core store and shared by many tools. Each is defined
// once here; a ToolDef lists the ones it shows by reference. None is saved in the tool
// settings prefs: snap keeps its own pref (src/io/snapPref.ts), the snap step is the map's
// (saved in the map file), and curve, erase and node mode last the session, as today.

import { GitCommitHorizontal, Spline } from 'lucide-react';
import { z } from 'zod';
import { resolveSelection } from '@dnd/core/src/store/selectionResolve';
import { defineSetting } from './define';

export const gridSnap = defineSetting<boolean>({
  id: 'grid.snap',
  label: 'Snap to grid',
  schema: z.boolean(),
  default: true,
  home: 'panel',
  control: 'switch',
  section: 'Placement',
  persist: false,
  bind: {
    read: (s) => s.grid.snapEnabled,
    write: (store, v) => store.getState().setSnapEnabled(v),
  },
});

type SnapDivision = 1 | 2 | 3 | 4 | 6 | 8;

export const gridSnapStep = defineSetting<SnapDivision>({
  id: 'grid.snapStep',
  label: 'Snap step',
  schema: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(6), z.literal(8)]),
  default: 2,
  home: 'panel',
  control: 'seg',
  section: 'Placement',
  // The seg offers the plan's three; the schema still takes all six the core allows, so a
  // map saved at thirds, sixths or eighths loads and reads back as it was.
  options: [
    { value: 1, label: '1' },
    { value: 2, label: '½' },
    { value: 4, label: '¼' },
  ],
  persist: false,
  bind: {
    read: (s) => s.grid.snapDivision,
    write: (store, v) => store.getState().setSnapDivision(v),
  },
});

export const editCurve = defineSetting<boolean>({
  id: 'edit.curve',
  label: 'Curve',
  schema: z.boolean(),
  default: false,
  home: 'dock',
  control: 'switch',
  icon: Spline,
  key: 'C',
  section: 'Edit',
  persist: false,
  bind: {
    read: (s) => s.tools.curveMode,
    write: (store, v) => store.getState().setCurveMode(v),
  },
});

export const editErase = defineSetting<boolean>({
  id: 'edit.erase',
  label: 'Erase mode',
  schema: z.boolean(),
  default: false,
  home: 'panel',
  control: 'switch',
  persist: false,
  bind: {
    read: (s) => s.tools.eraseMode,
    write: (store, v) => store.getState().setEraseMode(v),
  },
});

/**
 * Point editing on the picked floor outline or wall. On means one of the two is open;
 * turning it on opens the one picked floor or wall, and does nothing otherwise.
 */
export const editNodeMode = defineSetting<boolean>({
  id: 'edit.nodeMode',
  label: 'Node mode',
  schema: z.boolean(),
  default: false,
  home: 'dock',
  control: 'switch',
  icon: GitCommitHorizontal,
  key: 'N',
  section: 'Edit',
  persist: false,
  bind: {
    read: (s) => s.tools.shapeNodeEditId !== null || s.tools.nodeEditWallId !== null,
    write: (store, on) => {
      const state = store.getState();
      if (!on) {
        state.setShapeNodeEdit(null);
        state.setNodeEditWall(null);
        return;
      }
      const ids = state.selection.selectedIds;
      if (ids.length !== 1) return;
      const picked = resolveSelection(state, ids);
      const shape = picked.children.find(({ child }) => child.childType === 'shape');
      if (shape) state.setShapeNodeEdit(shape.child.id);
      else if (picked.walls[0]) state.setNodeEditWall(picked.walls[0].wall.id);
    },
  },
});

export const SHARED_SETTINGS = [gridSnap, gridSnapStep, editCurve, editErase, editNodeMode] as const;
