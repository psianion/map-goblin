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

const TOOL_NAME: Record<ToolId, string> = { fog: 'Fog' };

/**
 * What the indicator calls the tool right now — its name, plus its sub-mode when it has one
 * ("Fog · Brush", P4 §2). A sub-mode changes what a click does as much as the tool does, so
 * the one piece of chrome that answers "what will this click do" has to say it.
 */
export const toolLabel = (tool: ToolId, detail: string | null = null): string =>
  detail ? `${TOOL_NAME[tool]} · ${detail}` : TOOL_NAME[tool];

interface ToolStore {
  activeTool: ToolId | null;
  /** The active tool's sub-mode, set by whoever owns it; cleared when the tool goes. */
  toolDetail: string | null;
  setActiveTool: (tool: ToolId | null) => void;
  setToolDetail: (detail: string | null) => void;
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
  toolDetail: null,
  setActiveTool: (activeTool) => {
    // The detail belongs to the tool that set it: leaving it behind would have the indicator
    // announce a sub-mode of a tool nobody is holding the next time one is armed.
    set({ activeTool, toolDetail: null });
    if (activeTool) armEscape();
    else disarmEscape();
  },
  setToolDetail: (toolDetail) => set({ toolDetail }),
}));

/** True while any tool owns the canvas — token and door input stand down (D11). */
export const isToolActive = (): boolean => useActiveTool.getState().activeTool !== null;
