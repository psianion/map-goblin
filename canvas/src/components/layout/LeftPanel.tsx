import { useStore } from '@/store/store';
import { LeftToolbar } from '@/components/toolbar/LeftToolbar';
import { MapsSidePanel } from '@/components/maps/MapsSidePanel';

/**
 * Wrapper for the left side of the editor: optional MapsSidePanel + LeftToolbar.
 * Reads `leftPanelOpen` from UISlice to show/hide the maps panel.
 * The toolbar is always visible; the maps panel slides out to its left.
 */
export function LeftPanel() {
  const leftPanelOpen = useStore((s) => s.ui.leftPanelOpen);

  return (
    <div className="flex h-full">
      {leftPanelOpen && <MapsSidePanel />}
      <LeftToolbar />
    </div>
  );
}
