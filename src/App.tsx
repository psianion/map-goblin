import { useState, useEffect } from 'react';
import { CanvasHost } from '@/canvas/CanvasHost';
import { LeftToolbar } from '@/components/toolbar/LeftToolbar';
import { RightPanel } from '@/components/layout/RightPanel';
import { ZoomSlider } from '@/components/toolbar/ZoomSlider';
import { ExportDialog } from '@/components/shared/ExportDialog';
import { RecoveryDialog } from '@/components/shared/RecoveryDialog';
import { startAutosave, isDirtyFlagSet } from '@/io/autosave';
import { useStore } from '@/store/store';
import './index.css';

export default function App() {
  const [exportOpen, setExportOpen] = useState(false);
  const [showRecovery, setShowRecovery] = useState(() => isDirtyFlagSet());

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
      style={{
        display: 'grid',
        gridTemplateColumns: '48px 1fr 300px',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
        background: '#1a1a1a',
      }}
    >
      {showRecovery && <RecoveryDialog onDismiss={() => setShowRecovery(false)} />}

      {/* Left toolbar */}
      <LeftToolbar />

      {/* Canvas area */}
      <div style={{ minWidth: 0, minHeight: 0, position: 'relative' }}>
        <CanvasHost />
        <div className="absolute bottom-3 right-3 z-10">
          <ZoomSlider />
        </div>
      </div>

      {/* Right panel: Layers | Assets tabs + Properties */}
      <RightPanel />

      {/* Export dialog */}
      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} />
    </div>
  );
}
