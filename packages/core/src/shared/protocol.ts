// src/shared/protocol.ts
// Session wire protocol — shared by @dnd/server and @dnd/session-client.
// Pure types + one constant; no runtime deps.

export const PROTOCOL_VERSION = 1;

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
  /** Metadata only — map data fetched via HTTP. */
  scenes: { id: string; name: string }[];
  players: PlayerInfo[];
  /** Empty in S1; module slices from S2. */
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
  | { type: 'scene-changed'; sceneId: string }
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
