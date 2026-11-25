import { PROTOCOL_VERSION } from '@dnd/core/src/shared/protocol';
import type { ClientMessage, ServerMessage } from '@dnd/core/src/shared/protocol';
import { endpoints } from '../endpoints';

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface WebSocketClientOptions {
  /** Session token — presented at WS upgrade and reused verbatim on every retry. */
  token: string;
  /** Defaults to `endpoints.wsBase` (D9). Tests and C2 override it. */
  url?: string;
  onMessage?: (msg: ServerMessage) => void;
  onStatus?: (status: ConnectionStatus) => void;
  onLatency?: (ms: number) => void;
  /** Keepalive ping period; 0 disables. */
  pingIntervalMs?: number;
  /**
   * Asked when a socket closes without ever having opened: is this seat one the server will
   * never take again? The browser hides the upgrade's 401, so this is how an expired or
   * ended seat is told apart from a server that is down. The retry is scheduled either way.
   */
  isRefused?: () => Promise<boolean>;
  /** Called once when `isRefused` says yes; the client has stopped for good by then. */
  onRefused?: () => void;
}

const BACKOFF_MIN_MS = 500;
const BACKOFF_MAX_MS = 8000;
const DEFAULT_PING_MS = 10_000;

export class WebSocketClient {
  readonly #opts: WebSocketClientOptions;
  #ws: WebSocket | null = null;
  #retryTimer: ReturnType<typeof setTimeout> | null = null;
  #pingTimer: ReturnType<typeof setInterval> | null = null;
  #attempt = 0;
  #stopped = false;
  /** Bumped by `close()` and by every socket that opens, so a late refusal answer can tell it is stale. */
  #epoch = 0;
  #asking = false;

  status: ConnectionStatus = 'closed';
  latencyMs: number | null = null;

  constructor(opts: WebSocketClientOptions) {
    this.#opts = opts;
  }

  connect(): void {
    if (this.#ws) return;
    this.#stopped = false;
    this.#attempt = 0;
    this.#open('connecting');
  }

  /** Deliberate teardown: no retry follows. */
  close(): void {
    this.#stopped = true;
    this.#epoch += 1;
    if (this.#retryTimer) clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
    this.#stopPing();
    const ws = this.#ws;
    this.#ws = null;
    ws?.close();
    this.#setStatus('closed');
  }

  /** Returns false when the socket is down — S1 drops rather than queues, see below. */
  send(msg: ClientMessage): boolean {
    if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) return false;
    // ponytail: no outbound queue. Reconnect replays nothing because the server
    // answers `join` with a full snapshot (§2.5), so a dropped command is a
    // no-op the user retries. Add a queue only if a lost command ever matters.
    this.#ws.send(JSON.stringify(msg));
    return true;
  }

  ping(): void {
    this.send({ type: 'ping', t: Date.now() });
  }

  #url(): string {
    const base = this.#opts.url ?? endpoints.wsBase;
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}token=${encodeURIComponent(this.#opts.token)}`;
  }

  #open(status: ConnectionStatus): void {
    this.#setStatus(status);
    const ws = new WebSocket(this.#url());
    this.#ws = ws;
    let opened = false;

    ws.onopen = () => {
      opened = true;
      this.#epoch += 1;
      this.#attempt = 0;
      this.#setStatus('open');
      this.send({ type: 'join', protocolVersion: PROTOCOL_VERSION });
      this.#startPing();
    };
    ws.onmessage = (ev: MessageEvent) => this.#receive(ev.data);
    ws.onerror = () => ws.close(); // onclose does the retrying
    ws.onclose = () => {
      if (this.#ws !== ws) return; // superseded by close()/reconnect
      this.#ws = null;
      this.#stopPing();
      this.#scheduleRetry();
      if (!opened) this.#askIfRefused();
    };
  }

  /** One question at a time; a yes stops the client unless it was closed or got back in meanwhile. */
  #askIfRefused(): void {
    const ask = this.#opts.isRefused;
    if (!ask || this.#asking) return;
    this.#asking = true;
    const epoch = this.#epoch;
    void ask().then((refused) => {
      this.#asking = false;
      if (!refused || epoch !== this.#epoch) return;
      this.close();
      this.#opts.onRefused?.();
    });
  }

  #scheduleRetry(): void {
    if (this.#stopped) {
      this.#setStatus('closed');
      return;
    }
    const base = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** this.#attempt);
    this.#attempt += 1;
    // Equal jitter: half the window fixed, half random. Keeps a restarted server
    // from being hit by every client in the same millisecond.
    const delay = base / 2 + Math.random() * (base / 2);
    this.#setStatus('reconnecting');
    this.#retryTimer = setTimeout(() => this.#open('reconnecting'), delay);
  }

  #receive(data: unknown): void {
    if (typeof data !== 'string') return; // ponytail: text frames only; no binary protocol exists
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return; // malformed frame — drop it, the connection is still fine
    }
    if (typeof parsed !== 'object' || parsed === null) return;
    if (typeof (parsed as { type?: unknown }).type !== 'string') return;

    const msg = parsed as ServerMessage;
    if (msg.type === 'pong') {
      this.latencyMs = Date.now() - msg.t;
      this.#opts.onLatency?.(this.latencyMs);
    }
    this.#opts.onMessage?.(msg);
  }

  #setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.#opts.onStatus?.(status);
  }

  #startPing(): void {
    const period = this.#opts.pingIntervalMs ?? DEFAULT_PING_MS;
    if (period <= 0) return;
    this.ping();
    this.#pingTimer = setInterval(() => this.ping(), period);
  }

  #stopPing(): void {
    if (this.#pingTimer) clearInterval(this.#pingTimer);
    this.#pingTimer = null;
  }
}
