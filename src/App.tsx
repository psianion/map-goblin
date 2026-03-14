import { useState, useEffect, useCallback, useRef } from 'react';
import { Eye, EyeOff, Maximize, ImageDown, Upload } from 'lucide-react';
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

/**
 * Single global fade for all UI chrome. Counter-based enter/leave ensures
 * hovering ANY chrome element keeps ALL chrome visible. Only when the mouse
 * leaves all chrome elements for 5s does everything fade together.
 */
function usePanelFade(active: boolean) {
  const [faded, setFaded] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverCount = useRef(0);

  const startTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setFaded(true), 5000);
  }, []);

  useEffect(() => {
    hoverCount.current = 0;
    if (active) {
      startTimer();
      return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    // setFaded must be async to satisfy react-hooks/set-state-in-effect
    const resetId = setTimeout(() => setFaded(false), 0);
    return () => { clearTimeout(resetId); };
  }, [active, startTimer]);

  const onEnter = useCallback(() => {
    if (!active) return;
    hoverCount.current += 1;
    if (timerRef.current) clearTimeout(timerRef.current);
    setFaded(false);
  }, [active]);

  const onLeave = useCallback(() => {
    if (!active) return;
    hoverCount.current = Math.max(0, hoverCount.current - 1);
    if (hoverCount.current === 0) startTimer();
  }, [active, startTimer]);

  return { faded, onEnter, onLeave };
}

export default function App() {
  const [exportOpen, setExportOpen] = useState(false);
  const [showRecovery, setShowRecovery] = useState(() => isDirtyFlagSet());
  const rightPanelOpen = useStore((s) => s.ui.rightPanelOpen);
  const togglePanel = useStore((s) => s.togglePanel);
  const focusMode = useStore((s) => s.ui.focusMode);
  const setFocusMode = useStore((s) => s.setFocusMode);

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

  useEffect(() => {
    const cleanup = startAutosave(
      () => useStore.getState().getSerializableState(),
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
          className="absolute top-3 z-30 flex gap-1.5"
          style={{
            right: showPanels ? (rightPanelOpen ? '316px' : '64px') : '12px',
            transition: 'right 200ms ease-out',
            opacity: fade.faded ? 0.4 : 1,
          }}
          onMouseEnter={fade.onEnter}
          onMouseLeave={fade.onLeave}
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
            data-testid="focus-mode-btn"
            aria-label="Cycle focus mode"
            title={`Focus: ${focusMode}`}
            onClick={cycleFocusMode}
            className="flex items-center justify-center w-8 h-8 rounded-md bg-surface-1/80 backdrop-blur border border-border-subtle text-text-muted hover:text-text-primary hover:bg-surface-2 transition-colors"
          >
            <FocusIcon size={15} strokeWidth={2} />
          </button>
        </div>
        <div
          className="absolute bottom-3 z-30"
          style={{
            right: showPanels ? (rightPanelOpen ? '316px' : '64px') : '12px',
            transition: 'right 200ms ease-out',
            opacity: fade.faded ? 0.4 : 1,
          }}
          onMouseEnter={fade.onEnter}
          onMouseLeave={fade.onLeave}
        >
          <ZoomSlider />
        </div>
      </div>

      {/* Left toolbar — absolute overlay on top of canvas */}
      {showPanels && (
        <div
          data-testid="left-toolbar"
          className="absolute left-0 top-0 bottom-0 z-20"
          onMouseEnter={fade.onEnter}
          onMouseLeave={fade.onLeave}
          style={{ opacity: fade.faded ? 0.4 : 1 }}
        >
          <LeftToolbar />
        </div>
      )}

      {/* Right panel — absolute overlay on top of canvas */}
      {showPanels && (
        <div
          className="absolute right-0 top-0 bottom-0 z-20 overflow-hidden"
          onMouseEnter={fade.onEnter}
          onMouseLeave={fade.onLeave}
          style={{
            width: rightPanelOpen ? '300px' : '48px',
            opacity: fade.faded ? 0.4 : 1,
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
