import { create } from 'zustand';
import type { PlayerInfo, Role, ServerMessage, SessionState } from '@dnd/core/src/shared/protocol';
import type { SerializedMapData } from '@dnd/core/src/store/types';
import { mergeMapDelta, invalidateSceneDocs, type MapDelta } from './loadSceneMap';
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

/**
 * The last refusal the server sent. Kept as data rather than turned into UI here: the
 * shell has no idea what `door-locked` means, and the module that issued the command
 * does. `at` makes a repeat of the same refusal a new object, so a module watching this
 * sees the second locked door too.
 */
export interface ServerError {
  code: 'protocol-mismatch' | 'unauthorized' | 'invalid-command' | 'banned';
  message: string;
  at: number;
}

/** A join/leave line for GameLog — derived here, never sent by the server. */
export interface PresenceEvent {
  id: string;
  at: number;
  name: string;
  kind: 'joined' | 'left';
}

export interface SessionStore {
  connection: ConnectionStatus;
  /**
   * The DM ended the table. Terminal: the socket will not come back, so this is what
   * tells "the session is over" apart from `connection: 'closed'` after a transient drop.
   * ponytail: a flag beside `connection`, not a fifth `ConnectionStatus` — the status
   * union is the transport's, and `session-ended` is not a transport event.
   */
  sessionEnded: boolean;
  you: PlayerInfo | null;
  session: SessionState | null;
  /** Roster changes seen this tab's lifetime, oldest first, capped. */
  presence: PresenceEvent[];
  mapData: unknown | null;
  /**
   * Which scene (and which published map of it) `mapData` actually belongs to. The active
   * scene can run ahead of this — `scene-changed` flips `activeSceneId` immediately, the
   * document follows once `swapSceneMap` lands it — so anything folding geometry into
   * `mapData` must key on this, never on `activeSceneId` (the F2 race).
   */
  loadedScene: { sceneId: string; mapId: string } | null;
  /**
   * Splat PNG blobs fetched over the binary image endpoint alongside `mapData`
   * — the document itself no longer carries them as base64. Handed to core's
   * `loadFromFile` with the document so they land in the same store pass.
   */
  splatPngs: [Blob | null, Blob | null];
  /** Most recent server refusal; modules interpret it (see `useDoorFeedback`). */
  lastError: ServerError | null;
  latencyMs: number | null;
  client: WebSocketClient | null;
  /** Session token, kept so REST calls (GET /api/maps/:id) can authorize. */
  token: string | null;
  /** Set by HostSetup (C2); GameTable shows it to the DM. */
  inviteCode: string | null;

  connect: (token: string, url?: string) => void;
  disconnect: () => void;
  setMapData: (
    data: unknown,
    splatPngs?: [Blob | null, Blob | null],
    loadedScene?: { sceneId: string; mapId: string },
  ) => void;
  setInviteCode: (code: string | null) => void;
  applyServerMessage: (msg: ServerMessage) => void;
  sendCommand: (module: string, action: string, payload: unknown) => void;
}

// The seat survives a refresh: per-tab (sessionStorage dies with the tab, so two
// tabs stay two identities), cleared on explicit disconnect and on session-ended.
const SEAT_KEY = 'mg-seat';
interface SavedSeat {
  token: string;
  url?: string;
  inviteCode: string | null;
}
function saveSeat(seat: SavedSeat): void {
  try {
    sessionStorage.setItem(SEAT_KEY, JSON.stringify(seat));
  } catch {
    /* storage unavailable — the seat just won't survive a refresh */
  }
}
function clearSeat(): void {
  try {
    sessionStorage.removeItem(SEAT_KEY);
  } catch {
    /* ditto */
  }
}

// ponytail: plain zustand — no immer/devtools/subscribeWithSelector like the
// editor store. Session state arrives as whole snapshots (§2.5), so there is
// nothing to draft-mutate and no deep selector traffic to memoize.
export const useSessionStore = create<SessionStore>()((set, get) => ({
  connection: 'closed',
  sessionEnded: false,
  you: null,
  session: null,
  presence: [],
  mapData: null,
  loadedScene: null,
  splatPngs: [null, null],
  lastError: null,
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
    set({ client, token, connection: 'connecting', sessionEnded: false });
    saveSeat({ token, url, inviteCode: get().inviteCode });
    client.connect();
  },

  disconnect: () => {
    get().client?.close();
    clearSeat();
    set({ client: null, token: null, connection: 'closed' });
  },

  setMapData: (mapData, splatPngs, loadedScene) =>
    set({
      mapData,
      ...(splatPngs ? { splatPngs } : {}),
      ...(loadedScene ? { loadedScene } : {}),
    }),

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
          // D5: a fog update that reveals rooms carries their geometry in the same message,
          // so there is no frame in which this client knows a room is revealed and has
          // nothing to draw for it. One `set`, because that atomicity *is* the guarantee.
          //
          // Keyed on `loadedScene`, not `activeSceneId`: during a scene switch the active id
          // has already flipped while the *outgoing* document is still in hand, and a delta
          // for the incoming scene must not merge into it (F2). The dropped delta costs
          // nothing — the swap's fetch answers with the post-reveal document anyway. It does
          // make any *cached* copy of that scene stale, so the cache entry goes too.
          const delta = (msg as { mapDelta?: MapDelta }).mapDelta;
          const loadedSceneId = get().loadedScene?.sceneId ?? null;
          if (delta && delta.sceneId !== loadedSceneId) invalidateSceneDocs(delta.sceneId);
          const mapData = delta
            ? mergeMapDelta(
                get().mapData as SerializedMapData | null,
                delta,
                get().you?.role,
                loadedSceneId,
              )
            : get().mapData;
          set({
            session: {
              ...session,
              modules: { ...session.modules, [msg.module]: msg.state },
            },
            mapData,
          });
          break;
        }

        case 'scene-changed': {
          const session = get().session;
          if (!session) break;
          // The held document stays: GameRenderer sees active ≠ loaded and swaps to the new
          // scene's document without ever rendering nothing (F1). `mapId` keeps the scene
          // list honest when the change is a republish of the scene being played.
          const scenes = session.scenes.map((s) =>
            s.id === msg.sceneId ? { ...s, mapId: msg.mapId } : s,
          );
          set({ session: { ...session, activeSceneId: msg.sceneId, scenes } });
          break;
        }

        case 'player-joined':
        case 'player-left': {
          const session = get().session;
          if (!session) break;
          // Identity is retained on leave (§2.5) — replace in place, never remove.
          const known = session.players.find((p) => p.identityId === msg.player.identityId);
          const players = known
            ? session.players.map((p) =>
                p.identityId === msg.player.identityId ? msg.player : p,
              )
            : [...session.players, msg.player];
          // §2.4.3 — a log line only when presence actually changed. A re-`join`
          // (SessionControls' snapshot refetch) re-announces someone already
          // connected; that is not an arrival and must not read as one.
          const changed = known?.connected !== msg.player.connected;
          const presence = changed
            ? [
                ...get().presence,
                {
                  id: `${msg.player.identityId}:${Date.now()}`,
                  at: Date.now(),
                  name: msg.player.name,
                  kind: msg.player.connected ? ('joined' as const) : ('left' as const),
                },
              ].slice(-100)
            : get().presence;
          set({ session: { ...session, players }, presence });
          break;
        }

        case 'session-ended':
          // Terminal. Retrying is pointless — the session is gone, so the upgrade
          // would 401 forever and the UI would sit on "reconnecting" for good.
          get().client?.close();
          clearSeat();
          set({ client: null, sessionEnded: true, connection: 'closed' });
          break;

        case 'error':
          // Recorded, never rendered from here — the module whose command was refused owns
          // the wording. A locked door is the DM's drama, not a stack trace.
          set({ lastError: { code: msg.code, message: msg.message, at: Date.now() } });
          break;

        default:
          // ponytail: dm-* and pong land here. Nothing reads them from the store —
          // components that care add their cases.
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

// --- Selectors (D8) ---------------------------------------------------------
// The two hooks module UI is allowed to know about. Everything a rolls/tokens
// panel needs — "who am I" and "what is my module's state" — comes from here, so
// modules never reach into the store shape and the shape stays free to change.

/** Your role at this table; `undefined` until the join snapshot lands. */
export const useRole = (): Role | undefined => useSessionStore((s) => s.you?.role);

/**
 * A module's slice of the session snapshot, already redacted for you by the
 * server (D4). `undefined` before the snapshot arrives or if the module is not
 * registered server-side — callers render an empty state, they never assume.
 */
export const useModuleState = <T,>(moduleName: string): T | undefined =>
  useSessionStore((s) => s.session?.modules[moduleName] as T | undefined);

/**
 * Resolves with the first `session-state` snapshot (immediately if one already landed),
 * or `null` if none arrives within `timeoutMs`. `connect()` only opens the socket — the
 * snapshot (§2.5, `activeSceneId` + `scenes` included) follows async over the wire — so
 * JoinSession's prefetch has to wait for it before it knows what to warm.
 */
export function waitForSessionSnapshot(timeoutMs = 5000): Promise<SessionState | null> {
  const existing = useSessionStore.getState().session;
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsub();
      resolve(null);
    }, timeoutMs);
    const unsub = useSessionStore.subscribe((state) => {
      if (state.session) {
        clearTimeout(timer);
        unsub();
        resolve(state.session);
      }
    });
  });
}

/**
 * Reconnect with the seat a refresh threw away. No-op when already connected,
 * after session-ended, or with nothing saved. ponytail: a seat whose session
 * ended while the tab was mid-reload shows "reconnecting" until re-navigation —
 * detecting that needs an upgrade-401 signal the ws API doesn't expose.
 */
export function resumeSeat(): void {
  const store = useSessionStore.getState();
  if (store.client || store.sessionEnded) return;
  try {
    const raw = sessionStorage.getItem(SEAT_KEY);
    if (!raw) return;
    const seat = JSON.parse(raw) as SavedSeat;
    if (typeof seat.token !== 'string') return;
    if (seat.inviteCode) store.setInviteCode(seat.inviteCode);
    store.connect(seat.token, seat.url);
  } catch {
    /* corrupted or unavailable seat: land on the lobby instead of crashing */
  }
}
