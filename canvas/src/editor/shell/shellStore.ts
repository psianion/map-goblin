// The shell's own view state: which family's flyout is open, the last family tool in hand
// (the dock keeps its columns while Select is up), the dock's Set up tab, which right sheet
// is showing, whether the asset panel is open, which height the Heights column highlights, and
// whether the Walkable cells view is on.
// Never part of the map; nothing here is saved.

import { create } from 'zustand';
import type { ToolType } from '@/store/types';
import type { FamilyDef } from '@/editor/registry';
import type { AssetChip } from '@/editor/surfaces/assetModel';

export type ShellSheet =
  | 'layers'
  | 'packs'
  | 'shortcuts'
  | 'sky'
  | 'prep'
  | { kind: 'layer'; target: string }
  /** One zone's triggers, encounter and notes (its card's More). */
  | { kind: 'zone'; target: string }
  | null;

interface ShellState {
  flyout: FamilyDef['id'] | null;
  lastToolId: string | null;
  sheet: ShellSheet;
  /** The asset panel, open on a chip, or closed. It shares the right edge with the sheets. */
  assets: AssetChip | null;
  /** The core tool a Space-pan just handed back, so its return is not taken for a new pick. */
  spaceReturn: string | null;
  /** The core tool an entry's open sheet (Sky) holds while it stands in hand (sheetHold.ts). */
  held: ToolType | null;
  /** The dock's Set up tab in front, by id; null is the tool's own. Back to null on every tool change. */
  dockTab: string | null;
  /** The Heights card under the pointer, and the one clicked to keep its highlight on the map. */
  heightHover: number | null;
  heightPin: number | null;
  /** The View group's Walkable cells switch: where a token can stand and which steps are stopped. */
  walkView: boolean;
  setFlyout: (family: FamilyDef['id'] | null) => void;
  setDockTab: (tab: string | null) => void;
  setHeightHover: (height: number | null) => void;
  setHeightPin: (height: number | null) => void;
  setWalkView: (on: boolean) => void;
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
  spaceReturn: null,
  held: null,
  dockTab: null,
  heightHover: null,
  heightPin: null,
  walkView: false,
  setFlyout: (flyout) => set({ flyout }),
  setDockTab: (dockTab) => set({ dockTab }),
  setHeightHover: (heightHover) => set({ heightHover }),
  setHeightPin: (heightPin) => set({ heightPin }),
  setWalkView: (walkView) => set({ walkView }),
  setLastTool: (lastToolId) => set({ lastToolId }),
  openSheet: (sheet) => set(sheet ? { sheet, assets: null } : { sheet }),
  closeSheet: () => set({ sheet: null }),
  openAssets: (assets) => set({ assets, sheet: null }),
  closeAssets: () => set({ assets: null }),
}));

/** Back to a closed shell: no flyout, no sheet, no remembered tool. For tests and a new mount. */
export function resetShell(): void {
  useShell.setState({ flyout: null, lastToolId: null, sheet: null, assets: null, spaceReturn: null, held: null, dockTab: null, heightHover: null, heightPin: null, walkView: false });
}
