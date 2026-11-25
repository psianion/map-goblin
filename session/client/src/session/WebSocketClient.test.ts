// @vitest-environment node
//
// Not jsdom: vitest's jsdom env leaves Node's (undici) WebSocket as the global
// while replacing globalThis.Event, so undici dispatches a jsdom Event into a
// Node EventTarget and throws.
//
// The client runs on the `ws` client rather than Node's built-in WebSocket: on a
// refused handshake Node 22's (undici 6) fires error, stays CONNECTING and never
// fires close, while browsers and Node 24 fire error then close. `ws` does the
// browser thing on every Node.
import { PROTOCOL_VERSION } from '@dnd/core/src/shared/protocol';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebSocket as WsClient, WebSocketServer } from 'ws';
import type { WebSocket as WsSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import type { PlayerInfo, SessionState } from '@dnd/core/src/shared/protocol';
import { resumeSeat, useSessionStore } from './store';
import { WebSocketClient } from './WebSocketClient';

const ME: PlayerInfo = { identityId: 'i1', name: 'Rue', role: 'dm', connected: true };

const SNAPSHOT: SessionState = {
  protocolVersion: PROTOCOL_VERSION,
  sessionId: 's1',
  campaignId: 'c1',
  activeSceneId: null,
  scenes: [{ id: 'm1', name: 'Cragmaw', mapId: 'm1' }],
  players: [ME],
  modules: {},
};

interface Conn {
  socket: WsSocket;
  token: string | null;
}

function startServer() {
  // A refusing server answers the upgrade 401, the way an expired or ended seat is turned away.
  let refusing = false;
  let attempts = 0;
  const wss = new WebSocketServer({
    host: '127.0.0.1',
    port: 0,
    verifyClient: (_info, done) => {
      attempts += 1;
      done(!refusing, 401);
    },
  });
  const conns: Conn[] = [];

  wss.on('connection', (socket, req) => {
    const token = new URL(req.url ?? '/', 'ws://x').searchParams.get('token');
    conns.push({ socket, token });
  });

  const ready = new Promise<string>((resolve) => {
    wss.on('listening', () => {
      const { port } = wss.address() as AddressInfo;
      resolve(`ws://127.0.0.1:${port}/ws`);
    });
  });

  return {
    conns,
    ready,
    refuse: (on: boolean) => void (refusing = on),
    /** Every upgrade asked for, accepted or refused. */
    attempts: () => attempts,
    /** Resolves once connection #n (1-based) has arrived. */
    nth: (n: number) => vi.waitFor(() => {
      expect(conns.length).toBeGreaterThanOrEqual(n);
      return conns[n - 1];
    }, { timeout: 4000, interval: 20 }),
    close: () => new Promise<void>((resolve) => wss.close(() => resolve())),
  };
}

class BrowserLikeWebSocket extends WsClient {
  constructor(url: string) {
    super(url);
    // A browser ignores an unhandled error event; ws's EventEmitter would throw it.
    this.on('error', () => {});
  }
}

const nodeWebSocket = globalThis.WebSocket;
beforeAll(() => {
  globalThis.WebSocket = BrowserLikeWebSocket as unknown as typeof WebSocket;
});
afterAll(() => {
  globalThis.WebSocket = nodeWebSocket;
});

let server: ReturnType<typeof startServer> | null = null;

afterEach(async () => {
  useSessionStore.getState().disconnect();
  useSessionStore.setState({
    you: null,
    session: null,
    mapData: null,
    latencyMs: null,
    sessionEnded: false,
    seatRefused: false,
  });
  await server?.close();
  server = null;
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('a seat the server refuses', () => {
  let client: WebSocketClient | null = null;
  afterEach(() => {
    client?.close();
    client = null;
  });

  it('stops for good when a socket that never opened is refused', async () => {
    server = startServer();
    server.refuse(true);
    const url = await server.ready;
    const isRefused = vi.fn().mockResolvedValue(true);
    const onRefused = vi.fn();
    client = new WebSocketClient({ token: 'tok-gone', url, isRefused, onRefused });
    client.connect();

    await vi.waitFor(() => expect(onRefused).toHaveBeenCalledTimes(1));
    // Count from the refusal: the retry would have landed inside 500ms, and none does.
    const asked = server.attempts();
    await wait(900);
    expect(server.attempts()).toBe(asked);
    expect(client.status).toBe('closed');
    expect(isRefused).toHaveBeenCalledTimes(1);
    expect(onRefused).toHaveBeenCalledTimes(1);
  });

  it('keeps retrying when the seat is still good', async () => {
    server = startServer();
    server.refuse(true);
    const url = await server.ready;
    const isRefused = vi.fn().mockResolvedValue(false);
    const onRefused = vi.fn();
    client = new WebSocketClient({ token: 'tok-down', url, isRefused, onRefused });
    client.connect();

    // Asked once per failed open, so a second question is a second socket.
    await vi.waitFor(() => expect(isRefused.mock.calls.length).toBeGreaterThanOrEqual(2), { timeout: 4000, interval: 20 });
    expect(onRefused).not.toHaveBeenCalled();
    expect(client.status).not.toBe('closed');
  });

  it('asks one question at a time', async () => {
    server = startServer();
    server.refuse(true);
    const url = await server.ready;
    const isRefused = vi.fn(() => new Promise<boolean>(() => {})); // never answers
    client = new WebSocketClient({ token: 'tok-slow', url, isRefused });
    client.connect();

    await vi.waitFor(() => expect(server!.attempts()).toBeGreaterThanOrEqual(3), { timeout: 4000, interval: 20 });
    expect(isRefused).toHaveBeenCalledTimes(1);
  });

  it('does not ask after a drop from an open socket, only once a reopen fails', async () => {
    server = startServer();
    const url = await server.ready;
    const isRefused = vi.fn().mockResolvedValue(true);
    const onRefused = vi.fn();
    const statuses: string[] = [];
    client = new WebSocketClient({ token: 'tok-drop', url, isRefused, onRefused, onStatus: (s) => statuses.push(s) });
    client.connect();
    const first = await server.nth(1);
    await vi.waitFor(() => expect(client!.status).toBe('open'));

    server.refuse(true);
    first.socket.terminate();
    await vi.waitFor(() => expect(client!.status).toBe('reconnecting'));
    expect(isRefused).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(onRefused).toHaveBeenCalledTimes(1));
    expect(isRefused).toHaveBeenCalledTimes(1);
    expect(client.status).toBe('closed');
    const asked = server.attempts();
    await wait(900);
    expect(server.attempts()).toBe(asked);
  });

  it('does not close a still-connecting socket on error, which would fire error again', () => {
    // Closing a CONNECTING socket fails it and fires error again, the way Node 22 does.
    const sockets: FakeSocket[] = [];
    class FakeSocket {
      static OPEN = 1;
      readyState = 0;
      onopen: (() => void) | null = null;
      onmessage: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      constructor() {
        sockets.push(this);
      }
      close() {
        this.onerror?.();
      }
    }
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
    try {
      client = new WebSocketClient({ token: 'tok-err', url: 'ws://x' });
      client.connect();
      const socket = sockets[0]!;
      expect(() => socket.onerror?.()).not.toThrow();
      socket.onclose?.();
      expect(client.status).toBe('reconnecting');
    } finally {
      globalThis.WebSocket = BrowserLikeWebSocket as unknown as typeof WebSocket;
    }
  });
});

describe('WebSocketClient', () => {
  it('connects with the token and populates the store from session-state', async () => {
    server = startServer();
    const url = await server.ready;

    useSessionStore.getState().connect('tok-abc', url);
    const conn = await server.nth(1);

    expect(conn.token).toBe('tok-abc');
    await vi.waitFor(() => expect(useSessionStore.getState().connection).toBe('open'));

    conn.socket.send(JSON.stringify({ type: 'session-state', state: SNAPSHOT, you: ME }));
    await vi.waitFor(() => {
      expect(useSessionStore.getState().session?.sessionId).toBe('s1');
    });
    expect(useSessionStore.getState().you).toEqual(ME);

    // state-update replaces just that module slice, leaving the snapshot intact
    conn.socket.send(JSON.stringify({ type: 'state-update', module: 'ping', state: { n: 3 } }));
    await vi.waitFor(() => {
      expect(useSessionStore.getState().session?.modules.ping).toEqual({ n: 3 });
    });
    expect(useSessionStore.getState().session?.scenes).toHaveLength(1);
  });

  it('reconnects with the same token after the server drops the socket', async () => {
    server = startServer();
    const url = await server.ready;

    useSessionStore.getState().connect('tok-resume', url);
    const first = await server.nth(1);
    await vi.waitFor(() => expect(useSessionStore.getState().connection).toBe('open'));

    const droppedAt = Date.now();
    first.socket.terminate();
    await vi.waitFor(() => expect(useSessionStore.getState().connection).toBe('reconnecting'));

    const second = await server.nth(2);
    expect(second.token).toBe('tok-resume');
    // 0.5s base with equal jitter → never faster than 250ms
    expect(Date.now() - droppedAt).toBeGreaterThanOrEqual(240);

    // resumed connection serves a fresh snapshot, store repopulates
    second.socket.send(JSON.stringify({ type: 'session-state', state: SNAPSHOT, you: ME }));
    await vi.waitFor(() => {
      expect(useSessionStore.getState().connection).toBe('open');
      expect(useSessionStore.getState().session?.sessionId).toBe('s1');
    });
  });

  it('ignores malformed frames without dropping the connection', async () => {
    server = startServer();
    const url = await server.ready;

    useSessionStore.getState().connect('tok-junk', url);
    const conn = await server.nth(1);
    await vi.waitFor(() => expect(useSessionStore.getState().connection).toBe('open'));

    conn.socket.send('not json {');
    conn.socket.send('42');
    conn.socket.send('null');
    conn.socket.send(JSON.stringify({ noTypeField: true }));
    conn.socket.send(JSON.stringify({ type: 'session-state', state: SNAPSHOT, you: ME }));

    await vi.waitFor(() => expect(useSessionStore.getState().session?.sessionId).toBe('s1'));
    expect(useSessionStore.getState().connection).toBe('open');
    expect(server.conns).toHaveLength(1); // no reconnect happened
  });

  it('stops retrying for good once the session has ended', async () => {
    server = startServer();
    const url = await server.ready;

    useSessionStore.getState().connect('tok-ended', url);
    const conn = await server.nth(1);
    await vi.waitFor(() => expect(useSessionStore.getState().connection).toBe('open'));

    // The server announces, then drops the socket (SessionManager#endSession).
    conn.socket.send(JSON.stringify({ type: 'session-ended' }));
    await vi.waitFor(() => expect(useSessionStore.getState().sessionEnded).toBe(true));
    conn.socket.terminate();

    // A transient drop would be back inside 500ms (0.5s base, equal jitter). This is not
    // a transient drop: no second socket, and the UI can tell the two apart.
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(server.conns).toHaveLength(1);
    expect(useSessionStore.getState().connection).toBe('closed');
    expect(useSessionStore.getState().sessionEnded).toBe(true);
  });
});

describe('seat persistence (reload survival)', () => {
  // This file runs in the node env (see header) — stub the one Web Storage API
  // the seat uses. The store's own try/catch covers environments without it.
  const backing = new Map<string, string>();
  beforeAll(() => {
    (globalThis as Record<string, unknown>).sessionStorage = {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => void backing.set(k, v),
      removeItem: (k: string) => void backing.delete(k),
    };
  });
  afterAll(() => {
    delete (globalThis as Record<string, unknown>).sessionStorage;
  });
  afterEach(() => {
    backing.clear();
    vi.unstubAllGlobals();
  });

  it('resumes the same token and invite code after the store lost everything', async () => {
    server = startServer();
    const url = await server.ready;

    useSessionStore.getState().setInviteCode('ZZTOP1');
    useSessionStore.getState().connect('tok-seat', url);
    await server.nth(1);

    // A reload wipes the in-memory store but not sessionStorage. The old client
    // object is orphaned exactly like a reload orphans its socket.
    const orphan = useSessionStore.getState().client;
    useSessionStore.setState({ client: null, token: null, inviteCode: null, connection: 'closed' });
    orphan?.close();

    resumeSeat();
    const conn = await server.nth(2);
    expect(conn.token).toBe('tok-seat');
    expect(useSessionStore.getState().inviteCode).toBe('ZZTOP1');
  });

  it('clears the seat on session-ended so a dead session is not resumed', async () => {
    server = startServer();
    const url = await server.ready;

    useSessionStore.getState().connect('tok-dead', url);
    const conn = await server.nth(1);
    conn.socket.send(JSON.stringify({ type: 'session-ended' }));
    await vi.waitFor(() => expect(useSessionStore.getState().sessionEnded).toBe(true));

    expect(backing.has('mg-seat')).toBe(false);
    resumeSeat();
    expect(useSessionStore.getState().client).toBeNull();
  });

  it('gives up a seat the server refuses, clears it, and does not resume it', async () => {
    server = startServer();
    server.refuse(true);
    const url = await server.ready;
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, json: () => Promise.resolve({ error: 'seat refused' }) });
    vi.stubGlobal('fetch', fetchMock);

    useSessionStore.getState().connect('tok-expired', url);
    await vi.waitFor(() => expect(useSessionStore.getState().seatRefused).toBe(true));

    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toMatch(/\/api\/seat\/refresh$/);
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok-expired' });
    expect(useSessionStore.getState()).toMatchObject({ client: null, connection: 'closed', token: 'tok-expired' });
    expect(backing.has('mg-seat')).toBe(false);

    const asked = server.attempts();
    backing.set('mg-seat', JSON.stringify({ token: 'tok-expired', url, inviteCode: null }));
    resumeSeat();
    expect(useSessionStore.getState().client).toBeNull();
    await wait(900);
    expect(server.attempts()).toBe(asked);
  });
});
