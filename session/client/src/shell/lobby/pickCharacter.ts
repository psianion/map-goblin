// Who the "Pick your character" card is for, and whether the player put it away for now.

import { create } from 'zustand';
import type { TokensState } from '@dnd/mechanics/tokens';
import { useModuleState, useSessionStore } from '../../session/store';
import { useClaimedTokens } from '../../modules/tokens/TokenRenderer';
import { pcOf, useTable } from './lobbyState';

/** "Not now" puts the card away; the Character sheet's "Pick your character" brings it back. */
export const usePickCard = create<{ away: boolean }>()(() => ({ away: false }));

export const reopenPickCharacter = (): void => usePickCard.setState({ away: false });

/** A player with no character and no token on a started table: the seat the card is for. */
export function useNeedsCharacter(): boolean {
  const role = useSessionStore((s) => s.you?.role);
  const you = useSessionStore((s) => s.you?.identityId);
  const tokens = useModuleState<TokensState>('tokens');
  const { started } = useTable();
  // A seat the DM handed a token on the map has someone to play, character or not.
  const onMap = useClaimedTokens().length > 0;
  return role === 'player' && started && !!tokens && !onMap && !pcOf(tokens, you);
}
