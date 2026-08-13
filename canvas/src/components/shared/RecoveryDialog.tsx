// src/components/shared/RecoveryDialog.tsx
// Shown on app load when the dirty flag (mapbuilder-dirty) is set in localStorage.
// Offers to restore from the most recent IndexedDB autosave.
import { useState, useEffect } from 'react';
import { loadFromIndexedDB, clearDirtyFlag, deleteAutosaveFromIndexedDB } from '@/io/autosave';
import { useStore } from '@/store/store';
import { getAssetPackManager } from '@/engine/assetPackInstance';
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
    // Soft-fail, fire-and-forget — a missing pack degrades to the magenta fallback and
    // must never hold up dismissing this dialog.
    getAssetPackManager()
      .ensureTexturesForMap(entry.data)
      .catch((err) => console.warn('[RecoveryDialog] ensureTexturesForMap failed:', err));
    clearDirtyFlag();
    onDismiss();
  };

  const handleDiscard = () => {
    clearDirtyFlag();
    deleteAutosaveFromIndexedDB();
    onDismiss();
  };

  // Nothing to restore — a flag left behind with no autosave behind it. Offering a
  // modal whose only button is "Discard" just makes the user dismiss a dead end, so
  // clear the flag and get out of the way.
  useEffect(() => {
    if (!loading && !entry) {
      clearDirtyFlag();
      onDismiss();
    }
  }, [loading, entry, onDismiss]);

  if (loading || !entry) return null;

  const savedAtStr = new Date(entry.savedAt).toLocaleString();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="recovery-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
    >
      <div className="bg-surface-1 border border-border-subtle rounded-lg p-6 max-w-sm w-full shadow-2xl">
        <h2 id="recovery-title" className="text-base font-semibold text-text-primary mb-2">
          Recover Unsaved Changes?
        </h2>
        <p className="text-sm text-text-muted mb-1">
          The previous session ended without saving.
        </p>
        <p className="text-xs text-text-muted mb-4">
          Autosave from: <span className="text-text-primary">{savedAtStr}</span>
          {' — '}
          <span className="text-text-primary">{entry.data.mapSettings.name}</span>
        </p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={handleDiscard}
            className="px-3 py-1.5 text-sm rounded bg-surface-2 text-text-muted hover:text-text-primary transition-colors"
          >
            Discard
          </button>
          <button
            onClick={handleRestore}
            className="px-3 py-1.5 text-sm rounded bg-accent-active text-on-accent hover:bg-accent-active/85 transition-colors"
          >
            Restore
          </button>
        </div>
      </div>
    </div>
  );
}
