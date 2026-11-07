import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Toaster } from 'sonner';
import { CanvasHost } from '@/canvas/CanvasHost';
import { CanvasContextMenu } from '@/editor/CanvasContextMenu';
import { GridCalibrationOverlay } from '@/editor/GridCalibrationOverlay';
import { ExportModal } from '@/editor/dialogs/ExportModal';
import { PublishDialog } from '@/editor/dialogs/PublishDialog';
import { EditorShell } from '@/editor/shell/EditorShell';
import { SHELL_TOASTER } from '@/editor/surfaces/toaster';
import { startAutosave, isDocumentChange, isSettingsChange } from '@/io/autosave';
import { migrateAutosave } from '@/io/mapMigration';
import { getMapDB, setThumbnailProvider } from '@/store/slices/maps';
import { captureMapThumbnail } from '@/io/mapThumbnail';
import { getEngineSingleton } from '@/engine/engineSingleton';
import { handleImageImport } from '@/canvas/importImage';
import { importImageRef, openExportRef } from '@/shortcuts/defaultShortcuts';
import { useStore } from '@/store/store';
import { notify } from '@/lib/toast';
import { getAssetPackManager } from '@/engine/assetPackInstance';
import { initFocusMode } from '@/editor/viewPrefs';

// Before the first render, so the remembered focus mode is what the editor comes up in.
initFocusMode();

/** What the editor chrome needs from the editor that only the host holds. */
export interface EditorChromeActions {
  openExport: () => void;
  openPublish: () => void;
  importImage: () => void;
}

/** What the chrome drawn over the canvas is handed. */
export interface EditorChromeProps {
  actions: EditorChromeActions;
  onHome: () => void;
  openSettings: boolean;
}

interface EditorHostProps {
  /** The home page is up over the editor: the canvas boots underneath it, with no chrome. */
  home: boolean;
  onHome: () => void;
  /** Entered from a card's "Map settings…": the chrome comes up with that dialog showing. */
  openSettings: boolean;
}

/**
 * The editor: the canvas with its context menu and grid calibration, the chrome around it,
 * the export and publish dialogs, toasts and the image picker, and the boot, autosave and
 * thumbnails behind them.
 */
export function EditorHost({ home, onHome, openSettings }: EditorHostProps) {
  const [exportOpen, setExportOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const focusMode = useStore((s) => s.ui.focusMode);

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

  // Ctrl+E (the shortcut table's) opens the export dialog.
  useEffect(() => {
    openExportRef.current = () => setExportOpen(true);
    return () => { openExportRef.current = null; };
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

  const chromeActions = useMemo<EditorChromeActions>(
    () => ({
      openExport: () => setExportOpen(true),
      openPublish: () => setPublishOpen(true),
      // Through the module ref the Ctrl+I shortcut uses, wired to the picker above.
      importImage: () => importImageRef.current?.(),
    }),
    [],
  );

  return (
    <>
    <div className="relative h-screen w-screen overflow-hidden bg-bg" data-focus-mode={focusMode}>
      {/* Canvas — fills full viewport beneath all overlays */}
      <div className="absolute inset-0">
        <CanvasHost />
        <GridCalibrationOverlay />
        <CanvasContextMenu />
      </div>

      {!home && <EditorShell actions={chromeActions} onHome={onHome} openSettings={openSettings} />}
    </div>

    {/* Modals + overlays outside the layout so they never clip */}
    <ExportModal open={exportOpen} onOpenChange={setExportOpen} />
    <PublishDialog open={publishOpen} onOpenChange={setPublishOpen} />

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

    {/* The chrome styles the toasts as part of it. */}
    <Toaster {...SHELL_TOASTER} />
    </>
  );
}
