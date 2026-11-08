import type { Token, TokensState } from '@dnd/mechanics/tokens';
import { useTokenInteraction } from '../../modules/tokens/drag';

/** The live scene's tokens a player owns and that have eyes: who the DM can preview as. */
export function previewCandidates(tokens: TokensState | undefined, sceneId: string | null): Token[] {
  const scene = sceneId ? tokens?.byScene?.[sceneId] : undefined;
  return scene ? Object.values(scene).filter((t) => !!t.ownerId && t.sight != null) : [];
}

/**
 * Preview as: the DM's view drawn through one token's eyes (the fog's sight preview, which
 * needs the scene in Vision mode). Selecting the token is what points the preview at it.
 */
export function previewAs(tokenId: string | null): void {
  const t = useTokenInteraction.getState();
  if (!tokenId) {
    t.setPreviewSight(false);
    return;
  }
  t.select(tokenId);
  t.setPreviewSight(true);
}

/** Whose eyes the preview is looking through right now; null when it is off. */
export function usePreviewing(): string | null {
  return useTokenInteraction((s) => (s.previewSight ? s.selectedId : null));
}
