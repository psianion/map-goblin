import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Minimize2 } from 'lucide-react';
import { useStore } from '@/store/store';
import { TERRAIN_PANEL_ID } from '@/store/types';
import type { EditorChromeActions } from '@/App';
import { AssetBrowserPanel, type AssetTypeFilter } from '@/components/layers/AssetBrowserPanel';
import { togglePopoverRef } from '@/components/toolbar/toolConstants';
import { cancelZoomAnimationRef, viewportInsetsRef, zoomToFitRef } from '@/components/toolbar/zoomToFitRef';
import { cancelZoomAnimation, fitToContent } from '@/components/toolbar/zoomControl';
import { editSessionActive } from '@/canvas/editSessionKeys';
import { openPropBrowserRef } from '@/canvas/menuRegistry';
import { Rail } from './Rail';
import { TitleCard } from './TitleCard';
import { TopActions } from './TopActions';
import { Dock } from './Dock';
import { SelectionCard } from './SelectionCard';
import { StatusBar } from './StatusBar';
import { SlideOver } from './SlideOver';
import { LayerSheet } from './LayerSheet';
import { LayersSheet } from './LayersSheet';
import { stepLevel } from './layerActions';
import { TipLayer } from './TipLayer';
import { PrepOverview } from './PrepOverview';
import { RoomsSheet } from './RoomsSheet';
import { PropBrowser, PropBrowserHead } from './PropBrowser';
import { SplitDialog } from './SplitDialog';
import { SkySheet, SkySheetFoot } from './SkySheet';
import { PacksSheet } from './PacksSheet';
import { MapSettingsModal } from '../MapSettingsModal';
import { usePanelFade } from './usePanelFade';
import { assetBrowserHint, floorBrowserHint } from './assetStrip';
import {
  loadDockCollapsed,
  loadDockTab,
  saveDockCollapsed,
  saveDockTab,
  tabForTool,
  ROOM_TOOL_KEYS,
  type DockTabId,
} from './dockTabs';
import { notify } from '@/lib/toast';
import { canvasKeysAllowed } from '@/shortcuts/keyGuard';
import { TAB_KINDS, setMarqueeKinds } from '@dnd/core/src/engine/marqueeFilter';

/** Mirrors --v2-e-rail in v2-editor.css. */
const RAIL_W = 44;
/** Mirrors .v2-sheet's width and its 12px from the edge in v2-editor.css. */
const SHEET_W = 320;
const SHEET_GAP = 12;
/** Air between the map and the chrome around it when the map is fitted. */
const FIT_PAD = 32;

/**
 * The one right sheet that is open, if any: the layer list, the asset browser (floors and
 * walls), the props browser, prep, one layer's settings, the terrain's, or the packs. Opening
 * a sheet replaces the one that was open.
 */
type Sheet = 'layers' | 'assets' | 'props' | 'prep' | 'terrain' | 'sky' | 'packs' | { kind: 'layer'; layerId: string } | null;

/** What the layer sheet shows for `sheet`: a layer id, the terrain pseudo-layer, or nothing. */
function layerSheetTarget(sheet: Sheet): string | null {
  if (sheet === 'terrain') return TERRAIN_PANEL_ID;
  return typeof sheet === 'object' && sheet?.kind === 'layer' ? sheet.layerId : null;
}

/** Keys typed into a field, or Tab moving focus between controls, are not dock toggles. */
function isTypingOrNavigating(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || el === document.body) return false;
  return !!el.closest?.(
    'input, textarea, select, button, a, [contenteditable="true"], [role="dialog"], [role="menu"], [tabindex]',
  );
}

interface EditorShellProps {
  actions: EditorChromeActions;
  onHome: () => void;
  /**
   * Come up with the map settings dialog open (a card's "Map settings…" on the home page).
   * Read on mount only: the shell mounts afresh each time the editor is entered.
   */
  openSettings?: boolean;
}

/** The v2 editor chrome, drawn over the real canvas in place of the v1 panels. */
export function EditorShell({ actions, onHome, openSettings = false }: EditorShellProps) {
  const focusMode = useStore((s) => s.ui.focusMode);
  const activeTool = useStore((s) => s.tools.activeTool);
  const activeMapId = useStore((s) => s.activeMapId);
  const hidden = focusMode === 'fullscreen';
  // Auto: the chrome eases back after a while off it, and returns when the pointer comes over it.
  const { faded } = usePanelFade(focusMode === 'auto');
  // Never while something is selected: its card is being read and edited, the dock with it.
  const selecting = useStore((s) => s.selection.selectedIds.length > 0);
  // Here, not in the top bar, so it shows in fullscreen focus too, where the bar is gone.
  const [settingsOpen, setSettingsOpen] = useState(openSettings);

  const [tab, setTabState] = useState<DockTabId>(loadDockTab);
  const [collapsed, setCollapsed] = useState(loadDockCollapsed);
  // "Select: This tab's kind" asks the Select tool's marquee what the tab up now picks.
  const tabRef = useRef(tab);
  useEffect(() => {
    tabRef.current = tab;
  }, [tab]);
  useEffect(() => {
    setMarqueeKinds(() => TAB_KINDS[tabRef.current] ?? null);
    return () => setMarqueeKinds(null);
  }, []);
  const [sheet, setSheet] = useState<Sheet>(null);
  // The type tab the asset browser opens on; unset, it follows the tool in hand.
  const [assetsType, setAssetsType] = useState<AssetTypeFilter | undefined>(undefined);
  const closeSheet = useCallback(() => setSheet(null), []);
  // The rooms sheet's open state lives in the store (a view preference, opened from the
  // dock, a card or a menu); it shares the right edge with the shell's own sheets.
  const roomsSheetOpen = useStore((s) => s.ui.roomsSheetOpen);
  const [prevRoomsOpen, setPrevRoomsOpen] = useState(roomsSheetOpen);
  if (prevRoomsOpen !== roomsSheetOpen) {
    setPrevRoomsOpen(roomsSheetOpen);
    if (roomsSheetOpen && sheet !== null) setSheet(null);
  }
  // Another sheet opening closes the rooms sheet (a store write, so after the render).
  useEffect(() => {
    if (sheet !== null && useStore.getState().ui.roomsSheetOpen) useStore.getState().setRoomsSheetOpen(false);
  }, [sheet]);
  // What a click in the asset browser does right now: retexture floors, fill a slot, or stamp.
  const assetHint = useStore(assetBrowserHint);
  const floorHint = useStore(floorBrowserHint);
  // Props have their own browser; floors and walls keep the asset browser.
  const openAssets = useCallback((type?: AssetTypeFilter) => {
    if (type === 'object') {
      setSheet('props');
      return;
    }
    setAssetsType(type);
    setSheet('assets');
  }, []);
  // Replacing props (the card's or the menu's "Replace…") opens the props browser on them;
  // closing the browser any way ends the replace.
  const replacing = useStore((s) => s.ui.propReplaceIds !== null);
  const [prevReplacing, setPrevReplacing] = useState(replacing);
  if (prevReplacing !== replacing) {
    setPrevReplacing(replacing);
    if (replacing && sheet !== 'props') setSheet('props');
  }
  useEffect(() => {
    if (sheet !== 'props' && useStore.getState().ui.propReplaceIds !== null) useStore.getState().setPropReplaceIds(null);
  }, [sheet]);
  // The prop menu's "Replace from library…" comes here the same way.
  useEffect(() => {
    openPropBrowserRef.current = (ids) => useStore.getState().setPropReplaceIds(ids);
    return () => {
      openPropBrowserRef.current = null;
    };
  }, []);
  const openLayerSettings = useCallback((target: string) => {
    setSheet(target === TERRAIN_PANEL_ID ? 'terrain' : { kind: 'layer', layerId: target });
  }, []);
  const shellRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);

  const setTab = useCallback((next: DockTabId) => {
    setTabState(next);
    saveDockTab(next);
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      saveDockCollapsed(!c);
      return !c;
    });
  }, []);

  // Picking a drawing tool by shortcut brings its family's tab forward.
  const [prevTool, setPrevTool] = useState(activeTool);
  if (prevTool !== activeTool) {
    setPrevTool(activeTool);
    const family = tabForTool(activeTool);
    if (family && family !== tab) setTab(family);
  }

  // The v1 status bar's zoom slider is what normally answers Ctrl+0; it is not mounted here.
  useEffect(() => {
    zoomToFitRef.current = fitToContent;
    cancelZoomAnimationRef.current = cancelZoomAnimation;
    return () => {
      zoomToFitRef.current = null;
      cancelZoomAnimationRef.current = null;
    };
  }, []);

  // Re-pressing the active tool's key toggled its popover in v1. Here it never folds the
  // dock (Tab does that): it opens the dock if folded and brings the tool's tab forward.
  const expandDock = useCallback(() => {
    setCollapsed((c) => {
      if (c) saveDockCollapsed(false);
      return false;
    });
    const family = tabForTool(useStore.getState().tools.activeTool);
    if (family) setTab(family);
  }, [setTab]);

  useEffect(() => {
    togglePopoverRef.current = expandDock;
    return () => {
      togglePopoverRef.current = null;
    };
  }, [expandDock]);

  // R, P and X pick the room tools while the Rooms tab is up (R and P draw plain floors
  // from every other tab); X is free elsewhere, so it picks Divide from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.defaultPrevented) return;
      const key = e.key.toLowerCase();
      const tool = ROOM_TOOL_KEYS[key];
      if (!tool || (key !== 'x' && tab !== 'rooms')) return;
      // A focused dock tab still lets the key through; a field, a menu, a sheet does not.
      if (!canvasKeysAllowed(e)) return;
      if (editSessionActive(useStore.getState().tools)) return;
      e.preventDefault();
      e.stopPropagation();
      const s = useStore.getState();
      if (s.tools.activeTool === tool) return;
      s.setActiveTool(tool);
      notify.subtle(tool === 'roomRect' ? 'Rectangle room' : tool === 'roomPolygon' ? 'Polygon room' : 'Divide', { icon: 'tool' });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [tab]);

  // Page Up and Page Down step through the levels (board L4), clamped at the ends.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'PageUp' && e.key !== 'PageDown') return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.defaultPrevented) return;
      if (!canvasKeysAllowed(e)) return;
      if (editSessionActive(useStore.getState().tools)) return;
      e.preventDefault();
      stepLevel(e.key === 'PageUp' ? -1 : 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Tab collapses and restores the dock, unless something else already used the key
  // or focus is on a control. A wall, cave-band or outline edit owns Tab outright,
  // stone picked or not: folding the dock re-fits the map, which would jump the
  // zoom in the middle of the edit.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (e.defaultPrevented || isTypingOrNavigating(e.target)) return;
      if (editSessionActive(useStore.getState().tools)) return;
      e.preventDefault();
      toggleCollapsed();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleCollapsed]);

  // Fit-to-content centres in what the shell leaves free: right of the rail, under the
  // title card, above the dock, with air on every side. Measured, not assumed, so a dock
  // that grows or collapses is accounted for.
  const updateInsets = useCallback(() => {
    if (hidden) {
      viewportInsetsRef.current = { left: 0, right: 0, bottom: 0, top: 0 };
      return;
    }
    const vh = window.innerHeight;
    const title = shellRef.current?.querySelector('[data-testid="v2-title-card"]');
    const titleBottom = title?.getBoundingClientRect().bottom ?? 56;
    const dockTop = dockRef.current?.getBoundingClientRect().top ?? vh - 40;
    viewportInsetsRef.current = {
      left: RAIL_W + FIT_PAD,
      right: FIT_PAD,
      top: titleBottom + FIT_PAD / 2,
      bottom: Math.max(0, vh - dockTop) + FIT_PAD,
    };
  }, [hidden]);

  useLayoutEffect(() => {
    updateInsets();
    const el = dockRef.current;
    if (!el) return;
    const ro = new ResizeObserver(updateInsets);
    ro.observe(el);
    window.addEventListener('resize', updateInsets);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', updateInsets);
    };
  }, [updateInsets, collapsed]);

  // Frame the map on the way in, when another map is opened, and when the dock opens or
  // closes, so the map is never left half under the chrome.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      updateInsets();
      fitToContent();
    });
    return () => cancelAnimationFrame(raf);
  }, [activeMapId, collapsed, hidden, updateInsets]);

  const onTab = useCallback(
    (next: DockTabId) => {
      setTab(next);
      // Assets has no room in a strip; the props browser opens beside the map. Another
      // tab puts the browsers away (the props browser stays for the Props tab).
      if (next === 'assets') setSheet('props');
      else setSheet((s) => (s === 'assets' || (s === 'props' && next !== 'props') ? null : s));
    },
    [setTab],
  );

  const settings = <MapSettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />;
  // The Layers sheet and a layer's settings sheet take the right edge; the selection card
  // moves left of them rather than hide under them (v2-editor.css reads --v2-e-sheet).
  const sheetBeside = sheet === 'layers' || layerSheetTarget(sheet) !== null;
  const shellStyle = sheetBeside ? ({ '--v2-e-sheet': `${SHEET_W + SHEET_GAP}px` } as CSSProperties) : undefined;

  if (hidden) {
    return (
      <div className="v2-editor">
        {settings}
        <button
          type="button"
          className="v2-float v2-focus-exit"
          onClick={() => useStore.getState().setFocusMode('manual')}
          title="Leave focus mode (`)"
        >
          <Minimize2 size={14} strokeWidth={1.75} />
          Leave focus
        </button>
      </div>
    );
  }

  return (
    <div className="v2-editor" data-testid="v2-editor" data-faded={(faded && !selecting) || undefined} ref={shellRef} style={shellStyle}>
      {/* First in both trees, so going in or out of fullscreen keeps an open dialog as it is. */}
      {settings}
      <Rail prepOpen={sheet === 'prep'} onTogglePrep={() => setSheet((s) => (s === 'prep' ? null : 'prep'))} />
      <TitleCard onHome={onHome} />
      <TopActions actions={actions} onOpenSettings={() => setSettingsOpen(true)} onOpenPacks={() => setSheet('packs')} />
      <SelectionCard onOpenPrep={() => setSheet('prep')} onOpenAssets={openAssets} onOpenLayers={() => setSheet('layers')} />
      <Dock
        ref={dockRef}
        tab={tab}
        onTab={onTab}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        onOpenLayers={() => setSheet('layers')}
        onOpenLayerSettings={openLayerSettings}
        onOpenAssets={openAssets}
        skyOpen={sheet === 'sky'}
        onToggleSky={() => setSheet((s) => (s === 'sky' ? null : 'sky'))}
      />
      {/* A box-less wrapper, so the bar keeps its place in the shell and still counts as chrome. */}
      <div className="v2-chrome-contents" data-chrome>
        <StatusBar skyOpen={sheet === 'sky'} />
      </div>
      <SlideOver
        title="Sky & mood"
        open={sheet === 'sky'}
        onClose={closeSheet}
        testId="v2-sky-sheet"
        legacy={false}
        className="v2-skysheet"
        footer={<SkySheetFoot />}
      >
        <SkySheet />
      </SlideOver>
      <LayersSheet open={sheet === 'layers'} onClose={closeSheet} onOpenLayerSettings={openLayerSettings} />
      <SlideOver title="Assets" open={sheet === 'assets'} onClose={closeSheet} testId="v2-assets-sheet">
        <AssetBrowserPanel key={assetsType ?? 'tool'} initialType={assetsType} hint={assetHint} floorHint={floorHint} />
      </SlideOver>
      <SlideOver
        title="Props"
        open={sheet === 'props'}
        onClose={closeSheet}
        testId="v2-props-sheet"
        legacy={false}
        header={<PropBrowserHead onClose={closeSheet} onOpenPacks={() => setSheet('packs')} />}
      >
        <PropBrowser />
      </SlideOver>
      <PacksSheet open={sheet === 'packs'} onClose={closeSheet} />
      <SlideOver title="Prep" open={sheet === 'prep'} onClose={closeSheet} testId="v2-prep-sheet">
        <PrepOverview />
      </SlideOver>
      <LayerSheet target={layerSheetTarget(sheet)} onClose={closeSheet} />
      <RoomsSheet />
      <SplitDialog />
      <TipLayer />
    </div>
  );
}
