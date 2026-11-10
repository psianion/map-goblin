// src/io/publish.ts
// Client-side plumbing for "publish to table": the map content hash used to tell a
// prep-only edit from a real map change, DM-token storage, and thin wrappers over the
// session server's /api/campaigns + /api/scenes routes. All requests are same-origin
// `/api/...` — the vite dev proxy (vite.config.ts) and prod nginx both route it.
//
// The admin pass is NEVER stored here or anywhere else: it lives in usePublishFlow's
// state (publishFlow.ts) for the lifetime of the connect step and is discarded once a DM
// token comes back.

import type { ScenePrep, SerializedMapData } from '@/store/types';
import type { PublishRecord } from './mapIndexDB';
import { hashMapBytes, sha256Hex } from './mapFormat';
import { getSaveWorker, callSaveWorker } from './saveLoad';

// ─── Map hash ─────────────────────────────────────────────────────────────

/**
 * A content hash for "has this map changed since the last publish".
 *
 * `prep` is stripped before hashing: a prep-only edit must not look like a map change,
 * or the cheap prep-only PUT path (publishScene vs. putScenePrep) never fires and every
 * trigger tweak re-uploads the whole map. Prep changes are tracked separately by
 * `hashPrep`. Hashing the pre-gzip JSON — not `serializeToBytes`'s compressed output —
 * also sidesteps any nondeterminism a compressor could introduce between two runs of
 * the same document.
 *
 * `splats` are the map's terrain splat PNGs (store.terrainSplats.pngs — same source
 * serializeToBytes reads). They ride outside `getSerializableState()` and only get
 * folded into `customImages` at encode time (mapFormat.ts), so a paint stroke that
 * doesn't touch any other field must still change this hash — otherwise the dialog
 * reports "no changes" while the table keeps stale terrain forever.
 *
 * The actual stringify + hash runs in the save worker (hashMapBytes, mapFormat.ts) —
 * on a multi-layer painted map that work is seconds of main-thread blocking, same as
 * serializeToBytes before it moved off-thread. Falls back to the pure function inline
 * where there's no Worker (vitest).
 */
export async function hashMapForPublish(
  data: SerializedMapData,
  splats: (Blob | null)[] = [],
): Promise<string> {
  const splatBuffers = await Promise.all(splats.map((png) => (png ? png.arrayBuffer() : null)));
  const worker = getSaveWorker();
  if (!worker) {
    return hashMapBytes(data, splatBuffers.map((b) => (b ? new Uint8Array(b) : null)));
  }
  const transfer = splatBuffers.filter((b): b is ArrayBuffer => b !== null);
  const reply = await callSaveWorker(worker, { op: 'hash', data, splats: splatBuffers }, transfer);
  return reply.hash!;
}

/** A content hash for "has scene prep changed since the last publish". */
export async function hashPrep(prep: ScenePrep | undefined): Promise<string> {
  return sha256Hex(new TextEncoder().encode(JSON.stringify(prep ?? null)));
}

// ─── DM token storage ───────────────────────────────────────────────────────
// The admin pass mints a DM token; the token — never the pass — is what persists,
// scoped per campaign so a table with more than one campaign keeps them apart.

function tokenKey(campaignId: string): string {
  return `goblin.publish.token.${campaignId}`;
}

export function getPublishToken(campaignId: string): string | null {
  return localStorage.getItem(tokenKey(campaignId));
}

export function setPublishToken(campaignId: string, token: string): void {
  localStorage.setItem(tokenKey(campaignId), token);
}

export function clearPublishToken(campaignId: string): void {
  localStorage.removeItem(tokenKey(campaignId));
}

/** The campaign a map was last published to, from its publish record; null if never. */
export function lastPublishedTo(record: PublishRecord | null): string | null {
  const last = Object.values(record ?? {}).sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))[0];
  return last ? (last.campaignName ?? 'a campaign') : null;
}

/** A DM token is refreshed once it has less than this left (decision 12). */
export const REFRESH_WITHIN_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * When a token expires, ms since epoch, read off its payload (JSON before the signature);
 * null for anything that does not read as one. Only the server can trust it; the client
 * only uses it to decide when to ask for a fresh one.
 */
export function tokenExp(token: string): number | null {
  try {
    const payload = token.split('.')[0]!.replace(/-/g, '+').replace(/_/g, '/');
    const exp = (JSON.parse(atob(payload)) as { exp?: unknown }).exp;
    return typeof exp === 'number' ? exp : null;
  } catch {
    return null;
  }
}

/**
 * On load: every stored DM token with under a week left is swapped for a fresh one. One
 * that has run out is left for the publish dialog to report; a failed refresh changes
 * nothing, so a server that is down today costs no token.
 */
export async function refreshPublishTokens(now = Date.now()): Promise<void> {
  const prefix = tokenKey('');
  const campaignIds: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(prefix)) campaignIds.push(key.slice(prefix.length));
  }
  await Promise.all(
    campaignIds.map(async (campaignId) => {
      const token = getPublishToken(campaignId);
      const exp = token ? tokenExp(token) : null;
      if (!token || exp === null || exp <= now || exp - now >= REFRESH_WITHIN_MS) return;
      try {
        const fresh = await refreshDmToken(token, campaignId);
        setPublishToken(campaignId, fresh.token);
      } catch {
        /* kept as it is; the next load tries again */
      }
    }),
  );
}

// ─── Server calls ───────────────────────────────────────────────────────────

export interface CampaignSummary {
  id: string;
  name: string;
}

/** Thrown on a 401 from any publish call — the caller drops the stored token and re-connects. */
export class PublishAuthError extends Error {}

/** Thrown on a 404 from republish or prep — the scene was deleted at the table. */
export class PublishGoneError extends Error {}

/**
 * A fetch that never got an answer, or a 5xx with no JSON `error` of the server's own:
 * the vite proxy's 500 or a tunnel's 502/504 when the table server is down.
 */
export const UNREACHABLE_MESSAGE = 'Could not reach the table server. Check it is running and try again.';

async function api<T>(path: string, init: RequestInit, goneOn404 = false): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, init);
  } catch {
    throw new Error(UNREACHABLE_MESSAGE);
  }
  if (res.status === 401) throw new PublishAuthError('session expired');

  // Bodies are JSON when present, but a PUT can legitimately answer empty — read as text
  // first so an empty/non-JSON body does not throw before the ok-check gets to run.
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON body — fall through with body left null
  }

  if (!res.ok) {
    const message =
      (body as { error?: string } | null)?.error ??
      (res.status >= 500 ? UNREACHABLE_MESSAGE : `request failed (${res.status})`);
    if (res.status === 404 && goneOn404) throw new PublishGoneError(message);
    throw new Error(message);
  }
  return body as T;
}

export function listCampaigns(adminPass: string): Promise<{ campaigns: CampaignSummary[] }> {
  return api('/campaigns', { headers: { authorization: `Bearer ${adminPass}` } });
}

export function createCampaign(
  adminPass: string,
  name: string,
): Promise<{ campaignId: string; identityId: string; token: string }> {
  return api('/campaigns', {
    method: 'POST',
    headers: { authorization: `Bearer ${adminPass}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export function mintDmToken(
  adminPass: string,
  campaignId: string,
): Promise<{ token: string; campaignId: string; name: string }> {
  return api(`/campaigns/${campaignId}/dm-token`, {
    method: 'POST',
    headers: { authorization: `Bearer ${adminPass}` },
  });
}

export function refreshDmToken(dmToken: string, campaignId: string): Promise<{ token: string; campaignId: string; exp: number }> {
  return api(`/campaigns/${campaignId}/dm-token/refresh`, {
    method: 'POST',
    headers: { authorization: `Bearer ${dmToken}` },
  });
}

/** A single-use code for the table, and the table link that carries it (decision 13). */
export function mintHandoff(dmToken: string, campaignId: string): Promise<{ code: string; tableUrl: string }> {
  return api(`/campaigns/${campaignId}/handoff`, {
    method: 'POST',
    headers: { authorization: `Bearer ${dmToken}` },
  });
}

export function uploadMap(
  dmToken: string,
  campaignId: string,
  bytes: Uint8Array,
): Promise<{ mapId: string; sceneId: string; name: string; sizeBytes: number }> {
  return api(`/campaigns/${campaignId}/maps`, {
    method: 'POST',
    headers: { authorization: `Bearer ${dmToken}`, 'content-type': 'application/octet-stream' },
    // `new Uint8Array(bytes)` copies onto a fresh ArrayBuffer-backed array — correct for
    // any byteOffset, unlike `bytes.buffer` which assumes a byteOffset-0 view — and
    // satisfies BlobPart under tsconfig.app.json's lib, which rejects the plain
    // Uint8Array<ArrayBufferLike> type serializeToBytes returns.
    body: new Blob([new Uint8Array(bytes)]),
  });
}

export function republishScene(
  dmToken: string,
  sceneId: string,
  bytes: Uint8Array,
): Promise<{ sceneId: string; mapId: string; name: string; sizeBytes: number }> {
  return api(`/scenes/${sceneId}/publish`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${dmToken}`, 'content-type': 'application/octet-stream' },
    // See uploadMap above — copy onto a fresh ArrayBuffer-backed array rather than
    // trusting bytes.buffer, which is only correct for a byteOffset-0 view.
    body: new Blob([new Uint8Array(bytes)]),
  }, true);
}

/** The table's picture of a map row (`mapId` as the upload or the publish answered it). */
export function uploadThumbnail(dmToken: string, mapId: string, image: Blob): Promise<void> {
  return api(`/maps/${mapId}/thumbnail`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${dmToken}`, 'content-type': image.type || 'application/octet-stream' },
    body: image,
  });
}

export function putScenePrep(dmToken: string, sceneId: string, prep: ScenePrep): Promise<void> {
  return api(`/scenes/${sceneId}/prep`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${dmToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(prep),
  }, true);
}
