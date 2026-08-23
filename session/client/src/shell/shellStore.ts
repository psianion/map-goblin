import { create } from 'zustand';

/**
 * What the shell has open. One popover at a time, anchored to its rail icon; the log is a
 * drawer, not a popover, so it has its own flag and can sit open under a popover.
 *
 * ponytail: plain zustand like `tools.ts`. Nothing here is derived; panels read `openPanel`
 * and compare to their own id.
 */
export interface ShellStore {
  /** Panel id from the registry, or null when the map has the whole viewport. */
  openPanel: string | null;
  drawerOpen: boolean;
  /** FPS / frame-time in the status bar. Off by default; Shift+D. */
  diagnostics: boolean;
  openPanelById: (id: string) => void;
  togglePanel: (id: string) => void;
  closePanel: () => void;
  setDrawer: (open: boolean) => void;
  toggleDrawer: () => void;
  toggleDiagnostics: () => void;
}

export const useShell = create<ShellStore>()((set, get) => ({
  openPanel: null,
  drawerOpen: false,
  diagnostics: false,
  openPanelById: (id) => set({ openPanel: id }),
  togglePanel: (id) => set({ openPanel: get().openPanel === id ? null : id }),
  closePanel: () => set({ openPanel: null }),
  setDrawer: (open) => set({ drawerOpen: open }),
  toggleDrawer: () => set({ drawerOpen: !get().drawerOpen }),
  toggleDiagnostics: () => set({ diagnostics: !get().diagnostics }),
}));
