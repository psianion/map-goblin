// A token's uploaded portrait as an <img> source, for the DOM surfaces (library tiles, cards,
// sheets) — the canvas draws its own from the same route (`TokenRenderer.ts`).

import { useEffect, useState } from 'react';
import { endpoints } from '../../endpoints';
import { useSessionStore } from '../../session/store';

// ponytail: cached for the tab's life, never revoked — a library's worth of portraits. Upgrade
// path if that grows: an LRU with `URL.revokeObjectURL`.
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
export function usePortrait(assetId: string | null | undefined): string | null {
  const [resolved, setResolved] = useState<{ id: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!assetId) return;
    let cancelled = false;
    let pending = cache.get(assetId);
    if (!pending) {
      pending = fetchPortrait(assetId).catch(() => null);
      cache.set(assetId, pending);
    }
    void pending.then((url) => {
      if (!cancelled) setResolved({ id: assetId, url });
    });
    return () => {
      cancelled = true;
    };
  }, [assetId]);
  return assetId && resolved?.id === assetId ? resolved.url : null;
}

/**
 * Uploads a picture as campaign art (`POST /api/campaigns/:id/assets`, DM or the owning
 * player, under 2 MB) and answers its asset id.
 */
export async function uploadArt(file: Blob): Promise<string> {
  const { token, session } = useSessionStore.getState();
  if (!token || !session) throw new Error('Not at a table.');
  const res = await fetch(`${endpoints.httpBase}/api/campaigns/${encodeURIComponent(session.campaignId)}/assets`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!res.ok || !body.id) throw new Error(body.error ?? `Upload failed (${res.status}).`);
  return body.id;
}
