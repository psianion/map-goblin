import { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from 'react';
import { Toaster } from 'sonner';
import { Eye, EyeOff, Maximize, Scan, ImageDown, Upload, CloudUpload } from 'lucide-react';
import { CanvasHost } from '@/canvas/CanvasHost';
import { LeftToolbar } from '@/components/toolbar/LeftToolbar';
import { MapsSidePanel } from '@/components/maps/MapsSidePanel';
import { RightPanel } from '@/components/layout/RightPanel';
import { CollapsedRightPanel } from '@/components/layout/CollapsedRightPanel';
import { StatusBar } from '@/components/layout/StatusBar';
import { FloatingActionBar } from '@/components/canvas/FloatingActionBar';
import { CanvasContextMenu } from '@/components/canvas/CanvasContextMenu';
import { GridCalibrationOverlay } from '@/components/canvas/GridCalibrationOverlay';
import { ExportDialog } from '@/components/shared/ExportDialog';
import { ExportModal } from '@/v2/ExportModal';
import { PublishDialog } from '@/components/shared/PublishDialog';
import { startAutosave, isDocumentChange, isSettingsChange } from '@/io/autosave';
import { migrateAutosave } from '@/io/mapMigration';
import { getMapDB, setThumbnailProvider } from '@/store/slices/maps';
import { captureMapThumbnail } from '@/io/mapThumbnail';
import { getEngineSingleton } from '@/engine/engineSingleton';
import { handleImageImport } from '@/canvas/importImage';
import { importImageRef } from '@/shortcuts/defaultShortcuts';
import { canvasKeysAllowed, isTypingTarget } from '@/shortcuts/keyGuard';
import { getEditorDesk } from '@dnd/core/src/engine/editorDesk';
import { ShortcutHelpDialog } from '@/components/shared/ShortcutHelpDialog';
import { NewMapDialog } from '@/components/maps/NewMapDialog';
import { ImportMapsDialog } from '@/components/maps/ImportMapsDialog';
import { zoomToFitRef, viewportInsetsRef } from '@/components/toolbar/zoomToFitRef';
import { useStore } from '@/store/store';
import { notify } from '@/lib/toast';
import { getAssetPackManager } from '@/engine/assetPackInstance';
import { usePanelFade } from '@/v2/editor/usePanelFade';
import { initFocusMode, nextFocusMode } from '@/v2/viewPrefs';
import './index.css';

// Before the first render, so the remembered focus mode is what the editor comes up in.
initFocusMode();

/** What a replacement chrome needs from the editor that only App holds. */
export interface EditorChromeActions {
  openExport: () => void;
  openPublish: () => void;
  importImage: () => void;
}

interface AppProps {
  /**
   * Draws the editor's chrome in place of the built-in toolbars, panels and status bar.
   * The canvas, dialogs, toasts and keyboard handling stay as they are; the caller also
   * owns `viewportInsetsRef`, since only it knows what its chrome covers.
   */
  renderChrome?: (actions: EditorChromeActions) => ReactNode;
}

export default function App({ renderChrome }: AppProps = {}) {
  const [exportOpen, setExportOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const leftPanelOpen = useStore((s) => s.ui.leftPanelOpen);
  const rightPanelOpen = useStore((s) => s.ui.rightPanelOpen);
  const togglePanel = useStore((s) => s.togglePanel);
  const focusMode = useStore((s) => s.ui.focusMode);
  const setFocusMode = useStore((s) => s.setFocusMode);
  const modalState = useStore((s) => s.ui.modalState);
  const showModal = useStore((s) => s.showModal);

  // A host drawing its own chrome runs its own fade.
  const fade = usePanelFade(focusMode === 'auto' && renderChrome === undefined);

  const cycleFocusMode = useCallback(() => {
    setFocusMode(nextFocusMode(focusMode));
  }, [focusMode, setFocusMode]);

  const FocusIcon = focusMode === 'auto' ? Eye : focusMode === 'manual' ? EyeOff : Maximize;

  const handleExpandToSection = useCallback((sectionId?: string) => {
    if (sectionId) {
      try {
        const saved = localStorage.getItem('rp-sections');
        const set: string[] = saved ? JSON.parse(saved) : ['colors'];
        if (!set.includes(sectionId)) {
          set.push(sectionId);
          localStorage.setItem('rp-sections', JSON.stringify(set));
        }
      } catch { /* ignore */ }
    }
    if (!rightPanelOpen) togglePanel('right');
  }, [rightPanelOpen, togglePanel]);

  // Hidden file input for image import (Ctrl+I / Cmd+I)
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const openImagePicker = useCallback(() => {
    importInputRef.current?.click();
  }, []);
  const onImportChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const singleton = getEngineSingleton();
    if (singleton) await handleImageImport(file, singleton.engine);
    e.target.value = ''; // reset so same file can be re-picked
  }, []);

  // Wire the import ref so defaultShortcuts can trigger it
  useEffect(() => {
    importImageRef.current = openImagePicker;
    return () => { importImageRef.current = null; };
  }, [openImagePicker]);

  // Ctrl+E for export (not in defaultShortcuts because it needs React state)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const key = [
        e.ctrlKey || e.metaKey ? 'ctrl' : '',
        e.shiftKey ? 'shift' : '',
        e.altKey ? 'alt' : '',
        e.key.toLowerCase(),
      ]
        .filter(Boolean)
        .join('+');

      if (key === 'ctrl+e') {
        // The same guard as every map key: on v2 never from a field, a menu, a dialog or a
        // sheet; on v1 never from a text field.
        if (getEditorDesk() ? !canvasKeysAllowed(e) : isTypingTarget(e.target as Element)) return;
        e.preventDefault();
        setExportOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Multi-map migration + index load on app startup
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const db = await getMapDB();
        const result = await migrateAutosave(db);
        if (cancelled) return;

        if (result.migrated) {
          notify.info('Previous work imported into Maps system');
        }
        if (result.warning) {
          notify.error(result.warning);
        }

        await useStore.getState().loadMapIndex();
        if (cancelled) return;

        // If mapIndex is empty after loading, bootstrap a default map
        const { mapIndex } = useStore.getState();
        if (mapIndex.length === 0) {
          await useStore.getState().createNewMap('Untitled Map');
        }

        // Install-by-need for whatever `loadMapIndex` just loaded off IndexedDB (a blank
        // bootstrap map has nothing to fetch). Soft-fail — must never block boot.
        if (!cancelled) {
          try {
            await getAssetPackManager().ensureTexturesForMap(useStore.getState());
          } catch (err) {
            console.warn('[app] ensureTexturesForMap failed:', err);
          }
        }

        // Load the most recent map (first in index since sorted by updatedAt desc)
        const { mapIndex: updatedIndex, activeMapId } = useStore.getState();
        if (updatedIndex.length > 0 && !activeMapId) {
          // loadMapIndex already sets activeMapId to the first entry,
          // but if the map data needs loading, do it here
        }
      } catch (err) {
        console.warn('[app] Multi-map migration/init failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const cleanup = startAutosave(
      () => useStore.getState().saveCurrentMap(),
      (listener) =>
        useStore.subscribe((s, prev) => {
          if (isDocumentChange(s, prev)) listener(isSettingsChange(s, prev));
        }),
    );
    return cleanup;
  }, []);

  // Every save also takes the small render the map's card shows.
  useEffect(() => {
    setThumbnailProvider(captureMapThumbnail);
    return () => setThumbnailProvider(null);
  }, []);

  const customChrome = renderChrome !== undefined;
  const showPanels = focusMode !== 'fullscreen' && !customChrome;
  const chromeActions = useMemo<EditorChromeActions>(
    () => ({
      openExport: () => setExportOpen(true),
      openPublish: () => setPublishOpen(true),
      // Through the module ref the Ctrl+I shortcut uses, wired to the picker above.
      importImage: () => importImageRef.current?.(),
    }),
    [],
  );

  // Zoom-to-fit centres in the gap the overlaid chrome leaves. Widths mirror the inline
  // styles below: maps panel 260 + toolbar 48 (w-12) on the left, right panel 300 open /
  // 48 collapsed, status bar 28 (h-7) along the bottom.
  useEffect(() => {
    if (customChrome) return;
    viewportInsetsRef.current = showPanels
      ? {
          left: (leftPanelOpen ? 260 : 0) + 48,
          right: rightPanelOpen ? 300 : 48,
          bottom: 28,
        }
      : { left: 0, right: 0, bottom: 0 };
  }, [customChrome, showPanels, leftPanelOpen, rightPanelOpen]);

  return (
    <>
    <div
      className="relative h-screen w-screen overflow-hidden bg-surface-0"
      data-focus-mode={focusMode}
    >
      {/* Canvas — fills full viewport beneath all overlays */}
      <div className="absolute inset-0">
        <CanvasHost />
        {/* v1 only: on v2 the selection's verbs live in the selection card's header. */}
        {!customChrome && <FloatingActionBar belowChrome={false} />}
        <GridCalibrationOverlay />
        <CanvasContextMenu />
        {/* Top-right: Import / Export / Focus buttons — offset right to avoid overlapping the right panel */}
        {!customChrome && (
        <div
          data-chrome
          className="absolute top-3 z-30 flex gap-1.5"
          style={{
            right: showPanels ? (rightPanelOpen ? '316px' : '64px') : '12px',
            opacity: fade.faded ? 0.4 : 1,
            transition: 'right 200ms ease-out, opacity 200ms ease',
          }}
        >
          <label
            title="Import image"
            htmlFor="import-image-input"
            className="flex items-center justify-center w-8 h-8 rounded-md bg-surface-1/80 backdrop-blur border border-border-subtle text-text-muted hover:text-text-primary hover:bg-surface-2 transition-colors cursor-pointer"
          >
            <Upload size={15} strokeWidth={2} />
          </label>
          <button
            title="Export map"
            onClick={() => setExportOpen(true)}
            className="flex items-center justify-center w-8 h-8 rounded-md bg-surface-1/80 backdrop-blur border border-border-subtle text-text-muted hover:text-text-primary hover:bg-surface-2 transition-colors"
          >
            <ImageDown size={15} strokeWidth={2} />
          </button>
          <button
            title="Publish to library"
            aria-label="Publish to library"
            onClick={() => setPublishOpen(true)}
            className="flex items-center justify-center w-8 h-8 rounded-md bg-surface-1/80 backdrop-blur border border-border-subtle text-text-muted hover:text-text-primary hover:bg-surface-2 transition-colors"
          >
            <CloudUpload size={15} strokeWidth={2} />
          </button>
          <button
            title="Fit to content (Ctrl+0)"
            aria-label="Fit to content"
            onClick={() => zoomToFitRef.current?.()}
            className="flex items-center justify-center w-8 h-8 rounded-md bg-surface-1/80 backdrop-blur border border-border-subtle text-text-muted hover:text-text-primary hover:bg-surface-2 transition-colors"
          >
            <Scan size={15} strokeWidth={2} />
          </button>
          <button
            data-testid="focus-mode-btn"
            aria-label="Cycle focus mode"
            title={`Focus: ${focusMode}`}
            onClick={cycleFocusMode}
            className="flex items-center justify-center w-8 h-8 rounded-md bg-surface-1/80 backdrop-blur border border-border-subtle text-text-muted hover:text-text-primary hover:bg-surface-2 transition-colors"
          >
            <FocusIcon size={15} strokeWidth={2} />
          </button>
        </div>
        )}
      </div>

      {/* Maps sidebar — clipped for width-transition animation */}
      {showPanels && leftPanelOpen && (
        <div
          data-chrome
          className="absolute left-0 top-0 bottom-0 z-20 overflow-hidden"
          style={{
            width: '260px',
            opacity: fade.faded ? 0.4 : 1,
            transition: 'opacity 200ms ease',
          }}
        >
          <MapsSidePanel />
        </div>
      )}

      {/* Left toolbar — NOT clipped so tool popovers can escape */}
      {showPanels && (
        <div
          data-testid="left-toolbar"
          data-chrome
          className="absolute left-0 top-0 bottom-0 z-20"
          style={{
            // Slid, not re-positioned: `left` would relayout the toolbar and
            // its popovers every frame of the 200ms, on top of the canvas.
            transform: leftPanelOpen ? 'translateX(260px)' : 'none',
            opacity: fade.faded ? 0.4 : 1,
            transition: 'transform 200ms ease-out, opacity 200ms ease',
          }}
        >
          <LeftToolbar />
        </div>
      )}

      {/* Right panel — absolute overlay on top of canvas */}
      {showPanels && (
        <div
          data-chrome="right"
          className="absolute right-0 top-0 bottom-0 z-20 overflow-hidden"
          style={{
            // Full width always, slid off to leave the 48px strip showing.
            // Animating the width instead relaid out the whole panel subtree
            // every frame, next to a canvas that wants those frames.
            width: '300px',
            transform: rightPanelOpen ? 'none' : 'translateX(252px)',
            opacity: fade.faded ? 0.4 : 1,
            transition: 'transform 200ms ease-out, opacity 200ms ease',
          }}
        >
          {rightPanelOpen
            ? <RightPanel />
            : <CollapsedRightPanel onExpand={handleExpandToSection} />
          }
        </div>
      )}

      {/* Bottom status bar */}
      {showPanels && (
        <StatusBar
          leftPanelOpen={leftPanelOpen}
          rightPanelOpen={rightPanelOpen}
          faded={fade.faded}
        />
      )}

      {renderChrome?.(chromeActions)}
    </div>

    {/* Modals + overlays outside the layout so they never clip */}
    {/* A host drawing its own chrome (/v2) gets its own export dialog; Ctrl+E and the
        chrome's "Export…" both open whichever one is mounted. */}
    {customChrome ? (
      <ExportModal open={exportOpen} onOpenChange={setExportOpen} />
    ) : (
      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} />
    )}
    <PublishDialog open={publishOpen} onOpenChange={setPublishOpen} />
    <ShortcutHelpDialog
      open={modalState?.type === 'shortcutReference'}
      onOpenChange={(open) => { if (!open) showModal(null); }}
    />
    {/* Mounted here, not in the maps panel: Ctrl+Shift+N has to reach it with the
        panel closed, and one mount means the two entry points can never disagree. */}
    <NewMapDialog
      open={modalState?.type === 'newMap'}
      mode={modalState?.props.mode === 'settings' ? 'settings' : 'create'}
      onOpenChange={(open) => { if (!open) showModal(null); }}
    />
    <ImportMapsDialog
      open={modalState?.type === 'importMaps'}
      onOpenChange={(open) => { if (!open) showModal(null); }}
    />

    {/* Off-screen file input for image import */}
    <input
      id="import-image-input"
      ref={importInputRef}
      type="file"
      accept="image/png,image/jpeg,image/svg+xml,image/webp"
      style={{ position: 'fixed', width: 0, height: 0, opacity: 0, overflow: 'hidden', pointerEvents: 'none' }}
      tabIndex={-1}
      onChange={onImportChange}
    />

    {/* A host drawing its own chrome styles toasts as part of it (`.v2-toaster`), and they
        sit centred in its title-card band (12px down, 44px tall) instead of v1's 24px. */}
    <Toaster
      position="top-center"
      visibleToasts={3}
      className={customChrome ? 'v2-toaster' : undefined}
      toastOptions={{
        className: 'map-builder-toast',
        duration: 2000,
      }}
      offset={customChrome ? 17 : 24}
      gap={4}
    />
    </>
  );
}
