// src/components/shared/RecoveryDialog.tsx
// Shown on app load when the dirty flag (mapbuilder-dirty) is set in localStorage.
// Offers to restore from the most recent IndexedDB autosave.
import { useState, useEffect } from 'react';
import { loadFromIndexedDB, clearDirtyFlag, deleteAutosaveFromIndexedDB } from '@/io/autosave';
import { useStore } from '@/store/store';
import type { AutosaveEntry } from '@/io/autosave';

interface RecoveryDialogProps {
  onDismiss: () => void;
}

export function RecoveryDialog({ onDismiss }: RecoveryDialogProps) {
  const loadFromFile = useStore((s) => s.loadFromFile);
  const [entry, setEntry] = useState<AutosaveEntry | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadFromIndexedDB()
      .then(setEntry)
      .catch(() => setEntry(null))
      .finally(() => setLoading(false));
  }, []);

  const handleRestore = () => {
    if (!entry) return;
    loadFromFile(entry.data);
    clearDirtyFlag();
    onDismiss();
  };

  const handleDiscard = () => {
    clearDirtyFlag();
    deleteAutosaveFromIndexedDB();
    onDismiss();
  };

  if (loading) return null;

  const savedAtStr = entry ? new Date(entry.savedAt).toLocaleString() : 'unknown time';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="recovery-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
    >
      <div className="bg-surface-1 border border-border-subtle rounded-lg p-6 max-w-sm w-full shadow-2xl">
        <h2 id="recovery-title" className="text-base font-semibold text-white mb-2">
          Recover Unsaved Changes?
        </h2>
        <p className="text-sm text-text-muted mb-1">
          The previous session ended without saving.
        </p>
        {entry && (
          <p className="text-xs text-text-muted mb-4">
            Autosave from: <span className="text-white">{savedAtStr}</span>
            {' — '}
            <span className="text-white">{entry.data.mapSettings.name}</span>
          </p>
        )}
        {!entry && <p className="text-xs text-text-muted mb-4">No autosave data found.</p>}
        <div className="flex gap-3 justify-end">
          <button
            onClick={handleDiscard}
            className="px-3 py-1.5 text-sm rounded bg-surface-2 text-text-muted hover:text-white transition-colors"
          >
            Discard
          </button>
          {entry && (
            <button
              onClick={handleRestore}
              className="px-3 py-1.5 text-sm rounded bg-accent text-white hover:bg-accent/80 transition-colors"
            >
              Restore
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
