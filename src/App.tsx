import { useState, useEffect, useCallback, useRef } from 'react';
import { Toaster } from 'sonner';
import { Eye, EyeOff, Maximize, Scan, ImageDown, Upload } from 'lucide-react';
import { CanvasHost } from '@/canvas/CanvasHost';
import { LeftToolbar } from '@/components/toolbar/LeftToolbar';
import { MapsSidePanel } from '@/components/maps/MapsSidePanel';
import { RightPanel } from '@/components/layout/RightPanel';
import { CollapsedRightPanel } from '@/components/layout/CollapsedRightPanel';
import { StatusBar } from '@/components/layout/StatusBar';
import { ExportDialog } from '@/components/shared/ExportDialog';
import { RecoveryDialog } from '@/components/shared/RecoveryDialog';
import { startAutosave, isDirtyFlagSet } from '@/io/autosave';
import { migrateAutosave } from '@/io/mapMigration';
import { getMapDB } from '@/store/slices/maps';
import { getEngineSingleton } from '@/engine/engineSingleton';
import { handleImageImport } from '@/canvas/importImage';
import { importImageRef } from '@/shortcuts/defaultShortcuts';
import { ShortcutHelpDialog } from '@/components/shared/ShortcutHelpDialog';
import { zoomToFitRef } from '@/components/toolbar/zoomToFitRef';
import { useStore } from '@/store/store';
import './index.css';

/**
 * Single global fade for all UI chrome. Uses pointermove polling on the
 * document to detect whether the pointer is over any chrome element
 * (data-chrome). This avoids enter/leave counter bugs when panels
 * unmount/remount (e.g. right panel collapse swaps components).
 */
function usePanelFade(active: boolean) {
  const [faded, setFaded] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overChrome = useRef(false);

  const startTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setFaded(true), 5000);
  }, []);

  useEffect(() => {
    if (!active) {
      if (timerRef.current) clearTimeout(timerRef.current);
      const id = setTimeout(() => setFaded(false), 0);
      return () => clearTimeout(id);
    }

    startTimer();

    const onPointerMove = (e: PointerEvent) => {
      const target = e.target as Element | null;
      const isOverChrome = !!target?.closest?.('[data-chrome]');
      if (isOverChrome && !overChrome.current) {
        // Entered chrome
        overChrome.current = true;
        if (timerRef.current) clearTimeout(timerRef.current);
        setFaded(false);
      } else if (!isOverChrome && overChrome.current) {
        // Left chrome
        overChrome.current = false;
        startTimer();
      }
    };

    document.addEventListener('pointermove', onPointerMove);
    return () => {
      document.removeEventListener('pointermove', onPointerMove);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [active, startTimer]);

  return { faded };
}

export default function App() {
  const [exportOpen, setExportOpen] = useState(false);
  const [showRecovery, setShowRecovery] = useState(() => isDirtyFlagSet());
  const leftPanelOpen = useStore((s) => s.ui.leftPanelOpen);
  const rightPanelOpen = useStore((s) => s.ui.rightPanelOpen);
  const togglePanel = useStore((s) => s.togglePanel);
  const focusMode = useStore((s) => s.ui.focusMode);
  const setFocusMode = useStore((s) => s.setFocusMode);
  const modalState = useStore((s) => s.ui.modalState);
  const showModal = useStore((s) => s.showModal);

  const fade = usePanelFade(focusMode === 'auto');

  // Persist focusMode to localStorage
  useEffect(() => {
    localStorage.setItem('focusMode', focusMode);
  }, [focusMode]);

  // Load focusMode from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('focusMode');
    if (saved === 'auto' || saved === 'manual' || saved === 'fullscreen') {
      useStore.getState().setFocusMode(saved);
    }
  }, []);

  const cycleFocusMode = useCallback(() => {
    const modes: Array<'auto' | 'manual' | 'fullscreen'> = ['auto', 'manual', 'fullscreen'];
    const idx = modes.indexOf(focusMode);
    setFocusMode(modes[(idx + 1) % 3]);
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
          useStore.getState().pushToast({
            id: crypto.randomUUID(),
            message: 'Previous work imported into Maps system',
            type: 'info',
            duration: 5000,
            createdAt: Date.now(),
          });
        }
        if (result.warning) {
          useStore.getState().pushToast({
            id: crypto.randomUUID(),
            message: result.warning,
            type: 'error',
            duration: 6000,
            createdAt: Date.now(),
          });
        }

        await useStore.getState().loadMapIndex();
        if (cancelled) return;

        // If mapIndex is empty after loading, bootstrap a default map
        const { mapIndex } = useStore.getState();
        if (mapIndex.length === 0) {
          await useStore.getState().createNewMap('Untitled Map');
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
      (listener) => useStore.subscribe(listener),
    );
    return cleanup;
  }, []);

  const showPanels = focusMode !== 'fullscreen';

  return (
    <>
    <div
      className="relative h-screen w-screen overflow-hidden bg-surface-0"
      data-focus-mode={focusMode}
    >
      {/* Canvas — fills full viewport beneath all overlays */}
      <div className="absolute inset-0">
        <CanvasHost />
        {/* Top-right: Import / Export / Focus buttons — offset right to avoid overlapping the right panel */}
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
          className="absolute top-0 bottom-0 z-20"
          style={{
            left: leftPanelOpen ? '260px' : '0px',
            opacity: fade.faded ? 0.4 : 1,
            transition: 'left 200ms ease-out, opacity 200ms ease',
          }}
        >
          <LeftToolbar />
        </div>
      )}

      {/* Right panel — absolute overlay on top of canvas */}
      {showPanels && (
        <div
          data-chrome
          className="absolute right-0 top-0 bottom-0 z-20 overflow-hidden"
          style={{
            width: rightPanelOpen ? '300px' : '48px',
            opacity: fade.faded ? 0.4 : 1,
            transition: 'width 200ms ease-out, opacity 200ms ease',
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
    </div>

    {/* Modals + overlays outside the layout so they never clip */}
    {showRecovery && <RecoveryDialog onDismiss={() => setShowRecovery(false)} />}
    <ExportDialog open={exportOpen} onOpenChange={setExportOpen} />
    <ShortcutHelpDialog
      open={modalState?.type === 'shortcutReference'}
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

    <Toaster
      position="top-center"
      visibleToasts={3}
      toastOptions={{
        className: 'map-builder-toast',
        duration: 2000,
      }}
      offset={16}
    />
    </>
  );
}
