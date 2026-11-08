// The current scene's room keys that carry an encounter (board 15's Prepped chip, board 16's
// Prepped encounters), read from the scene's prep on demand. Spawn is `triggers.spawn-encounter`.

import { useEffect, useState } from 'react';
import { getScenePrep } from '../../session/auth';
import { useSessionStore } from '../../session/store';

/** The current scene's room keys that carry an encounter, for the Prepped chip (board 15). */
export interface PreppedEncounter {
  roomId: string;
  label: string;
  roster: string;
  inert?: string;
}

export function usePreppedEncounters(active: boolean): PreppedEncounter[] {
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const prepRevision = useSessionStore((s) => s.prepRevision);
  const [found, setFound] = useState<{ sceneId: string; list: PreppedEncounter[] } | null>(null);
  useEffect(() => {
    const token = useSessionStore.getState().token;
    if (!active || !sceneId || !token) return;
    let cancelled = false;
    getScenePrep(sceneId, token)
      .then((res) => {
        const verdicts = new Map((res.resolvedRooms ?? []).map((r) => [r.roomId, r]));
        const list = (res.prep?.rooms ?? []).flatMap((key) => {
          const monsters = key.encounter?.monsters ?? [];
          if (monsters.length === 0) return [];
          const verdict = verdicts.get(key.roomId);
          return [
            {
              roomId: key.roomId,
              label: key.encounter?.name || verdict?.label || 'Encounter',
              roster: monsters.map((m) => (m.count > 1 ? `${m.count} × ${m.name}` : m.name)).join(', '),
              ...(verdict?.encounterInert ? { inert: verdict.encounterInert } : {}),
            },
          ];
        });
        if (!cancelled) setFound({ sceneId, list });
      })
      .catch(() => {
        if (!cancelled) setFound({ sceneId, list: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [active, sceneId, prepRevision]);
  return found && found.sceneId === sceneId ? found.list : [];
}


/** Run a room key's encounter on the live scene. */
export function spawnEncounter(roomId: string): void {
  const { session, sendCommand } = useSessionStore.getState();
  sendCommand('triggers', 'spawn-encounter', { sceneId: session?.activeSceneId, roomId });
}
