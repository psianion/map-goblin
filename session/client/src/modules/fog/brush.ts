// The fog brush: the one fog tool. Armed, a drag on the map clears fog for the players or
// paints it back, on the level the DM is showing. Arming is the `fog` tool of
// `session/tools.ts`, so Escape, the armed label and "token and door input stand down" come
// with it; what the brush adds is which way it paints and how wide.

import { create } from 'zustand';
import { useStore } from '@dnd/core/src/store/store';
import { shownLevelId } from '@dnd/core/src/store/selectors';
import type { FogBrushOp } from '@dnd/mechanics/fog';
import { useActiveTool } from '../../session/tools';

interface BrushStore {
  /** Which way a stroke paints. Alt held at the start of a stroke paints the other way. */
  op: FogBrushOp;
  /** The disc's diameter, in cells, 1 to 5. */
  size: number;
  setOp: (op: FogBrushOp) => void;
  setSize: (size: number) => void;
}

export const useFogBrush = create<BrushStore>()((set) => ({
  op: 'clear',
  size: 3,
  setOp: (op) => set({ op }),
  setSize: (size) => set({ size: Math.max(1, Math.min(5, Math.round(size))) }),
}));

/**
 * How many cells a stroke gathers before it is sent, mid-drag, per cell of brush size. Each
 * flush is a fog write the whole table sees, so this trades "the players watch the ground open
 * as I paint" against a burst of broadcasts. The rest of a stroke lands on pointerup.
 */
export const BRUSH_FLUSH_CELLS = 12;

/** The armed tool's detail for each way the brush paints; the armed label reads it. */
export const BRUSH_DETAIL: Record<FogBrushOp, string> = { clear: 'Clear', fog: 'Fog' };

/** Whether the brush is armed to paint `op`. */
export const brushArmed = (op?: FogBrushOp): boolean => {
  const { activeTool } = useActiveTool.getState();
  return activeTool === 'fog' && (op === undefined || useFogBrush.getState().op === op);
};

/** Arm the brush on `op`, whatever was armed before. */
export function armBrush(op: FogBrushOp): void {
  useFogBrush.getState().setOp(op);
  useActiveTool.getState().setActiveTool('fog');
  useActiveTool.getState().setToolDetail(BRUSH_DETAIL[op]);
}

/** W, Shift+W and the two brush cards: arm `op`, or put the brush down if it already is. */
export function toggleBrush(op: FogBrushOp): void {
  if (brushArmed(op)) {
    useActiveTool.getState().setActiveTool(null);
    return;
  }
  armBrush(op);
}

/**
 * The level a stroke writes to: the one the DM is showing. The table installs the DM's viewed
 * level (`dmLevelId`, else the scene's start level, else the first) as core's shown level, and
 * a map stored without levels has the one level the server names `level-1`.
 */
export function brushLevelId(): string {
  return shownLevelId(useStore.getState()) || 'level-1';
}
