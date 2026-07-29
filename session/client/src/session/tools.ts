import { create } from 'zustand';

/**
 * Which canvas tool has the pointer. A tool is a *mode*, never a dialog (D11): activating
 * one changes what a click on the map means and says so in the shell, instead of covering
 * the map with a panel that has to be dismissed before play continues.
 *
 * ponytail: a union of one, not a tool registry. S4 adds tools by widening `ToolId` and
 * adding a label; the two things that must be shared — the indicator and Escape — are
 * already here, and nothing else about a tool is general enough to abstract yet.
 */
export type ToolId = 'fog';

export const TOOL_LABEL: Record<ToolId, string> = { fog: 'Fog' };

interface ToolStore {
  activeTool: ToolId | null;
  setActiveTool: (tool: ToolId | null) => void;
}

// Escape exits the active tool. It lives with the state rather than in a component so the
// guarantee cannot be forgotten by whoever adds the next tool: nothing has to be wired,
// and there is no mounted component the key depends on.
let detachEscape: (() => void) | null = null;

function armEscape(): void {
  if (detachEscape || typeof window === 'undefined') return;
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    useActiveTool.getState().setActiveTool(null);
  };
  window.addEventListener('keydown', onKeyDown);
  detachEscape = () => window.removeEventListener('keydown', onKeyDown);
}

function disarmEscape(): void {
  detachEscape?.();
  detachEscape = null;
}

export const useActiveTool = create<ToolStore>()((set) => ({
  activeTool: null,
  setActiveTool: (activeTool) => {
    set({ activeTool });
    if (activeTool) armEscape();
    else disarmEscape();
  },
}));

/** True while any tool owns the canvas — token and door input stand down (D11). */
export const isToolActive = (): boolean => useActiveTool.getState().activeTool !== null;
