// Token portraits for PartyStrip's discs. Same asset fetch as
// `modules/tokens/TokenRenderer.ts`'s `fetchTexture`, but the result is a `<img src>` object
// URL rather than a Pixi texture — this is DOM chrome, not the canvas.

import { useEffect, useState } from 'react';
import { endpoints } from '../endpoints';
import { useSessionStore } from '../session/store';

// ponytail: cached for the tab's life, never revoked — a handful of party portraits, not a
// token library browser. Upgrade path if that changes: an LRU with `URL.revokeObjectURL`.
const cache = new Map<string, Promise<string | null>>();

async function fetchPortrait(assetId: string): Promise<string | null> {
  const token = useSessionStore.getState().token;
  const res = await fetch(`${endpoints.httpBase}/api/assets/${encodeURIComponent(assetId)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return null;
  return URL.createObjectURL(await res.blob());
}

/** `null` while loading, on a missing asset, or with no id at all. */
export function usePortraitUrl(assetId: string | null): string | null {
  // Paired with the id it resolved for: a stale `assetId` prop change must read as "loading",
  // never as the previous token's portrait — the effect only ever writes this from its own
  // `.then` (an async callback, not a synchronous set during the effect body), so the id
  // comparison below is what keeps a switch from flashing the old picture.
  const [resolved, setResolved] = useState<{ id: string | null; url: string | null }>({
    id: null,
    url: null,
  });

  useEffect(() => {
    if (!assetId) return;
    let cancelled = false;
    let pending = cache.get(assetId);
    if (!pending) {
      pending = fetchPortrait(assetId).catch(() => null);
      cache.set(assetId, pending);
    }
    pending.then((url) => {
      if (!cancelled) setResolved({ id: assetId, url });
    });
    return () => {
      cancelled = true;
    };
  }, [assetId]);

  return resolved.id === assetId ? resolved.url : null;
}
