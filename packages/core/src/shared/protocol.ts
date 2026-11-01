// src/shared/protocol.ts
// Session wire protocol — shared by @dnd/server and @dnd/session-client.
// Pure types + one constant; no runtime deps.

import type { AnyChild, Room, WallSegment } from './types';

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

/** One layer's worth of newly available geometry, shaped to be merged by layer id. */
export interface MapDeltaLayer {
  id: string;
  rooms: Room[];
  children: AnyChild[];
  standaloneWalls: WallSegment[];
}

/**
 * §2.1/D5 — rides on the `fog` state-update that reveals the rooms it carries, so a client
 * never knows a room is revealed before it has the geometry to draw. Placement JSON only:
 * textures shipped with the asset packs at join. Written by the server's redactor
 * (`session/server/src/fog/redactMap.ts`), merged by the client's `mergeMapDelta`.
 */
export interface MapDelta {
  sceneId: string;
  layers: MapDeltaLayer[];
  /**
   * The re-cut `lockMask` (see the server's `lockMaskFor`), when this delta credits rooms — the
   * same debt D5 makes a reveal pay for geometry, for the same reason. The mask is cut against
   * the rooms a seat holds, a reveal is what grows that set, and nothing else re-cuts a
   * connected seat's document: `mergeMapDelta` patches layers and the client re-fetches only
   * on a join, a scene swap, a republish or a mode flip. Without this the newly shipped room's
   * locked ground would have art, no fence, and no correction ever coming.
   *
   * Mechanics' `RegionMask`, spelled out the way `SerializedMapData.lockMask` spells it: core
   * does not depend on mechanics, and this file stays clear of the store's DOM-typed module.
   */
  lockMask?: { minX: number; minY: number; cols: number; rows: number; bits: string };
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
  // DM seats only: a scene's prep was rewritten (`PUT /scenes/:id/prep`, or a republish
  // whose file carries prep), so the Prep panel refetches. It drops no map. Additive, so no version
  // bump: a client that does not know it ignores it and keeps the prep it already had.
  | { type: 'prep-changed'; sceneId: string }
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
