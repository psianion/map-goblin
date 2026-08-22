import { useEffect } from 'react';
import { panelsForRole } from '../session/panels';
import { useSessionStore } from '../session/store';
import { useActiveTool } from '../session/tools';
import { useShell } from './shellStore';

/** Keys belong to whoever is typing, not to the shell. Same guard as `cameraInput.ts`'s. */
const isTyping = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

interface Binding {
  key: string;
  shift?: boolean;
  run: () => void;
}

// Fixed bindings that are not a panel's own `PanelDef.key`. N (next turn), / (focus the roll
// bar/composer), R/H/B (fog tools) and M (Me panel) are M3/M4 — add them here once their
// targets exist; this table is the whole point of keeping them out of the switch below.
const BINDINGS: Binding[] = [
  { key: 'd', shift: true, run: () => useShell.getState().toggleDiagnostics() },
];

/** Esc order: close an open popover first; only disarm the tool on a second press. */
function onEscape(): void {
  const shell = useShell.getState();
  if (shell.openPanel) {
    shell.closePanel();
    return;
  }
  useActiveTool.getState().setActiveTool(null);
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.defaultPrevented) return;

  // Escape always gets through — the old tool-escape guarantee had no typing guard either,
  // and "get me out of this" should work with focus sitting in a text field.
  if (e.key === 'Escape') {
    e.preventDefault();
    onEscape();
    return;
  }

  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (isTyping(e.target)) return;

  const key = e.key.toLowerCase();

  if (e.shiftKey) {
    const binding = BINDINGS.find((b) => b.shift && b.key === key);
    if (binding) {
      e.preventDefault();
      binding.run();
    }
    return; // every other Shift+letter combo is reserved, not consumed
  }

  const binding = BINDINGS.find((b) => !b.shift && b.key === key);
  if (binding) {
    e.preventDefault();
    binding.run();
    return;
  }

  const role = useSessionStore.getState().you?.role;
  const panel = panelsForRole(role).find((p) => p.key && p.key.toLowerCase() === key);
  if (panel) {
    e.preventDefault();
    if (panel.group === 'log') useShell.getState().toggleDrawer();
    else useShell.getState().togglePanel(panel.id);
  }
}

/** One listener for the whole shell, mounted once from `GameTable`. */
export function useHotkeys(): void {
  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
