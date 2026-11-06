import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Minimize2 } from 'lucide-react';
import { SecondaryButton } from '@/editor/components';
import { useStore } from '@/store/store';
import { registry as defaultRegistry, type Registry } from '@/editor/registry';
import type { EditorChromeProps } from '@/editor/EditorHost';
import { cancelZoomAnimationRef, viewportInsetsRef, zoomToFitRef } from '@/editor/zoomToFitRef';
import { cancelZoomAnimation, fitToContent } from '@/editor/zoomControl';
import { editorShellKeysRef } from '@/shortcuts/defaultShortcuts';
import { stepLevel } from '@/v2/editor/layerActions';
import { usePanelFade } from '@/v2/editor/usePanelFade';
import { MapSettingsModal } from '@/v2/MapSettingsModal';
import { Dock } from '@/editor/surfaces/Dock';
import { FloatingActions } from '@/editor/surfaces/FloatingActions';
import { toolForEngine } from '@/editor/surfaces/hooks';
import { RAIL_W, Rail } from '@/editor/surfaces/Rail';
import { SheetHost } from '@/editor/surfaces/Sheet';
import { Slot } from '@/editor/surfaces/Slot';
import { StatusBar } from '@/editor/surfaces/StatusBar';
import { Tip } from '@/editor/surfaces/Tip';
import { TitleCard } from '@/editor/surfaces/TitleCard';
import { TopActions } from '@/editor/surfaces/TopActions';
import { RegistryProvider } from './RegistryProvider';
import { resetShell, useShell } from './shellStore';

/** Air between the map and the chrome around it when the map is fitted. */
const FIT_PAD = 32;

/** Remembers the last family tool in hand, which the dock keeps while Select is up. */
function useLastFamilyTool(registry: Registry) {
  const engine = useStore((s) => s.tools.activeTool);
  useEffect(() => {
    const tool = toolForEngine(registry, engine);
    if (tool && registry.familyOfTool(tool.id)) useShell.getState().setLastTool(tool.id);
  }, [registry, engine]);
}

/**
 * The editor chrome over the canvas: rail, slot (flyout, tool panel or card), title card,
 * top actions, dock, status bar, the floating actions by a selection, the right sheet and
 * the tooltip. The surfaces render from `registry` and know nothing about any one tool.
 */
export function EditorShell({ actions, onHome, openSettings = false, registry = defaultRegistry }: EditorChromeProps & { registry?: Registry }) {
  const focusMode = useStore((s) => s.ui.focusMode);
  const activeMapId = useStore((s) => s.activeMapId);
  const selecting = useStore((s) => s.selection.selectedIds.length > 0);
  const hidden = focusMode === 'fullscreen';
  const { faded } = usePanelFade(focusMode === 'auto');
  const [settingsOpen, setSettingsOpen] = useState(openSettings);
  const shellRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  useLastFamilyTool(registry);
  useEffect(() => () => resetShell(), []);

  useEffect(() => {
    zoomToFitRef.current = fitToContent;
    cancelZoomAnimationRef.current = cancelZoomAnimation;
    return () => {
      zoomToFitRef.current = null;
      cancelZoomAnimationRef.current = null;
    };
  }, []);

  // The table's shell keys: Page Up and Down step the levels, ? opens the shortcuts. The
  // dock never folds here, and there are no dock tabs; tool keys come from the registry later.
  useEffect(() => {
    editorShellKeysRef.current = {
      tab: () => '',
      toggleDock: () => {},
      stepLevel,
      openShortcuts: () => useShell.getState().openSheet('shortcuts'),
    };
    return () => {
      editorShellKeysRef.current = null;
    };
  }, []);

  // Fit-to-content centres in what the chrome leaves free: right of the rail, under the
  // title card, above the dock, with air on every side.
  const updateInsets = useCallback(() => {
    if (hidden) {
      viewportInsetsRef.current = { left: 0, right: 0, bottom: 0, top: 0 };
      return;
    }
    const vh = window.innerHeight;
    const title = shellRef.current?.querySelector('[data-testid="shell-title-card"]');
    const titleBottom = title?.getBoundingClientRect().bottom ?? 56;
    const dockTop = dockRef.current?.getBoundingClientRect().top ?? vh - 152;
    viewportInsetsRef.current = {
      left: RAIL_W + FIT_PAD,
      right: FIT_PAD,
      top: titleBottom + FIT_PAD / 2,
      bottom: Math.max(0, vh - dockTop) + FIT_PAD,
    };
  }, [hidden]);

  useLayoutEffect(() => {
    updateInsets();
    window.addEventListener('resize', updateInsets);
    return () => window.removeEventListener('resize', updateInsets);
  }, [updateInsets]);

  // Frame the map on the way in and when another map opens.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      updateInsets();
      fitToContent();
    });
    return () => cancelAnimationFrame(raf);
  }, [activeMapId, hidden, updateInsets]);

  const settings = <MapSettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />;

  if (hidden) {
    return (
      <div data-shell className="pointer-events-none fixed inset-0 z-20 font-sans text-[12px] text-text">
        {settings}
        <SecondaryButton
          icon={Minimize2}
          className="pointer-events-auto absolute top-3 right-3 bg-panel shadow-e"
          onClick={() => useStore.getState().setFocusMode('manual')}
        >
          Leave focus
        </SecondaryButton>
      </div>
    );
  }

  return (
    <RegistryProvider registry={registry}>
      <div
        ref={shellRef}
        data-shell
        data-testid="shell"
        data-faded={(faded && !selecting) || undefined}
        className="group/shell pointer-events-none fixed inset-0 z-20 font-sans text-[12px] leading-[1.4] text-text [&>*]:pointer-events-auto [&>[data-chrome]]:transition-opacity [&>[data-chrome]]:duration-[400ms] data-[faded]:[&>[data-chrome]:not(:has(:focus-visible))]:opacity-[0.35]"
      >
        {settings}
        <Rail />
        <TitleCard onHome={onHome} />
        <TopActions actions={actions} onOpenSettings={() => setSettingsOpen(true)} />
        <Slot />
        <Dock ref={dockRef} />
        <StatusBar />
        <FloatingActions />
        <SheetHost />
        <Tip />
      </div>
    </RegistryProvider>
  );
}
