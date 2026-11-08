import { useShallow } from 'zustand/react/shallow';
import { DownloadPill } from '@dnd/ui';
import { hidePill, libraryPacks, pauseLibrary, resumeLibrary, useTableAssets } from '../../renderer/assetLoading';

/**
 * A later scene's sets while they land (every seat), else the DM's library download while
 * it runs or is paused. Gone after its × for the rest of the session.
 */
export function TableDownloadPill() {
  const { map, library, hidden } = useTableAssets(useShallow((s) => ({ map: s.map, library: s.library, hidden: s.pillHidden })));
  if (hidden) return null;
  if (map?.mode === 'pill') return <DownloadPill className="ml-1" phase="map" progress={map.progress} onHide={hidePill} />;
  if (library.status !== 'running' && library.status !== 'paused') return null;
  return (
    <DownloadPill
      className="ml-1"
      phase="library"
      progress={library.progress}
      packs={libraryPacks(library.packId, library.status, library.progress)}
      paused={library.status === 'paused'}
      onPause={pauseLibrary}
      onResume={resumeLibrary}
      onHide={hidePill}
    />
  );
}
