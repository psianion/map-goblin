import { create } from 'zustand';
import type { PlayerInfo, ServerMessage, SessionState } from '@dnd/core/src/shared/protocol';
import { WebSocketClient } from './WebSocketClient';
import type { ConnectionStatus } from './WebSocketClient';

// --- SyncMiddleware (§2.6) --------------------------------------------------
// ponytail: the whole middleware in S1 is a counter and a flag, because `ping`
// is the only module. Outbound commands get a monotonic `seq` so the server can
// order/ack them; inbound server messages raise `applyingRemote` for the length
// of the store mutation so anything reacting to that change knows it was
// server-driven and must not echo it back as a fresh command. S2 grows a
// per-module command map on top of this — not a different pattern.
let seq = 0;
let applyingRemote = false;

/** True while a ServerMessage is being folded into the store. */
export const isApplyingRemote = (): boolean => applyingRemote;

export interface SessionStore {
  connection: ConnectionStatus;
  you: PlayerInfo | null;
  session: SessionState | null;
  mapData: unknown | null;
  latencyMs: number | null;
  client: WebSocketClient | null;
  /** Session token, kept so REST calls (GET /api/maps/:id) can authorize. */
  token: string | null;
  /** Set by HostSetup (C2); GameTable shows it to the DM. */
  inviteCode: string | null;

  connect: (token: string, url?: string) => void;
  disconnect: () => void;
  setMapData: (data: unknown) => void;
  setInviteCode: (code: string | null) => void;
  applyServerMessage: (msg: ServerMessage) => void;
  sendCommand: (module: string, action: string, payload: unknown) => void;
}

// ponytail: plain zustand — no immer/devtools/subscribeWithSelector like the
// editor store. Session state arrives as whole snapshots (§2.5), so there is
// nothing to draft-mutate and no deep selector traffic to memoize.
export const useSessionStore = create<SessionStore>()((set, get) => ({
  connection: 'closed',
  you: null,
  session: null,
  mapData: null,
  latencyMs: null,
  client: null,
  token: null,
  inviteCode: null,

  connect: (token, url) => {
    get().client?.close();
    const client = new WebSocketClient({
      token,
      url,
      onStatus: (connection) => set({ connection }),
      onMessage: (msg) => get().applyServerMessage(msg),
      onLatency: (latencyMs) => set({ latencyMs }),
    });
    set({ client, token, connection: 'connecting' });
    client.connect();
  },

  disconnect: () => {
    get().client?.close();
    set({ client: null, token: null, connection: 'closed' });
  },

  setMapData: (mapData) => set({ mapData }),

  setInviteCode: (inviteCode) => set({ inviteCode }),

  applyServerMessage: (msg) => {
    applyingRemote = true;
    try {
      switch (msg.type) {
        case 'session-state':
          // §2.5: the snapshot replaces client state wholesale. No deltas, ever.
          set({ session: msg.state, you: msg.you });
          break;

        case 'state-update': {
          const session = get().session;
          if (!session) break; // update before the snapshot — the snapshot wins
          set({
            session: {
              ...session,
              modules: { ...session.modules, [msg.module]: msg.state },
            },
          });
          break;
        }

        case 'scene-changed': {
          const session = get().session;
          if (!session) break;
          set({ session: { ...session, activeSceneId: msg.sceneId }, mapData: null });
          break;
        }

        case 'player-joined':
        case 'player-left': {
          const session = get().session;
          if (!session) break;
          // Identity is retained on leave (§2.5) — replace in place, never remove.
          const players = session.players.some((p) => p.identityId === msg.player.identityId)
            ? session.players.map((p) =>
                p.identityId === msg.player.identityId ? msg.player : p,
              )
            : [...session.players, msg.player];
          set({ session: { ...session, players } });
          break;
        }

        default:
          // ponytail: dm-*, session-ended, error and pong land here. Nothing in
          // S1 reads them from the store — components that care add their cases.
          break;
      }
    } finally {
      applyingRemote = false;
    }
  },

  sendCommand: (module, action, payload) => {
    if (applyingRemote) return; // inbound-driven change: never round-trips back
    seq += 1;
    get().client?.send({ type: 'command', module, action, payload, seq });
  },
}));
