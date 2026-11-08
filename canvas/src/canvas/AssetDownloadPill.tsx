import { useShallow } from 'zustand/react/shallow';
import { DownloadPill } from '@dnd/ui';
import { hidePill, libraryPacks, pauseLibrary, resumeLibrary, useAssetLoading } from './assetLoading';

/**
 * The top bar's download pill: a later map's sets while they land, else the background
 * library while it runs or is paused. Gone after its × for the rest of the session.
 */
export function AssetDownloadPill({ className }: { className?: string }) {
  const { map, library, hidden } = useAssetLoading(
    useShallow((s) => ({ map: s.map, library: s.library, hidden: s.pillHidden })),
  );
  if (hidden) return null;
  if (map?.mode === 'pill') return <DownloadPill className={className} phase="map" progress={map.progress} onHide={hidePill} />;
  if (library.status !== 'running' && library.status !== 'paused') return null;
  return (
    <DownloadPill
      className={className}
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
