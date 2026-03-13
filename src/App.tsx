import { useState, useEffect, useCallback } from 'react';
import { CanvasHost } from '@/canvas/CanvasHost';
import { LeftToolbar } from '@/components/toolbar/LeftToolbar';
import { RightPanel } from '@/components/layout/RightPanel';
import { CollapsedRightPanel } from '@/components/layout/CollapsedRightPanel';
import { ZoomSlider } from '@/components/toolbar/ZoomSlider';
import { ExportDialog } from '@/components/shared/ExportDialog';
import { RecoveryDialog } from '@/components/shared/RecoveryDialog';
import { startAutosave, isDirtyFlagSet } from '@/io/autosave';
import { useStore } from '@/store/store';
import './index.css';

export default function App() {
  const [exportOpen, setExportOpen] = useState(false);
  const [showRecovery, setShowRecovery] = useState(() => isDirtyFlagSet());
  const rightPanelOpen = useStore((s) => s.ui.rightPanelOpen);
  const togglePanel = useStore((s) => s.togglePanel);
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
        return;
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

  return (
    <div
      className="grid h-screen w-screen overflow-hidden bg-surface-0"
      style={{
        gridTemplateColumns: rightPanelOpen ? '48px 1fr 300px' : '48px 1fr 48px',
        transition: 'grid-template-columns 200ms ease-out',
      }}
    >
      {showRecovery && <RecoveryDialog onDismiss={() => setShowRecovery(false)} />}

      {/* Left toolbar */}
      <LeftToolbar />

      {/* Canvas area */}
      <div className="relative min-w-0 min-h-0">
        <CanvasHost />
        <div className="absolute bottom-3 right-3 z-10">
          <ZoomSlider />
        </div>
      </div>

      {/* Right panel: expanded or collapsed strip */}
      {rightPanelOpen
        ? <RightPanel />
        : <CollapsedRightPanel onExpand={handleExpandToSection} />
      }

      {/* Export dialog */}
      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} />
    </div>
  );
}
