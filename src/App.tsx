import { useState, useEffect, useCallback, useRef } from 'react';
import { Eye, EyeOff, Maximize, ImageDown, Upload } from 'lucide-react';
import { useIdleTimer } from '@/hooks/useIdleTimer';
import { CanvasHost } from '@/canvas/CanvasHost';
import { LeftToolbar } from '@/components/toolbar/LeftToolbar';
import { RightPanel } from '@/components/layout/RightPanel';
import { CollapsedRightPanel } from '@/components/layout/CollapsedRightPanel';
import { ZoomSlider } from '@/components/toolbar/ZoomSlider';
import { ExportDialog } from '@/components/shared/ExportDialog';
import { RecoveryDialog } from '@/components/shared/RecoveryDialog';
import { startAutosave, isDirtyFlagSet } from '@/io/autosave';
import { getEngineSingleton } from '@/engine/engineSingleton';
import { handleImageImport } from '@/canvas/importImage';
import { importImageRef } from '@/shortcuts/defaultShortcuts';
import { useStore } from '@/store/store';
import './index.css';

export default function App() {
  const [exportOpen, setExportOpen] = useState(false);
  const [showRecovery, setShowRecovery] = useState(() => isDirtyFlagSet());
  const [leftHovered, setLeftHovered] = useState(false);
  const [rightHovered, setRightHovered] = useState(false);
  const rightPanelOpen = useStore((s) => s.ui.rightPanelOpen);
  const togglePanel = useStore((s) => s.togglePanel);
  const focusMode = useStore((s) => s.ui.focusMode);
  const setFocusMode = useStore((s) => s.setFocusMode);
  const { isIdle } = useIdleTimer(5000, focusMode === 'auto');

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

  useEffect(() => {
    const cleanup = startAutosave(
      () => useStore.getState().getSerializableState(),
      (listener) => useStore.subscribe(listener),
    );
    return cleanup;
  }, []);

  const showPanels = focusMode !== 'fullscreen';
  const panelFaded = focusMode === 'auto' && isIdle;

  return (
    <>
    <div
      className="relative h-screen w-screen overflow-hidden bg-surface-0"
      data-focus-mode={focusMode}
    >
      {/* Canvas — fills full viewport beneath all overlays */}
      <div className="absolute inset-0">
        <CanvasHost />
        {/* Top-right: Import / Export / Focus buttons — z-30 so they sit above panel overlays */}
        <div className="absolute top-3 right-3 z-30 flex gap-1.5">
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
            data-testid="focus-mode-btn"
            aria-label="Cycle focus mode"
            title={`Focus: ${focusMode}`}
            onClick={cycleFocusMode}
            className="flex items-center justify-center w-8 h-8 rounded-md bg-surface-1/80 backdrop-blur border border-border-subtle text-text-muted hover:text-text-primary hover:bg-surface-2 transition-colors"
          >
            <FocusIcon size={15} strokeWidth={2} />
          </button>
        </div>
        <div className="absolute bottom-3 right-3 z-30">
          <ZoomSlider />
        </div>
      </div>

      {/* Left toolbar — absolute overlay on top of canvas */}
      {showPanels && (
        <div
          data-testid="left-toolbar"
          className="absolute left-0 top-0 bottom-0 z-20"
          onMouseEnter={() => setLeftHovered(true)}
          onMouseLeave={() => setLeftHovered(false)}
          style={{
            opacity: panelFaded && !leftHovered ? 0.15 : 1,
            transition: panelFaded && !leftHovered ? 'opacity 600ms ease-out' : 'none',
          }}
        >
          <LeftToolbar />
        </div>
      )}

      {/* Right panel — absolute overlay on top of canvas */}
      {showPanels && (
        <div
          className="absolute right-0 top-0 bottom-0 z-20 overflow-hidden"
          onMouseEnter={() => setRightHovered(true)}
          onMouseLeave={() => setRightHovered(false)}
          style={{
            width: rightPanelOpen ? '300px' : '48px',
            opacity: panelFaded && !rightHovered ? 0.15 : 1,
            transition: panelFaded && !rightHovered ? 'opacity 600ms ease-out' : 'none',
          }}
        >
          {rightPanelOpen
            ? <RightPanel />
            : <CollapsedRightPanel onExpand={handleExpandToSection} />
          }
        </div>
      )}
    </div>

    {/* Modals + overlays outside the layout so they never clip */}
    {showRecovery && <RecoveryDialog onDismiss={() => setShowRecovery(false)} />}
    <ExportDialog open={exportOpen} onOpenChange={setExportOpen} />

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
    </>
  );
}
