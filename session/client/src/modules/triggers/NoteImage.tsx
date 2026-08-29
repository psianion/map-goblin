// Map-embedded handout image, fetched with the seat's own token (the images route is
// bearer-authed like every map read). Object URL is per-mount and revoked with it.
//
// Shared by the DM's Prep sidebar (browsing an authored note) and the player's Journal
// (a shared note's snapshot) — the endpoint serves both once a note is shared (server change,
// table-shell-redesign), so this component needs no role branch.

import { useEffect, useState } from 'react';
import { useSessionStore } from '../../session/store';

/**
 * `full` — the DM reading a note: as large as it comes, capped, and never blown up past its
 * own pixels (`max-w-full`, not `w-full`, or an 89px thumbnail stretches to the panel width
 * and goes to mush). `card` — a Journal card's header picture: the mockup's fixed 92px
 * banner, so a feed of cards keeps one rhythm whatever sizes the DM attached.
 */
const VARIANT = {
  full: { img: 'max-h-64 max-w-full rounded object-contain', skeleton: 'h-24 rounded' },
  card: { img: 'h-[92px] w-full object-cover', skeleton: 'h-[92px]' },
} as const;

export function NoteImage({
  sceneId,
  imageKey,
  variant = 'full',
}: {
  sceneId: string;
  imageKey: string;
  variant?: keyof typeof VARIANT;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const token = useSessionStore.getState().token;
    if (!token) return;
    let revoke: string | null = null;
    let cancelled = false;
    fetch(`/api/maps/${encodeURIComponent(sceneId)}/images/${encodeURIComponent(imageKey)}`, {
      headers: { authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`image ${res.status}`);
        const blob = await res.blob();
        if (cancelled) return;
        revoke = URL.createObjectURL(blob);
        setUrl(revoke);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [sceneId, imageKey]);

  if (failed) return <p className="px-2.5 py-2 text-[11.5px] text-text-muted">Image unavailable.</p>;
  if (!url) return <div className={`animate-pulse bg-surface-2 ${VARIANT[variant].skeleton}`} />;
  return <img src={url} alt="" className={VARIANT[variant].img} />;
}
