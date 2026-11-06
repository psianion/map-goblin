// The shell's own view state: which family's flyout is open, the last family tool in hand
// (the dock keeps its columns while Select is up), which right sheet is showing, and
// whether the asset panel is open.
// Never part of the map; nothing here is saved.

import { create } from 'zustand';
import type { FamilyDef } from '@/editor/registry';
import type { AssetChip } from '@/editor/surfaces/assetModel';

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
  /** The asset panel, open on a chip, or closed. It shares the right edge with the sheets. */
  assets: AssetChip | null;
  setFlyout: (family: FamilyDef['id'] | null) => void;
  setLastTool: (toolId: string) => void;
  openSheet: (sheet: ShellSheet) => void;
  closeSheet: () => void;
  openAssets: (chip: AssetChip) => void;
  closeAssets: () => void;
}

export const useShell = create<ShellState>()((set) => ({
  flyout: null,
  lastToolId: null,
  sheet: null,
  assets: null,
  setFlyout: (flyout) => set({ flyout }),
  setLastTool: (lastToolId) => set({ lastToolId }),
  openSheet: (sheet) => set(sheet ? { sheet, assets: null } : { sheet }),
  closeSheet: () => set({ sheet: null }),
  openAssets: (assets) => set({ assets, sheet: null }),
  closeAssets: () => set({ assets: null }),
}));

/** Back to a closed shell: no flyout, no sheet, no remembered tool. For tests and a new mount. */
export function resetShell(): void {
  useShell.setState({ flyout: null, lastToolId: null, sheet: null, assets: null });
}
