import { useState, useCallback } from 'react';
import { Plus, Upload, X } from 'lucide-react';
import { useStore } from '@/store/store';
import { restoreLastDeletedMap } from '@dnd/core/src/store/slices/maps';
import { notify } from '@/lib/toast';
import { switchMap } from '@/store/mapSwitcher';
import { undoManager } from '@/store/undoManager';
import { getEngineSingleton } from '@/engine/engineSingleton';
import { getAssetPackManager } from '@/engine/assetPackInstance';
import { PanelTabBar } from './PanelTabBar';
import { MapList } from './MapList';
import { PrepPanel } from './PrepPanel';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';

export function MapsSidePanel() {
  const togglePanel = useStore((s) => s.togglePanel);
  const mapIndex = useStore((s) => s.mapIndex);
  const activeMapId = useStore((s) => s.activeMapId);
  const storeDeleteMap = useStore((s) => s.deleteMap);
  const renameMap = useStore((s) => s.renameMap);
  const duplicateMap = useStore((s) => s.duplicateMap);
  // The dialog itself is mounted in App.tsx, so Ctrl+Shift+N reaches it with this panel closed.
  const showModal = useStore((s) => s.showModal);

  const [activeTab, setActiveTab] = useState<'maps' | 'prep'>('maps');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const handleSwitch = useCallback((id: string) => {
    const singleton = getEngineSingleton();
    const fog = singleton?.sceneGraph.fogTransition;

    const targetName = useStore.getState().mapIndex.find((m) => m.id === id)?.name ?? 'map';

    return switchMap(id, {
      getActiveMapId: () => useStore.getState().activeMapId,
      getIsMapSwitching: () => useStore.getState().isMapSwitching,
      setIsMapSwitching: (val) => useStore.setState({ isMapSwitching: val }),
      saveCurrentMap: () => useStore.getState().saveCurrentMap(),
      loadMap: async (targetId) => {
        await useStore.getState().loadMap(targetId);
        // Install-by-need for the map just switched to. Soft-fail — a missing pack
        // set degrades to the magenta fallback and must never abort the switch.
        try {
          await getAssetPackManager().ensureTexturesForMap(useStore.getState());
        } catch (err) {
          console.warn('[MapsSidePanel] ensureTexturesForMap failed:', err);
        }
      },
      clearUndo: () => undoManager.clear(),
      fogIn: fog ? () => fog.fogIn() : () => Promise.resolve(),
      fogOut: fog ? () => fog.fogOut() : () => Promise.resolve(),
      addToast: (msg, type) => {
        if (type === 'error') notify.error(msg);
        else notify.info(msg);
      },
    }).then(() => {
      notify.info(`Switched to '${targetName}'`);
    }).catch((err: unknown) => {
      console.error('[MapsSidePanel] Switch failed:', err);
    });
  }, []);

  const handleRename = useCallback(
    async (id: string, name: string) => {
      try {
        await renameMap(id, name);
        notify.subtle('Map renamed', { icon: 'rename' });
      } catch (err) {
        console.error('[MapsSidePanel] Rename failed:', err);
        notify.error('Failed to rename map');
      }
    },
    [renameMap],
  );

  const handleDuplicate = useCallback(
    async (id: string) => {
      try {
        await duplicateMap(id);
        notify.success('Map duplicated');
      } catch (err) {
        console.error('[MapsSidePanel] Duplicate failed:', err);
        notify.error('Failed to duplicate map');
      }
    },
    [duplicateMap],
  );

  // Map settings edits the open document — fixed size lives there, not in the card index —
  // so a card that isn't the open map is switched to first.
  const handleSettings = useCallback(
    async (id: string) => {
      if (useStore.getState().activeMapId !== id) {
        await handleSwitch(id);
        if (useStore.getState().activeMapId !== id) return; // switch refused or failed
      }
      showModal({ type: 'newMap', props: { mode: 'settings' } });
    },
    [handleSwitch, showModal],
  );

  // Delete is destructive, so require explicit confirmation (naming the map) before
  // touching the store. Undo only lives as long as the toast. See issue #10.
  const handleDelete = useCallback((id: string) => {
    setPendingDeleteId(id);
  }, []);

  // Undo used to call undoManager.undo(), which knows nothing about maps — it popped the
  // last *canvas* edit and left the map deleted. `deleteMap` stashes the whole record, so
  // Undo puts that back instead, and switches to it if it was the map being edited.
  const undoDelete = useCallback(async (wasActive: boolean) => {
    try {
      // Flush the open canvas first. Deleting the last map leaves a blank auto-created one
      // open, and restoreLastDeletedMap decides from that map's stored record whether it is
      // safe to take back out — anything drawn in it since has to be in the record by then.
      await useStore.getState().saveCurrentMap();
      const restored = await restoreLastDeletedMap();
      if (!restored) {
        notify.error('That map can no longer be restored');
        return;
      }
      const { meta, removedBlankId } = restored;
      useStore.setState((s) => {
        if (removedBlankId) s.mapIndex = s.mapIndex.filter((m) => m.id !== removedBlankId);
        s.mapIndex.push(meta);
      });
      if (wasActive) handleSwitch(meta.id);
      notify.success('Map restored');
    } catch (err) {
      console.error('[MapsSidePanel] Restore failed:', err);
      notify.error('Failed to restore map');
    }
  }, [handleSwitch]);

  const confirmDelete = useCallback(async () => {
    const id = pendingDeleteId;
    if (!id) return;
    setPendingDeleteId(null);
    const wasActive = useStore.getState().activeMapId === id;
    try {
      await storeDeleteMap(id);
      notify.action('Map deleted', {
        label: 'Undo',
        onClick: () => { void undoDelete(wasActive); },
        icon: 'trash',
      });
    } catch (err) {
      console.error('[MapsSidePanel] Delete failed:', err);
      notify.error('Failed to delete map');
    }
  }, [pendingDeleteId, storeDeleteMap, undoDelete]);

  const pendingMapName =
    mapIndex.find((m) => m.id === pendingDeleteId)?.name ?? 'this map';

  // Sort by updatedAt descending
  const sortedMaps = [...mapIndex].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div
      data-testid="maps-panel"
      className="gg-grain flex flex-col h-full w-[260px] bg-surface-1 border-r border-border-structure shrink-0 overflow-hidden"
    >
      {/* Header with close button — the title follows the active tab */}
      <div className="flex items-center justify-between px-3 h-9 border-b border-border-structure bg-surface-0 shrink-0">
        <span className="font-display text-tab-label uppercase tracking-wider text-text-primary">
          {activeTab === 'prep' ? 'Prep' : 'Maps'}
        </span>
        <button
          type="button"
          onClick={() => togglePanel('left')}
          aria-label="Close maps panel"
          className="w-6 h-6 flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-3 rounded transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      {/* Tab bar */}
      <PanelTabBar activeTab={activeTab} onTabChange={setActiveTab} />

      {activeTab === 'prep' ? (
        <PrepPanel />
      ) : (
        <>
          {/* New Map + Import buttons */}
          <div className="px-2 py-2 shrink-0 flex gap-1.5">
            <button
              type="button"
              data-testid="new-map-button"
              onClick={() => showModal({ type: 'newMap', props: { mode: 'create' } })}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md bg-accent-active/10 border border-accent-active/25 text-accent-active text-sm font-medium hover:bg-accent-active/15 transition-colors"
            >
              <Plus size={14} />
              New Map
            </button>
            <button
              type="button"
              data-testid="import-maps-button"
              title="Import maps from Foundry or Universal VTT files"
              onClick={() => showModal({ type: 'importMaps', props: {} })}
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-muted-foreground text-sm font-medium hover:bg-muted hover:text-foreground transition-colors"
            >
              <Upload size={14} />
              Import
            </button>
          </div>

          {/* Map list */}
          <MapList
            maps={sortedMaps}
            activeMapId={activeMapId}
            onSwitch={handleSwitch}
            onRename={handleRename}
            onDuplicate={handleDuplicate}
            onDelete={handleDelete}
            onSettings={(id) => { void handleSettings(id); }}
          />
        </>
      )}

      <ConfirmDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => { if (!open) setPendingDeleteId(null); }}
        title="Delete map?"
        message={`This will delete "${pendingMapName}" and everything on it.`}
        confirmLabel="Delete"
        destructive
        onConfirm={confirmDelete}
      />
    </div>
  );
}
