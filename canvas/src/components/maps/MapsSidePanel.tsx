import { useState, useCallback } from 'react';
import { Plus, X } from 'lucide-react';
import { useStore } from '@/store/store';
import { notify } from '@/lib/toast';
import { switchMap } from '@/store/mapSwitcher';
import { undoManager } from '@/store/undoManager';
import { getEngineSingleton } from '@/engine/engineSingleton';
import { PanelTabBar } from './PanelTabBar';
import { MapList } from './MapList';

export function MapsSidePanel() {
  const togglePanel = useStore((s) => s.togglePanel);
  const mapIndex = useStore((s) => s.mapIndex);
  const activeMapId = useStore((s) => s.activeMapId);
  const createNewMap = useStore((s) => s.createNewMap);
  const storeDeleteMap = useStore((s) => s.deleteMap);
  const renameMap = useStore((s) => s.renameMap);
  const duplicateMap = useStore((s) => s.duplicateMap);

  const [activeTab, setActiveTab] = useState<'maps' | 'scenes'>('maps');

  const handleNewMap = useCallback(async () => {
    try {
      await createNewMap();
      notify.success('New map created');
    } catch (err) {
      console.error('[MapsSidePanel] Failed to create map:', err);
      notify.error('Failed to create map');
    }
  }, [createNewMap]);

  const handleSwitch = useCallback((id: string) => {
    const singleton = getEngineSingleton();
    const fog = singleton?.sceneGraph.fogTransition;

    const targetName = useStore.getState().mapIndex.find((m) => m.id === id)?.name ?? 'map';

    switchMap(id, {
      getActiveMapId: () => useStore.getState().activeMapId,
      getIsMapSwitching: () => useStore.getState().isMapSwitching,
      setIsMapSwitching: (val) => useStore.setState({ isMapSwitching: val }),
      saveCurrentMap: () => useStore.getState().saveCurrentMap(),
      loadMap: (targetId) => useStore.getState().loadMap(targetId),
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

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await storeDeleteMap(id);
        notify.action('Map deleted', {
          label: 'Undo',
          onClick: () => undoManager.undo(),
          icon: 'trash',
        });
      } catch (err) {
        console.error('[MapsSidePanel] Delete failed:', err);
        notify.error('Failed to delete map');
      }
    },
    [storeDeleteMap],
  );

  // Sort by updatedAt descending
  const sortedMaps = [...mapIndex].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div
      data-testid="maps-panel"
      className="flex flex-col h-full w-[260px] bg-surface-1 border-r border-border-default shrink-0 overflow-hidden"
    >
      {/* Header with close button */}
      <div className="flex items-center justify-between px-3 h-9 border-b border-border-default bg-surface-0 shrink-0">
        <span className="font-display text-tab-label uppercase tracking-wider text-text-primary">
          Maps
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

      {/* New Map button */}
      <div className="px-2 py-2 shrink-0">
        <button
          type="button"
          data-testid="new-map-button"
          onClick={handleNewMap}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md bg-accent-active/10 border border-accent-active/25 text-accent-active text-sm font-medium hover:bg-accent-active/15 transition-colors"
        >
          <Plus size={14} />
          New Map
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
      />
    </div>
  );
}
