// The lobby (table lobby pass, plan 3.6 and 3.7): what the `table` slice says about it, and
// each seat's character, read the same way by the player's lobby and the DM's roster.

import { useMemo } from 'react';
import type { PlayerInfo, SessionState } from '@dnd/core/src/shared/protocol';
import { TABLE_INITIAL, type TableState } from '@dnd/mechanics/table';
import type { PartyStartArea, TokenDef, TokensState } from '@dnd/mechanics/tokens';
import { useSessionStore } from '../../session/store';
import { useActiveTool } from '../../session/tools';
import { sceneTokens } from '../../modules/tokens/play';

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

const NO_PLAYERS: readonly PlayerInfo[] = [];

/** Every seat at the table. One empty list while the session is still on its way, so the store never sees a fresh array per read. */
export const useRoster = (): readonly PlayerInfo[] => useSessionStore((s) => s.session?.players ?? NO_PLAYERS);

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

/** The DM hands `seat` the character `defId`, or none; the one it held goes back to the pool. */
export function handCharacter(seat: PlayerInfo, defId: string | null, tokens: TokensState | undefined, sceneId: string | null): void {
  const held = pcOf(tokens, seat.identityId);
  if (held && held.id !== defId) sendCommand('tokens', 'library-upsert', { id: held.id, ownerIdentityId: null, ownerName: null });
  if (!defId || held?.id === defId) return;
  sendCommand('tokens', 'library-upsert', { id: defId, ownerIdentityId: seat.identityId, ownerName: seat.name });
  // A character already standing on the live scene is the seat's to move straight away.
  for (const t of sceneTokens(tokens, sceneId)) if (t.defId === defId) sendCommand('tokens', 'assign', { id: t.id, identityId: seat.identityId });
}

export type Cell = { x: number; y: number };

/** The cells between two corners, corners included, whichever way the drag went. */
export function cellRect(a: Cell, b: Cell): PartyStartArea {
  return { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
}

/** Arm the party start tool: the next drag on the DM's map sets the live scene's area. */
export const armPartyStart = (): void => useActiveTool.getState().setActiveTool('party-start');
