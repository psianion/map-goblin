// P4 §2 — the fog brush, which is a *sub-mode* of the armed fog tool and not a tool of its own.
//
// That distinction is the whole design: Escape, the bottom-left indicator and "token and door
// input stand down" are guarantees `session/tools.ts` makes about an armed tool, and a second
// ToolId would have to earn all three again. What the brush changes is only what a click on an
// already-armed canvas means — a cell instead of a room — so it is one flag and one op living
// next to the panel that sets them.

import { create } from 'zustand';
import { fogModeOf, regionOf, type FogState } from '@dnd/mechanics/fog';
import { useSessionStore } from '../../session/store';
import { useActiveTool } from '../../session/tools';
import { fogFrame, sceneFog } from './fog';

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

// ── Arming, as three plain functions (table-shell M3 item 2) ────────────────
// Not component methods: `FogTool`'s tool-row buttons and `shell/hotkeys.ts`'s R/H/B call
// these exact functions, so a keyboard press and a button click are the same act rather than
// two paths that can drift apart. A second press of the button/key that armed the current
// direction disarms instead — the old single-toggle's behaviour, now per-button. Plain
// functions rather than exports off `FogTool.tsx` for the same reason `useFogBrush` lives
// here and not there: a file `shell/hotkeys.ts` imports has to stay outside React's fast-
// refresh boundary, which a component file mixing JSX and helper exports is not.

function armedDetail(): { armed: boolean; brushOn: boolean; detail: string | null } {
  const { activeTool, toolDetail } = useActiveTool.getState();
  return { armed: activeTool === 'fog', brushOn: useFogBrush.getState().on, detail: toolDetail };
}

export function armFogReveal(): void {
  const { armed, brushOn, detail } = armedDetail();
  if (armed && !brushOn && detail === 'Reveal') {
    useActiveTool.getState().setActiveTool(null);
    return;
  }
  if (brushOn) useFogBrush.getState().setOn(false);
  useActiveTool.getState().setActiveTool('fog');
  useActiveTool.getState().setToolDetail('Reveal');
}

export function armFogHide(): void {
  const { armed, brushOn, detail } = armedDetail();
  if (armed && !brushOn && detail === 'Hide') {
    useActiveTool.getState().setActiveTool(null);
    return;
  }
  if (brushOn) useFogBrush.getState().setOn(false);
  useActiveTool.getState().setActiveTool('fog');
  useActiveTool.getState().setToolDetail('Hide');
}

/** The brush is a vision-mode sub-mode with cell memory (P4 §2) — unchanged by this pass. */
export function brushAvailable(): boolean {
  const { session, mapData } = useSessionStore.getState();
  const fog = sceneFog(session?.modules?.fog as FogState | undefined, session?.activeSceneId ?? null);
  if (fogModeOf(fog) !== 'vision') return false;
  const frame = fogFrame(mapData);
  return frame !== null && regionOf(frame) !== undefined;
}

export function armFogBrush(): void {
  if (!brushAvailable()) return;
  const { armed, brushOn } = armedDetail();
  if (armed && brushOn) {
    useActiveTool.getState().setActiveTool(null);
    useFogBrush.getState().setOn(false);
    return;
  }
  useActiveTool.getState().setActiveTool('fog');
  useFogBrush.getState().setOn(true);
}
