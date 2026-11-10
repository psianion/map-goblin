import { useEffect, useState } from 'react';
import { cn } from '@dnd/ui';
import { endpoints } from '../../endpoints';
import { useSessionStore } from '../../session/store';

// ponytail: cached for the tab's life, never revoked — one small picture per scene. A
// republish is a new map id, so a new entry, never a stale one.
const cache = new Map<string, Promise<string | null>>();

async function fetchThumbnail(mapId: string, token: string | null): Promise<string | null> {
  const res = await fetch(`${endpoints.httpBase}/api/maps/${encodeURIComponent(mapId)}/thumbnail`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return null;
  return URL.createObjectURL(await res.blob());
}

/** The picture's object URL; null while loading, on a miss, or with no map id. */
function useThumbnail(mapId: string | null, token: string | undefined): string | null {
  const [resolved, setResolved] = useState<{ id: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!mapId) return;
    let cancelled = false;
    let pending = cache.get(mapId);
    if (!pending) {
      pending = fetchThumbnail(mapId, token ?? useSessionStore.getState().token).catch(() => null);
      cache.set(mapId, pending);
    }
    void pending.then((url) => {
      if (!cancelled) setResolved({ id: mapId, url });
    });
    return () => {
      cancelled = true;
    };
  }, [mapId, token]);
  return mapId && resolved?.id === mapId ? resolved.url : null;
}

/**
 * A scene's picture in a fixed box (`className` sizes it), or its first letter when it has
 * none: a file imported at the table, or one published before thumbnails. `token` is for a
 * page with no table session yet (the host wizard).
 */
export function SceneThumb({ scene, token, className }: { scene: { name: string; mapId: string; thumbnail?: boolean }; token?: string; className: string }) {
  const url = useThumbnail(scene.thumbnail ? scene.mapId : null, token);
  return (
    <span aria-hidden data-testid="scene-thumb" data-image={url ? 'true' : undefined} className={cn('overflow-hidden', className)}>
      {url ? <img src={url} alt="" className="size-full object-cover" /> : scene.name.slice(0, 1).toUpperCase()}
    </span>
  );
}
