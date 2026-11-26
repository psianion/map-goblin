// The lobby (table lobby pass, plan 3.6 and 3.7): what the `table` slice says about it, and
// each seat's character, read the same way by the player's lobby and the DM's roster.

import { useMemo } from 'react';
import type { PlayerInfo, SessionState } from '@dnd/core/src/shared/protocol';
import { TABLE_INITIAL, type TableState } from '@dnd/mechanics/table';
import type { TokenDef, TokensState } from '@dnd/mechanics/tokens';
import { useSessionStore } from '../../session/store';

type SessionSlice = Pick<ReturnType<typeof useSessionStore.getState>, 'you' | 'session'>;

/** The `table` slice with every flag filled; a table with no slice yet reads as running. */
export function tableOf(session: SessionState | null | undefined): TableState {
  return { ...TABLE_INITIAL, ...(session?.modules.table as Partial<TableState> | undefined) };
}

export function useTable(): TableState {
  const slice = useSessionStore((s) => s.session?.modules.table);
  return useMemo(() => ({ ...TABLE_INITIAL, ...(slice as Partial<TableState> | undefined) }), [slice]);
}

/** `sceneId:mapId` of the live scene, the key a seat says it is ready for. */
export function liveSceneKey(session: SessionState | null | undefined): string | null {
  const sceneId = session?.activeSceneId;
  const mapId = sceneId ? session.scenes.find((s) => s.id === sceneId)?.mapId : undefined;
  return sceneId && mapId ? `${sceneId}:${mapId}` : null;
}

export const useLiveSceneKey = (): string | null => useSessionStore((s) => liveSceneKey(s.session));

/** A player's seat on a table the DM has not started: the lobby, in place of the map. */
export function isInLobby(s: SessionSlice): boolean {
  return s.you?.role === 'player' && !!s.session && tableOf(s.session).started === false;
}

export const useInLobby = (): boolean => useSessionStore(isInLobby);

export function pcDefs(tokens: TokensState | undefined): TokenDef[] {
  return Object.values(tokens?.library ?? {}).filter((d) => d.kind === 'pc');
}

/** The character a seat holds: the PC def it owns. One per seat. */
export function pcOf(tokens: TokensState | undefined, identityId: string | undefined): TokenDef | undefined {
  return identityId ? pcDefs(tokens).find((d) => d.ownerIdentityId === identityId) : undefined;
}

export type PcStatus = { kind: 'free' } | { kind: 'mine' } | { kind: 'taken'; by: string } | { kind: 'saved'; for: string };

/** Who a prepared character belongs to, as the picker says it. */
export function pcStatus(def: TokenDef, identityId: string | undefined, players: readonly PlayerInfo[]): PcStatus {
  if (def.ownerIdentityId) {
    if (def.ownerIdentityId === identityId) return { kind: 'mine' };
    return { kind: 'taken', by: players.find((p) => p.identityId === def.ownerIdentityId)?.name ?? def.ownerName ?? 'another player' };
  }
  if (def.ownerName) return { kind: 'saved', for: def.ownerName };
  return { kind: 'free' };
}

export const sendCommand = (module: string, action: string, payload: unknown): void =>
  useSessionStore.getState().sendCommand(module, action, payload);
