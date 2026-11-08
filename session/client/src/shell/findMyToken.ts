import type { TokensState } from '@dnd/mechanics/tokens';
import { frameWorldPoint } from '../renderer/camera';
import { useSessionStore } from '../session/store';

/** F: bring this seat's own token (the one it owns on the live scene) into view. False when it has none. */
export function findMyToken(): boolean {
  const { session, you } = useSessionStore.getState();
  if (!session?.activeSceneId || !you) return false;
  const tokens = (session.modules.tokens as TokensState | undefined)?.byScene?.[session.activeSceneId];
  const mine = tokens ? Object.values(tokens).find((t) => t.ownerId === you.identityId) : undefined;
  if (!mine) return false;
  frameWorldPoint(mine.x, mine.y);
  return true;
}
