// src/shared/protocol.ts
// Session wire protocol — shared by @dnd/server and @dnd/session-client.
// Pure types + one constant; no runtime deps.

export const PROTOCOL_VERSION = 5;
// `modules` gains { fog: FogState, doors: DoorsState } in snapshots, redacted per viewer.
// A fog `state-update` may carry a `mapDelta` field: the map slices of the rooms that
// change just made available to that viewer (S3 D5).
// v4 (M4) — `modules` gains { triggers: TriggersState }, redacted per viewer: a player's
// slice holds only prompts/log lines addressed to them, never a trigger definition or which
// ones have fired.
// v5 — `modules` gains { initiative: InitiativeState }, unredacted: the tracker is the one
// thing every seat at the table has to read the same way. A client that does not know the
// slice would sit through a whole fight with no tracker and no way to say it was missing
// one, which is what the version gate is for.

export type Role = 'dm' | 'player';

export interface PlayerInfo {
  identityId: string;
  name: string;
  role: Role;
  connected: boolean;
}

export interface SessionState {
  protocolVersion: number;
  sessionId: string;
  campaignId: string;
  activeSceneId: string | null;
  /** Metadata only — map data fetched via HTTP. `mapId` changes when a scene is republished. */
  scenes: { id: string; name: string; mapId: string }[];
  players: PlayerInfo[];
  /** Per-module slices, redacted for the viewer receiving them (S2, D4). */
  modules: Record<string, unknown>;
}

export type ClientMessage =
  // Token already presented at WS upgrade.
  | { type: 'join'; protocolVersion: number }
  | { type: 'command'; module: string; action: string; payload: unknown; seq: number }
  | { type: 'ping'; t: number };

export type ServerMessage =
  // Full snapshot (join/reconnect).
  | { type: 'session-state'; state: SessionState; you: PlayerInfo }
  | { type: 'state-update'; module: string; state: unknown }
  // `mapId` lets a client key its map cache on (sceneId, mapId): a republish of the
  // active scene re-broadcasts the same sceneId with a new mapId.
  | { type: 'scene-changed'; sceneId: string; mapId: string }
  | { type: 'player-joined' | 'player-left'; player: PlayerInfo }
  | { type: 'dm-disconnected' }
  | { type: 'dm-reconnected' }
  | { type: 'session-ended' }
  | {
      type: 'error';
      code: 'protocol-mismatch' | 'unauthorized' | 'invalid-command' | 'banned';
      message: string;
    }
  | { type: 'pong'; t: number };
