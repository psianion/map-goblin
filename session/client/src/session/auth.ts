// D6/D9 — the one module that mints client-side credentials. Two issuance calls today:
// the DM's (admin pass → DM token) and the player's (invite code → player token).
// Discord OAuth becomes a third function right here — `joinAsDiscordUser(oauthCode)`,
// POSTing the OAuth code and returning the same `{identityId, campaignId, token}` shape —
// and nothing else in the client moves: pages call this module, the store holds the token.

import type { ScenePrep } from '@dnd/core/src/shared/prep';
import { endpoints, setServerUrl } from '../endpoints';

export interface DmSession {
  campaignId: string;
  // `mintDmToken` (an existing campaign) doesn't hand this back — only `createCampaignAsDm`
  // does — and nothing downstream in the client reads it either way.
  identityId?: string;
  token: string;
}

export interface PlayerSession {
  identityId: string;
  campaignId: string;
  sessionId: string;
  token: string;
}

// ─── Issuance ───────────────────────────────────────────────

/** Admin pass → a campaign and the DM token for it. Also retargets `endpoints` (D9). */
export async function createCampaignAsDm(
  serverUrl: string,
  adminPass: string,
  name: string,
): Promise<DmSession> {
  try {
    // Every later call — map upload, session start, WS, map fetch — follows this one.
    setServerUrl(serverUrl);
  } catch {
    throw new Error(`"${serverUrl}" is not a server address. Try http://localhost:8787`);
  }
  return request('/api/campaigns', postJson({ name }), adminPass);
}

export interface CampaignSummary {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Admin pass → every campaign already on this server (M3: hosting an existing campaign
 * starts from its library, not a fresh one). Also retargets `endpoints`, same as
 * {@link createCampaignAsDm} — this is the first authenticated call the wizard makes.
 */
export function listCampaignsAsAdmin(
  serverUrl: string,
  adminPass: string,
): Promise<{ campaigns: CampaignSummary[] }> {
  try {
    setServerUrl(serverUrl);
  } catch {
    throw new Error(`"${serverUrl}" is not a server address. Try http://localhost:8787`);
  }
  return request('/api/campaigns', { method: 'GET' }, adminPass);
}

/** Admin pass → a fresh DM token for a campaign the admin pass already owns (M3). */
export function mintDmToken(
  serverUrl: string,
  adminPass: string,
  campaignId: string,
): Promise<DmSession & { name: string }> {
  try {
    setServerUrl(serverUrl);
  } catch {
    throw new Error(`"${serverUrl}" is not a server address. Try http://localhost:8787`);
  }
  return request(
    `/api/campaigns/${encodeURIComponent(campaignId)}/dm-token`,
    { method: 'POST' },
    adminPass,
  );
}

/** Invite code + a name → a player token. No credential: the code is the credential. */
export function joinAsPlayer(code: string, playerName: string): Promise<PlayerSession> {
  return request('/api/join', postJson({ code, name: playerName }));
}

// ─── The DM's setup calls (same fetch, no token minted) ──────

/**
 * Raw `.mapbuilder` JSON, not multipart — see the server's approved §2.3 deviation.
 *
 * #47 — this doubles as first publish: the server mints the scene alongside the map row,
 * with the scene's own id set to the map's (`sceneId === mapId` here, always). Re-publishing
 * an *existing* scene from a new file is {@link publishScene}, a different call — the one
 * that has to keep the scene's id rather than mint one.
 */
export function uploadMapFile(
  campaignId: string,
  token: string,
  mapFileText: string,
): Promise<{ mapId: string; sceneId: string; name: string; sizeBytes: number }> {
  return request(
    `/api/campaigns/${encodeURIComponent(campaignId)}/maps`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: mapFileText },
    token,
  );
}

/** A scene id is the id of the map it was uploaded as — the server keys fog by it. */
export interface StartingRoom {
  sceneId: string;
  roomId: string;
}

/**
 * Opens the table and returns the code players type in.
 *
 * `startingRoom` is §2.6's optional pick: the server reveals it before the session is
 * reachable, so it is stored fog by the time the first player joins. Omitted = the table
 * starts dark, which is what it did before the picker existed.
 *
 * `sceneId` is the map the wizard just uploaded, sent whether or not a room was picked. The
 * server cannot infer it: a campaign may hold several maps and the order they were imported
 * in does not say which one this table is for.
 */
export function startSession(
  campaignId: string,
  token: string,
  startingRoom?: StartingRoom,
  sceneId?: string,
): Promise<{ sessionId: string; campaignId: string; inviteCode: string }> {
  return request('/api/sessions', postJson({ campaignId, startingRoom, sceneId }), token);
}

/** Public code check — JoinSession calls it before asking for a name (§2.3). */
export function resolveInviteCode(code: string): Promise<{ campaignId: string; sessionId: string }> {
  return request(`/api/resolve/${encodeURIComponent(code)}`, { method: 'GET' });
}

// ─── Scene management (#47) — the DM's own library, not the wire snapshot ────

export interface SceneMeta {
  id: string;
  name: string;
  sortIndex: number;
  visibleToPlayers: boolean;
  mapId: string;
  updatedAt: number;
}

/** GET /api/campaigns/:id/scenes — the full library, in drag order. DM only. */
export function listScenes(campaignId: string, token: string): Promise<{ scenes: SceneMeta[] }> {
  return request(`/api/campaigns/${encodeURIComponent(campaignId)}/scenes`, { method: 'GET' }, token);
}

/**
 * GET /api/maps/:id — the map document a library scene points at, for deriving its rooms
 * (M3: the host wizard's starting-room picker has to work for a scene picked from the
 * library, not only one just uploaded in this tab). `images=external` is the same leniency
 * `loadSceneMap` uses — the picker only reads `layers`, so the images never need fetching.
 */
export function fetchMapDoc(sceneId: string, token: string): Promise<unknown> {
  return request(`/api/maps/${encodeURIComponent(sceneId)}?images=external`, { method: 'GET' }, token);
}

/** PATCH /api/scenes/:id — rename and/or the D5 visibility flag. */
export function patchScene(
  sceneId: string,
  token: string,
  patch: { name?: string; visibleToPlayers?: boolean },
): Promise<{ id: string; name: string; visibleToPlayers: boolean }> {
  return request(
    `/api/scenes/${encodeURIComponent(sceneId)}`,
    { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) },
    token,
  );
}

/** PUT /api/scenes/:id/publish — re-publish (D1): a fresh file, same scene id. */
export function publishScene(
  sceneId: string,
  token: string,
  mapFileText: string,
): Promise<{ sceneId: string; mapId: string; name: string; sizeBytes: number }> {
  return request(
    `/api/scenes/${encodeURIComponent(sceneId)}/publish`,
    { method: 'PUT', headers: { 'content-type': 'application/json' }, body: mapFileText },
    token,
  );
}

/** DELETE /api/scenes/:id. */
export function deleteScene(sceneId: string, token: string): Promise<{ sceneId: string; deleted: true }> {
  return request(`/api/scenes/${encodeURIComponent(sceneId)}`, { method: 'DELETE' }, token);
}

/**
 * GET /api/scenes/:id/prep — DM only (M4). The DM's authored trigger defs for this scene,
 * raw as written in the editor — `null` if the DM never opened prep on it. This is not the
 * server's resolved view (room/shape/inert are computed at fire time and never persisted),
 * so a trigger's `inert` reason has no source here; the triggers panel renders what prep and
 * the runtime module state actually carry and leaves it at that.
 */
export function getScenePrep(sceneId: string, token: string): Promise<{ prep: ScenePrep | null }> {
  return request(`/api/scenes/${encodeURIComponent(sceneId)}/prep`, { method: 'GET' }, token);
}

/** PUT /api/campaigns/:id/scenes/order — every scene id, in the new order (D4). */
export function reorderScenes(
  campaignId: string,
  token: string,
  order: readonly string[],
): Promise<{ order: string[] }> {
  return request(
    `/api/campaigns/${encodeURIComponent(campaignId)}/scenes/order`,
    { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ order }) },
    token,
  );
}

// ─── Plumbing ───────────────────────────────────────────────

const UNREACHABLE = 'Could not reach the server. Check the address, and that it is running.';

/** Statuses whose server-side wording is too terse to put in front of a person. */
const FRIENDLY: Record<number, string> = {
  401: 'The server did not accept that admin pass.',
  403: 'That table will not let you in — the DM may have removed you.',
  404: 'No active game for that code. Ask your DM for a fresh one.',
  413: 'That map file is too large — the server caps uploads at 20MB.',
};

const postJson = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

/**
 * One fetch, one error vocabulary. Anything thrown out of here is already a sentence a
 * page can render: pages never branch on status codes.
 */
async function request<T>(path: string, init: RequestInit, credential?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${endpoints.httpBase}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
      },
    });
  } catch {
    throw new Error(UNREACHABLE);
  }

  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(FRIENDLY[res.status] ?? body.error ?? `Server error ${res.status}.`);
  return body;
}
