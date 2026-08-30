import { useEffect, useState } from 'react';
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
  /** table-shell-redesign — the left sidebar frame (Prep/Journal content lives behind
   *  `session/sidebars.ts`'s registry). Persisted per-tab like the seat (`session/store.ts`'s
   *  `SEAT_KEY`), not server state. */
  sidebarOpen: boolean;
  /** FPS / frame-time in the status bar. Off by default; Shift+D. */
  diagnostics: boolean;
  openPanelById: (id: string) => void;
  togglePanel: (id: string) => void;
  closePanel: () => void;
  setDrawer: (open: boolean) => void;
  toggleDrawer: () => void;
  setSidebar: (open: boolean) => void;
  toggleSidebar: () => void;
  toggleDiagnostics: () => void;
}

const SIDEBAR_KEY = 'mg-sidebar-open';
function loadSidebarOpen(): boolean {
  try {
    return sessionStorage.getItem(SIDEBAR_KEY) === '1';
  } catch {
    return false; // storage unavailable — start closed, same fallback `session/store.ts` uses
  }
}
function saveSidebarOpen(open: boolean): void {
  try {
    sessionStorage.setItem(SIDEBAR_KEY, open ? '1' : '0');
  } catch {
    /* storage unavailable — the toggle just won't survive a refresh */
  }
}

/** Below this width the sidebar overlays the map with a scrim instead of insetting it — the
 *  breakpoint the approved mockup (`docs/mockups/table-shell-redesign-mockup.html`) uses. */
export const SIDEBAR_OVERLAY_QUERY = '(max-width: 900px)';

/** One-shot read for a non-component call site (`hotkeys.ts`'s Esc handler). */
export function isOverlayViewport(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.(SIDEBAR_OVERLAY_QUERY)?.matches;
}

/** Live version for anything that renders differently in overlay mode (`Sidebar`, and every
 *  bit of chrome that insets around it) — re-renders on resize/rotate. */
export function useOverlayMode(): boolean {
  const [narrow, setNarrow] = useState(isOverlayViewport);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(SIDEBAR_OVERLAY_QUERY);
    const onChange = () => setNarrow(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return narrow;
}

export const useShell = create<ShellStore>()((set, get) => ({
  openPanel: null,
  drawerOpen: false,
  sidebarOpen: loadSidebarOpen(),
  diagnostics: false,
  openPanelById: (id) => set({ openPanel: id }),
  togglePanel: (id) => set({ openPanel: get().openPanel === id ? null : id }),
  closePanel: () => set({ openPanel: null }),
  setDrawer: (open) => set({ drawerOpen: open }),
  toggleDrawer: () => set({ drawerOpen: !get().drawerOpen }),
  setSidebar: (open) => {
    saveSidebarOpen(open);
    set({ sidebarOpen: open });
  },
  toggleSidebar: () => {
    const open = !get().sidebarOpen;
    saveSidebarOpen(open);
    set({ sidebarOpen: open });
  },
  toggleDiagnostics: () => set({ diagnostics: !get().diagnostics }),
}));
