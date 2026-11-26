// The lobby's download (plan 3.6): the live scene's map and art, and every token picture on
// it, fetched while the player waits, then `table.ready` with the scene's `sceneId:mapId` so
// the DM sees who is set. Runs again when the live scene or its map changes, and only then.

import { useEffect, useState } from 'react';
import type { TokensState } from '@dnd/mechanics/tokens';
import { prefetchSceneMap } from '../../session/loadSceneMap';
import { useSessionStore } from '../../session/store';
import { sceneTokens } from '../../modules/tokens/play';
import { preloadTokenArt } from '../../modules/tokens/TokenRenderer';
import { sendCommand, useLiveSceneKey } from './lobbyState';

/** Warm everything the map draws for `sceneId` without a renderer. */
export async function loadLobbyScene(sceneId: string, mapId: string, token: string): Promise<void> {
  const tokens = sceneTokens(useSessionStore.getState().session?.modules.tokens as TokensState | undefined, sceneId);
  const pictures = [...new Set(tokens.flatMap((t) => (t.imageAssetId ? [t.imageAssetId] : [])))];
  await Promise.all([prefetchSceneMap(sceneId, mapId, token), ...pictures.map((id) => preloadTokenArt(id).catch(() => undefined))]);
}

export type LobbyLoad = { key: string | null; state: 'loading' | 'ready' | 'failed' };

/** Loads the live scene once per `sceneId:mapId` and says so; what the lobby's footer shows. */
export function useLobbyLoading(): LobbyLoad {
  const key = useLiveSceneKey();
  const token = useSessionStore((s) => s.token);
  const [done, setDone] = useState<{ key: string; ok: boolean } | null>(null);

  useEffect(() => {
    if (!key || !token) return;
    let live = true;
    const at = key.indexOf(':');
    const sceneId = key.slice(0, at);
    const mapId = key.slice(at + 1);
    loadLobbyScene(sceneId, mapId, token).then(
      () => {
        if (!live) return;
        setDone({ key, ok: true });
        sendCommand('table', 'ready', { key });
      },
      (err: unknown) => {
        console.warn('[lobby] scene prefetch failed:', err);
        if (live) setDone({ key, ok: false });
      },
    );
    return () => {
      live = false;
    };
  }, [key, token]);

  if (!key) return { key, state: 'loading' };
  return { key, state: done?.key === key ? (done.ok ? 'ready' : 'failed') : 'loading' };
}
