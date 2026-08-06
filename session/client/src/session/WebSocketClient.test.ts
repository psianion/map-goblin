// @vitest-environment node
//
// Not jsdom: vitest's jsdom env leaves Node's (undici) WebSocket as the global
// while replacing globalThis.Event, so undici dispatches a jsdom Event into a
// Node EventTarget and throws. Node 22's WebSocket is the same WHATWG API this
// client uses in the browser, so the node env tests the real thing.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import type { WebSocket as WsSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import type { PlayerInfo, SessionState } from '@dnd/core/src/shared/protocol';
import { resumeSeat, useSessionStore } from './store';

const ME: PlayerInfo = { identityId: 'i1', name: 'Rue', role: 'dm', connected: true };

const SNAPSHOT: SessionState = {
  protocolVersion: 2,
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
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
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
    /** Resolves once connection #n (1-based) has arrived. */
    nth: (n: number) => vi.waitFor(() => {
      expect(conns.length).toBeGreaterThanOrEqual(n);
      return conns[n - 1];
    }, { timeout: 4000, interval: 20 }),
    close: () => new Promise<void>((resolve) => wss.close(() => resolve())),
  };
}

let server: ReturnType<typeof startServer> | null = null;

afterEach(async () => {
  useSessionStore.getState().disconnect();
  useSessionStore.setState({
    you: null,
    session: null,
    mapData: null,
    latencyMs: null,
    sessionEnded: false,
  });
  await server?.close();
  server = null;
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
  afterEach(() => backing.clear());

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
});
