import { useEffect } from 'react';
import type { InitiativeState } from '@dnd/mechanics/initiative';
import { armFogBrush, armFogHide, armFogReveal } from '../modules/fog/brush';
import { useDoorSelection } from '../modules/doors/selection';
import { useTokenInteraction } from '../modules/tokens/drag';
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

/** DM-only bindings (the fog tools): the fog module is never registered for a player, and
 *  its commands are refused server-side regardless, but a stray press should not arm a tool
 *  a player's shell has no chrome to show. */
const dmOnly = (run: () => void): void => {
  if (useSessionStore.getState().you?.role === 'dm') run();
};

/** Next turn — same guard the footer button uses (DM, and only once the order is locked). */
function nextTurn(): void {
  const store = useSessionStore.getState();
  if (store.you?.role !== 'dm') return;
  const state = store.session?.modules.initiative as InitiativeState | undefined;
  if (state?.status !== 'running') return;
  store.sendCommand('initiative', 'next', {});
}

/** `/` (M4): a player's roll bar is always mounted, so a focus is a synchronous DOM read; the
 *  DM has no roll bar — this opens the log drawer first and focuses its composer once the
 *  drawer's own render has landed (`setDrawer` is a zustand `set`, not a synchronous DOM
 *  write, so the input does not exist yet on the same tick that opens it). */
function focusComposer(): void {
  if (useSessionStore.getState().you?.role === 'dm') {
    useShell.getState().setDrawer(true);
    requestAnimationFrame(() => {
      document.querySelector<HTMLInputElement>('[data-testid="log-drawer"] [data-testid="manual-roll"]')?.focus();
    });
    return;
  }
  document.querySelector<HTMLInputElement>('[data-testid="roll-bar"] [data-testid="manual-roll"]')?.focus();
}

// Fixed bindings that are not a panel's own `PanelDef.key`. M (Me panel) needs none of these —
// it is a plain `PanelDef.key` and already flows through the generic lookup below.
const BINDINGS: Binding[] = [
  { key: 'd', shift: true, run: () => useShell.getState().toggleDiagnostics() },
  { key: 'r', run: () => dmOnly(armFogReveal) },
  { key: 'h', run: () => dmOnly(armFogHide) },
  { key: 'b', run: () => dmOnly(armFogBrush) },
  { key: 'n', run: nextTurn },
  { key: '/', run: focusComposer },
];

/** Esc order: close an open popover; else clear an on-map selection (door, then token); else
 *  disarm the active tool. One listener owns the whole thing (M3 review finding 12) — neither
 *  on-map menu keeps its own window Escape handler anymore, so a single press never does two
 *  of these at once (close the popover *and* drop the selection it was showing). */
function onEscape(): void {
  const shell = useShell.getState();
  if (shell.openPanel) {
    shell.closePanel();
    return;
  }
  const doors = useDoorSelection.getState();
  if (doors.selectedId) {
    doors.select(null);
    return;
  }
  const tokens = useTokenInteraction.getState();
  if (tokens.selectedId) {
    tokens.select(null);
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
