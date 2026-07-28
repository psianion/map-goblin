// D9 — the Discord Activity seam.
// EVERY network URL in this package (WS, REST, assets) is built from this object;
// nothing else may hardcode a host. Discord Activities force all traffic through
// the iframe's `/.proxy/*` mapping, so porting = rewriting these three strings.

const env = import.meta.env as Record<string, string | undefined>;

// `location` is absent under vitest's node environment; the fallback only keeps
// this module importable there — real values come from the browser or VITE_* env.
const loc = globalThis.location ?? { protocol: 'http:', host: 'localhost' };
const origin = `${loc.protocol}//${loc.host}`;
const wsOrigin = `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host}`;

export interface Endpoints {
  /** Base for REST calls, no trailing slash. */
  httpBase: string;
  /** Full WS URL; WebSocketClient appends `?token=`. */
  wsBase: string;
  /** Base for map textures / static assets, no trailing slash. */
  assetBase: string;
}

/** Mutable on purpose: HostSetup/JoinSession (C2) point this at a typed-in server. */
export const endpoints: Endpoints = {
  httpBase: env.VITE_HTTP_BASE ?? origin,
  wsBase: env.VITE_WS_BASE ?? `${wsOrigin}/ws`,
  assetBase: env.VITE_ASSET_BASE ?? origin,
};

/**
 * Point REST + WS at the server the DM typed in (HostSetup, C2). One entry point so
 * the socket URL can never drift from the REST one. Throws on a URL the browser
 * cannot parse — the caller turns that into a readable message.
 *
 * ponytail: `assetBase` is deliberately left alone. The game server serves no texture
 * packs in S1 (vite's publicDir does), so retargeting it would break the renderer.
 */
export function setServerUrl(url: string): void {
  // `localhost:8787` is a valid URL whose *protocol* is `localhost:` — so a bare
  // host:port would sail through and produce a nonsense base. Assume http:// unless
  // a scheme is spelled out, which also makes the thing a DM types first just work.
  const trimmed = url.trim();
  const parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`);
  endpoints.httpBase = `${parsed.protocol}//${parsed.host}`;
  endpoints.wsBase = `${parsed.protocol === 'https:' ? 'wss:' : 'ws:'}//${parsed.host}/ws`;
}
