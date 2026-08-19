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

/**
 * What a drag lays down: a stroke stamps a disc of cells along the pointer's path (the
 * eraser), a box marquees a rectangle and writes it on release (the selection box). The
 * upgrade path the one-cell brush named, taken — `size` is the disc's diameter in cells,
 * and the stroke machinery in FogOverlay paints whatever set of cells it is handed.
 */
export type BrushShape = 'stroke' | 'box';

interface BrushStore {
  on: boolean;
  op: BrushOp;
  size: number;
  shape: BrushShape;
  setOn: (on: boolean) => void;
  setOp: (op: BrushOp) => void;
  setSize: (size: number) => void;
  setShape: (shape: BrushShape) => void;
}

export const useFogBrush = create<BrushStore>()((set) => ({
  on: false,
  op: 'reveal',
  size: 1,
  shape: 'stroke',
  setOn: (on) => set({ on }),
  setOp: (op) => set({ op }),
  setSize: (size) => set({ size: Math.max(1, Math.min(5, Math.round(size))) }),
  setShape: (shape) => set({ shape }),
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
