import { useEffect } from 'react';
import type { Role } from '@dnd/core/src/shared/protocol';
import type { InitiativeState } from '@dnd/mechanics/initiative';
import { armFogBrush, armFogHide, armFogReveal } from '../modules/fog/brush';
import { useDoorSelection } from '../modules/doors/selection';
import { useTokenInteraction } from '../modules/tokens/drag';
import { panelsForRole } from '../session/panels';
import { useSessionStore } from '../session/store';
import { useActiveTool } from '../session/tools';
import { isOverlayViewport, useShell } from './shellStore';

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

/** `/` (M4, review finding 2): focuses whichever composer is actually on screen. The drawer's
 *  composer wins whenever the drawer is open — the roll bar unmounts itself in that case
 *  (`RollBar.tsx`), so a player who opened the drawer gets its `Composer`, not a hidden one.
 *  Otherwise a player's roll bar is always mounted (a synchronous DOM read); the DM has no
 *  roll bar at all — this opens the drawer first and focuses its composer once the drawer's
 *  own render has landed (`setDrawer` is a zustand `set`, not a synchronous DOM write, so the
 *  input does not exist yet on the same tick that opens it). */
function focusComposer(): void {
  const focusDrawerComposer = (): void => {
    document.querySelector<HTMLInputElement>('[data-testid="log-drawer"] [data-testid="manual-roll"]')?.focus();
  };
  if (useShell.getState().drawerOpen) {
    focusDrawerComposer();
    return;
  }
  if (useSessionStore.getState().you?.role === 'dm') {
    useShell.getState().setDrawer(true);
    requestAnimationFrame(focusDrawerComposer);
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
  // table-shell-redesign D1/D4 — freed from the (now-retired) triggers popover; both roles
  // get the sidebar, so this is unconditional, unlike the DM-only fog keys above.
  { key: 'g', run: () => useShell.getState().toggleSidebar() },
];

/** Esc order: close an open popover; else close an overlay-mode sidebar (table-shell-redesign
 *  — narrow viewport only, where the sidebar floats over the map behind a scrim and behaves
 *  like a modal); else close the drawer; else clear an on-map selection (door, then token);
 *  else disarm the active tool. One listener owns the whole thing (M3 review finding 12) —
 *  neither on-map menu keeps its own window Escape handler anymore, so a single press never
 *  does two of these at once (close the popover *and* drop the selection it was showing). The
 *  drawer sits between the popover and the selections (finding 18): it has its own `Escape`
 *  guarantee too (`Popover`'s dialog gets one; the drawer is not a dialog, so this listener is
 *  the only thing that closes it on Esc). An inset-mode sidebar is not modal — Esc leaves it
 *  open there, same as it leaves any other docked panel alone. */
function onEscape(): void {
  const shell = useShell.getState();
  if (shell.openPanel) {
    shell.closePanel();
    return;
  }
  if (shell.sidebarOpen && isOverlayViewport()) {
    shell.setSidebar(false);
    return;
  }
  if (shell.drawerOpen) {
    shell.setDrawer(false);
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

/**
 * Every key this shell answers to, per role, and who claims it. `onKeyDown` resolves a press
 * in this order — fixed binding first, then the role's panels in registry order — so a second
 * claim on a letter is not an error anywhere, it is simply never reached. That is how the Log
 * lost `L` to the Lights panel for a whole release: both registered it, Lights sorts first,
 * and nothing said a word. Exported for the collision test.
 */
export function keyClaims(role: Role): Map<string, string[]> {
  const claims = new Map<string, string[]>();
  const claim = (key: string, by: string): void => {
    if (!key) return;
    const k = key.toLowerCase();
    claims.set(k, [...(claims.get(k) ?? []), by]);
  };
  for (const b of BINDINGS) claim(b.shift ? `shift+${b.key}` : b.key, `shell:${b.key}`);
  for (const p of panelsForRole(role)) claim(p.key, `panel:${p.id}`);
  return claims;
}

/** Dev-time only: shout about a key two things claim, since the loser is silently dead. */
function assertNoKeyCollisions(): void {
  for (const role of ['dm', 'player'] as const) {
    for (const [key, by] of keyClaims(role)) {
      if (by.length > 1) {
        console.error(
          `[hotkeys] '${key}' is claimed by ${by.join(' and ')} for a ${role} — only ${by[0]} will ever run it.`,
        );
      }
    }
  }
}

/** One listener for the whole shell, mounted once from `GameTable`. */
export function useHotkeys(): void {
  useEffect(() => {
    if (import.meta.env.DEV) assertNoKeyCollisions();
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
