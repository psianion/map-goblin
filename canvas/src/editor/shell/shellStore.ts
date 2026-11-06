// The shell's own view state: which family's flyout is open, the last family tool in hand
// (the dock keeps its columns while Select is up), and which right sheet is showing.
// Never part of the map; nothing here is saved.

import { create } from 'zustand';
import type { FamilyDef } from '@/editor/registry';

export type ShellSheet =
  | 'layers'
  | 'packs'
  | 'shortcuts'
  | 'sky'
  | 'prep'
  | { kind: 'layer'; target: string }
  | null;

interface ShellState {
  flyout: FamilyDef['id'] | null;
  lastToolId: string | null;
  sheet: ShellSheet;
  setFlyout: (family: FamilyDef['id'] | null) => void;
  setLastTool: (toolId: string) => void;
  openSheet: (sheet: ShellSheet) => void;
  closeSheet: () => void;
}

export const useShell = create<ShellState>()((set) => ({
  flyout: null,
  lastToolId: null,
  sheet: null,
  setFlyout: (flyout) => set({ flyout }),
  setLastTool: (lastToolId) => set({ lastToolId }),
  openSheet: (sheet) => set({ sheet }),
  closeSheet: () => set({ sheet: null }),
}));

/** Back to a closed shell: no flyout, no sheet, no remembered tool. For tests and a new mount. */
export function resetShell(): void {
  useShell.setState({ flyout: null, lastToolId: null, sheet: null });
}
