// D6/D9 — the one module that mints client-side credentials. Two issuance calls today:
// the DM's (admin pass → DM token) and the player's (invite code → player token).
// Discord OAuth becomes a third function right here — `joinAsDiscordUser(oauthCode)`,
// POSTing the OAuth code and returning the same `{identityId, campaignId, token}` shape —
// and nothing else in the client moves: pages call this module, the store holds the token.

import { endpoints, setServerUrl } from '../endpoints';

export interface DmSession {
  campaignId: string;
  identityId: string;
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

/** Invite code + a name → a player token. No credential: the code is the credential. */
export function joinAsPlayer(code: string, playerName: string): Promise<PlayerSession> {
  return request('/api/join', postJson({ code, name: playerName }));
}

// ─── The DM's setup calls (same fetch, no token minted) ──────

/** Raw `.mapbuilder` JSON, not multipart — see the server's approved §2.3 deviation. */
export function uploadMapFile(
  campaignId: string,
  token: string,
  mapFileText: string,
): Promise<{ mapId: string; name: string; sizeBytes: number }> {
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
