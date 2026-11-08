import { create } from 'zustand';
import { DOCK_TAB_ORDER, type DockTabId } from './dock/registry';

/**
 * What the new chrome has open: the dock tab (null while the dock sits folded to its tab
 * row) and the on-map card. Sheets have their own store (`sheets/registry.ts`).
 */
export interface TableShell {
  dockTab: DockTabId | null;
  /** The tab B opens again after folding. */
  lastDockTab: DockTabId;
  /** The on-map card that is up (door, light, room key, token), by id; null for none. */
  card: string | null;
  /** View → Diagnostics (Shift+D): frame rate and round trip. Off by default. */
  diagnostics: boolean;
  /** Picking the open tab again folds the dock (board 1). */
  pickDockTab: (id: DockTabId) => void;
  foldDock: () => void;
  /** B: fold an open dock, or open it on the last tab. */
  toggleDock: () => void;
  openCard: (id: string) => void;
  closeCard: () => void;
  toggleDiagnostics: () => void;
}

export const useTableShell = create<TableShell>()((set, get) => ({
  dockTab: null,
  lastDockTab: DOCK_TAB_ORDER[0],
  card: null,
  diagnostics: false,
  pickDockTab: (id) => set(get().dockTab === id ? { dockTab: null } : { dockTab: id, lastDockTab: id }),
  foldDock: () => set({ dockTab: null }),
  toggleDock: () => set({ dockTab: get().dockTab ? null : get().lastDockTab }),
  openCard: (card) => set({ card }),
  closeCard: () => set({ card: null }),
  toggleDiagnostics: () => set({ diagnostics: !get().diagnostics }),
}));
