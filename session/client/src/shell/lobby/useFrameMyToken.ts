import { useEffect } from 'react';
import type { TokensState } from '@dnd/mechanics/tokens';
import { getEngineSingleton } from '@dnd/core/src/engine/engineSingleton';
import { useTableAssets } from '../../renderer/assetLoading';
import { useSessionStore } from '../../session/store';
import { findMyToken } from '../findMyToken';

/** After the renderer's own first framing has run. */
const SETTLE_MS = 250;

/**
 * A player's camera goes to their own token when it first stands on the drawn map: at Start,
 * out of the lobby, and after a late pick on a started table (plan 3.6). Once per token.
 */
export function useFrameMyToken(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    let framed: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      const { session, you, loadedScene } = useSessionStore.getState();
      const sceneId = session?.activeSceneId;
      if (!you || you.role !== 'player' || !sceneId || loadedScene?.sceneId !== sceneId || !getEngineSingleton()?.engine) return;
      const tokens = (session.modules.tokens as TokensState | undefined)?.byScene?.[sceneId];
      const mine = tokens ? Object.values(tokens).find((t) => t.ownerId === you.identityId) : undefined;
      if (!mine || mine.id === framed) return;
      framed = mine.id;
      clearTimeout(timer);
      timer = setTimeout(findMyToken, SETTLE_MS);
    };
    check();
    const unsub = useSessionStore.subscribe(check);
    // The engine draws the first scene after the document lands: that is a moment to look too.
    const unsubAssets = useTableAssets.subscribe(check);
    return () => {
      unsub();
      unsubAssets();
      clearTimeout(timer);
    };
  }, [enabled]);
}
