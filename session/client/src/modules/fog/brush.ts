// P4 §2 — the fog brush, which is a *sub-mode* of the armed fog tool and not a tool of its own.
//
// That distinction is the whole design: Escape, the bottom-left indicator and "token and door
// input stand down" are guarantees `session/tools.ts` makes about an armed tool, and a second
// ToolId would have to earn all three again. What the brush changes is only what a click on an
// already-armed canvas means — a cell instead of a room — so it is one flag and one op living
// next to the panel that sets them.

import { create } from 'zustand';

/** Which way the brush paints. The other one is a modifier away (Alt) mid-stroke. */
export type BrushOp = 'reveal' | 'hide';

// ponytail: one cell, no size and no shape. A DM opening a doorway wants one cell and a DM
// opening half a hall drags; a size slider is a third control on the panel for the middle
// case, and the stroke machinery below already paints whatever set of cells it is handed.
// The upgrade, if a table asks for it, is a `size` here and a disc of cells in `paintTo` —
// nothing else changes.

interface BrushStore {
  on: boolean;
  op: BrushOp;
  setOn: (on: boolean) => void;
  setOp: (op: BrushOp) => void;
}

export const useFogBrush = create<BrushStore>()((set) => ({
  on: false,
  op: 'reveal',
  setOn: (on) => set({ on }),
  setOp: (op) => set({ op }),
}));

/**
 * How many cells a stroke gathers before it is sent, mid-drag.
 *
 * A stroke is one `region-set` per flush, and every flush is a fog write the whole table sees —
 * so the number trades "the players watch the reveal appear as I paint" against a burst of
 * broadcasts. Twelve cells is about a second of ordinary dragging at the pace a DM paints a
 * doorway, and the rest of the stroke always lands on pointerup however short it was.
 */
export const BRUSH_FLUSH_CELLS = 12;
