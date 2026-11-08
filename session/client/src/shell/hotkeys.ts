import { useEffect } from 'react';
import type { Role } from '@dnd/core/src/shared/protocol';
import type { InitiativeState } from '@dnd/mechanics/initiative';
import { armFogBrush, armFogHide, armFogReveal, useFogBrush } from '../modules/fog/brush';
import { useDoorSelection } from '../modules/doors/selection';
import { useInitiativeSelection } from '../modules/initiative/selection';
import { useLightSelection } from '../modules/lights/selection';
import { useTokenInteraction } from '../modules/tokens/drag';
import { useSessionStore } from '../session/store';
import { useActiveTool } from '../session/tools';
import { dockTabs } from './dock/registry';
import { findMyToken } from './findMyToken';
import { railToolsFor } from './rail/registry';
import { pickRailTool } from './rail/tools';
import { closeSheet, openSheetNow, toggleSheet } from './sheets/registry';
import { useTableShell } from './tableShell';

/** Keys belong to whoever is typing, not to the shell. Same guard as `cameraInput.ts`'s. */
const isTyping = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

const roleNow = (): Role | undefined => useSessionStore.getState().you?.role;

/** A fixed binding (board 9): not a rail tool or a dock tab, which come from their registries. */
export interface Binding {
  /** `e.key` lowercased, e.g. 'r', '/', '?'. */
  key: string;
  shift?: boolean;
  /** Roles it answers for. */
  roles: readonly Role[];
  /** Shortcuts sheet group and row. */
  group: string;
  label: string;
  run: () => void;
}

/** Next or previous turn: the DM, and only once the order is locked. */
function stepTurn(action: 'next' | 'previous'): void {
  const store = useSessionStore.getState();
  if (store.you?.role !== 'dm') return;
  const state = store.session?.modules.initiative as InitiativeState | undefined;
  if (state?.status !== 'running') return;
  store.sendCommand('initiative', action, {});
}

/** `/`: focus the roll field on screen; the DM's lives in the Dice tab, so it opens first. */
function focusRollField(): void {
  const focus = (): void => {
    document.querySelector<HTMLInputElement>('[data-testid="manual-roll"]')?.focus();
  };
  if (roleNow() === 'dm' && useTableShell.getState().dockTab !== 'dice') {
    useTableShell.getState().pickDockTab('dice');
    requestAnimationFrame(focus);
    return;
  }
  focus();
}

/** Shift+P: pause or resume the table through the `table` module, once the server has one. */
function togglePause(): void {
  const store = useSessionStore.getState();
  const table = store.session?.modules.table as { paused?: boolean } | undefined;
  if (!table) return;
  store.sendCommand('table', 'pause', { on: !table.paused });
}

const DM = ['dm'] as const;
const ALL = ['dm', 'player'] as const;

export const BINDINGS: readonly Binding[] = [
  { key: 'b', roles: DM, group: 'Dock', label: 'Fold or open the dock', run: () => useTableShell.getState().toggleDock() },
  { key: 'r', roles: DM, group: 'Fog', label: 'Reveal', run: armFogReveal },
  { key: 'h', roles: DM, group: 'Fog', label: 'Hide', run: armFogHide },
  {
    key: 'w',
    roles: DM,
    group: 'Fog',
    label: 'Brush',
    run: () => {
      useFogBrush.getState().setShape('stroke');
      armFogBrush();
    },
  },
  {
    key: 'r',
    shift: true,
    roles: DM,
    group: 'Fog',
    label: 'Rectangle',
    run: () => {
      useFogBrush.getState().setShape('box');
      armFogBrush();
    },
  },
  { key: 'n', roles: DM, group: 'Combat', label: 'Next turn', run: () => stepTurn('next') },
  { key: 'n', shift: true, roles: DM, group: 'Combat', label: 'Previous turn', run: () => stepTurn('previous') },
  { key: '/', roles: ALL, group: 'Dice', label: 'Type a roll', run: focusRollField },
  { key: 'p', shift: true, roles: DM, group: 'Table', label: 'Pause the table', run: togglePause },
  { key: 'f', roles: ALL, group: 'View', label: 'Find my token', run: () => void findMyToken() },
  { key: 'd', shift: true, roles: ALL, group: 'View', label: 'Diagnostics', run: () => useTableShell.getState().toggleDiagnostics() },
  { key: '?', roles: ALL, group: 'Help', label: 'Keyboard shortcuts', run: () => toggleSheet('shortcuts') },
];

/** Keys the camera answers itself (`renderer/cameraInput.ts`), listed for the sheet only. */
export const CAMERA_KEYS: readonly { key: string; label: string }[] = [
  { key: '+', label: 'Zoom in' },
  { key: '-', label: 'Zoom out' },
  { key: '0', label: 'Fit the map' },
];

/**
 * Esc, one step per press: the armed tool back to Select, then the on-map card, the sheet,
 * the dock body, and last the selection (door, light, token, combat row).
 */
export function onEscape(): void {
  // An armed tool goes first: Esc while drawing a fog rectangle means "stop drawing", not
  // "fold the dock I am drawing from".
  const tools = useActiveTool.getState();
  if (tools.activeTool) return tools.setActiveTool(null);
  const shell = useTableShell.getState();
  if (shell.card) return shell.closeCard();
  if (openSheetNow()) return closeSheet();
  if (shell.dockTab) return shell.foldDock();
  const doors = useDoorSelection.getState();
  if (doors.selectedId) return doors.select(null);
  const lights = useLightSelection.getState();
  if (lights.selectedId) return lights.select(null);
  const tokens = useTokenInteraction.getState();
  if (tokens.selectedId) return tokens.select(null);
  const combat = useInitiativeSelection.getState();
  if (combat.selectedKey) combat.select(null);
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.defaultPrevented) return;

  // Escape always gets through, focus in a text field included: "get me out of this".
  if (e.key === 'Escape') {
    e.preventDefault();
    onEscape();
    return;
  }

  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (isTyping(e.target)) return;

  const role = roleNow();
  if (!role) return;
  const key = e.key.toLowerCase();
  // `?` arrives with Shift held on most layouts; it is its own key here.
  const shift = e.shiftKey && key !== '?';

  const binding = BINDINGS.find((b) => b.key === key && !!b.shift === shift && b.roles.includes(role));
  if (binding) {
    e.preventDefault();
    binding.run();
    return;
  }
  if (shift) return; // every other Shift combination is reserved, not consumed

  const tool = railToolsFor(role).find((t) => t.key.toLowerCase() === key);
  if (tool) {
    e.preventDefault();
    pickRailTool(tool.id);
    return;
  }

  if (role === 'dm') {
    const tab = dockTabs().find((t) => t.key === key);
    if (tab) {
      e.preventDefault();
      useTableShell.getState().pickDockTab(tab.id);
    }
  }
}

/**
 * Every key this shell answers to for a role, and who claims it: the fixed bindings, then the
 * rail tools, then (DM) the dock tabs, then the camera's own keys. `onKeyDown` resolves a press
 * in that order, so a second claim on a key is simply never reached. Exported for the
 * collision test.
 */
export function keyClaims(role: Role): Map<string, string[]> {
  const claims = new Map<string, string[]>();
  const claim = (key: string, by: string): void => {
    const k = key.toLowerCase();
    claims.set(k, [...(claims.get(k) ?? []), by]);
  };
  for (const b of BINDINGS) if (b.roles.includes(role)) claim(b.shift ? `shift+${b.key}` : b.key, `shell:${b.label}`);
  for (const t of railToolsFor(role)) claim(t.key, `rail:${t.id}`);
  if (role === 'dm') for (const t of dockTabs()) claim(t.key, `dock:${t.id}`);
  for (const k of CAMERA_KEYS) claim(k.key, `camera:${k.label}`);
  return claims;
}

/** Dev-time only: shout about a key two things claim, since the loser is silently dead. */
function assertNoKeyCollisions(): void {
  for (const role of ['dm', 'player'] as const) {
    for (const [key, by] of keyClaims(role)) {
      if (by.length > 1) {
        console.error(`[hotkeys] '${key}' is claimed by ${by.join(' and ')} for a ${role}: only ${by[0]} will ever run it.`);
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
