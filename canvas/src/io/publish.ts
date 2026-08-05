// src/io/publish.ts
// Client-side plumbing for "publish to library": the map content hash used to tell a
// prep-only edit from a real map change, DM-token storage, and thin wrappers over the
// session server's /api/campaigns + /api/scenes routes. All requests are same-origin
// `/api/...` — the vite dev proxy (vite.config.ts) and prod nginx both route it.
//
// The admin pass is NEVER stored here or anywhere else: it lives in PublishDialog's
// component state for the lifetime of the connect step and is discarded once a DM
// token comes back.

import type { ScenePrep, SerializedMapData } from '@/store/types';

// ─── Map hash ─────────────────────────────────────────────────────────────

/**
 * A content hash for "has this map changed since the last publish".
 *
 * `prep` is stripped before hashing: a prep-only edit must not look like a map change,
 * or the cheap prep-only PUT path (publishScene vs. putScenePrep) never fires and every
 * trigger tweak re-uploads the whole map. Hashing the pre-gzip JSON — not
 * `serializeToBytes`'s compressed output — also sidesteps any nondeterminism a
 * compressor could introduce between two runs of the same document.
 */
export async function hashMapForPublish(data: SerializedMapData): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { prep: _prep, ...withoutPrep } = data;
  const bytes = new TextEncoder().encode(JSON.stringify(withoutPrep));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
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

// ─── Server calls ───────────────────────────────────────────────────────────

export interface CampaignSummary {
  id: string;
  name: string;
}

/** Thrown on a 401 from any publish call — the caller drops the stored token and re-connects. */
export class PublishAuthError extends Error {}

async function api<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init);
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
    const message = (body as { error?: string } | null)?.error ?? `request failed (${res.status})`;
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

export function uploadMap(
  dmToken: string,
  campaignId: string,
  bytes: Uint8Array,
): Promise<{ mapId: string; sceneId: string; name: string; sizeBytes: number }> {
  return api(`/campaigns/${campaignId}/maps`, {
    method: 'POST',
    headers: { authorization: `Bearer ${dmToken}`, 'content-type': 'application/octet-stream' },
    // Same cast as saveLoad's downloadBytes — serializeToBytes returns a tight
    // array, and tsconfig.app.json's lib rejects Uint8Array<ArrayBufferLike> as BodyInit.
    body: new Blob([bytes.buffer as ArrayBuffer]),
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
    // Same cast as saveLoad's downloadBytes — serializeToBytes returns a tight
    // array, and tsconfig.app.json's lib rejects Uint8Array<ArrayBufferLike> as BodyInit.
    body: new Blob([bytes.buffer as ArrayBuffer]),
  });
}

export function putScenePrep(dmToken: string, sceneId: string, prep: ScenePrep): Promise<void> {
  return api(`/scenes/${sceneId}/prep`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${dmToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(prep),
  });
}
