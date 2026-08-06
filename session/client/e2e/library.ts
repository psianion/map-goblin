import type { ScenePrep } from '@dnd/core/src/shared/prep'
import type { ZoneChild } from '@dnd/core/src/shared/types'
import { SERVER_URL } from './table'

/**
 * M3's publish-to-library REST surface, called straight from the Node test context —
 * `session/server/src/api.test.ts`'s `api()` helper, minus the DM-token issuance which
 * `session/client/src/session/auth.ts` already covers for the UI half of the spec.
 * Kept here rather than importing `auth.ts`: that module mutates the shared, module-level
 * `endpoints` object on every call (see `setServerUrl`), which is exactly the kind of
 * cross-test global state a REST fixture must not depend on.
 */

async function call<T>(path: string, init: RequestInit, credential: string): Promise<T> {
  const res = await fetch(`${SERVER_URL}${path}`, {
    ...init,
    headers: { ...init.headers, authorization: `Bearer ${credential}` },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status}: ${JSON.stringify(body)}`)
  return body as T
}

const postJson = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

export interface DmSession {
  campaignId: string
  token: string
}

export function listCampaigns(adminPass: string) {
  return call<{ campaigns: { id: string; name: string }[] }>('/api/campaigns', { method: 'GET' }, adminPass)
}

export function createCampaign(adminPass: string, name: string): Promise<DmSession> {
  return call('/api/campaigns', postJson({ name }), adminPass)
}

export function mintDmToken(adminPass: string, campaignId: string): Promise<DmSession & { name: string }> {
  return call(`/api/campaigns/${campaignId}/dm-token`, { method: 'POST' }, adminPass)
}

export interface UploadResult {
  mapId: string
  sceneId: string
  name: string
  sizeBytes: number
}

export function uploadMap(token: string, campaignId: string, doc: unknown): Promise<UploadResult> {
  return call(`/api/campaigns/${campaignId}/maps`, postJson(doc), token)
}

export function republishScene(
  token: string,
  sceneId: string,
  doc: unknown,
): Promise<{ sceneId: string; mapId: string; name: string; sizeBytes: number }> {
  return call(
    `/api/scenes/${sceneId}/publish`,
    { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(doc) },
    token,
  )
}

export function getPrep(token: string, sceneId: string): Promise<{ prep: ScenePrep | null }> {
  return call(`/api/scenes/${sceneId}/prep`, { method: 'GET' }, token)
}

export function putPrep(token: string, sceneId: string, prep: ScenePrep): Promise<{ prep: ScenePrep }> {
  return call(
    `/api/scenes/${sceneId}/prep`,
    { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(prep) },
    token,
  )
}

export interface SceneMeta {
  id: string
  name: string
  mapId: string
  visibleToPlayers: boolean
}

export function listScenes(token: string, campaignId: string): Promise<{ scenes: SceneMeta[] }> {
  return call(`/api/campaigns/${campaignId}/scenes`, { method: 'GET' }, token)
}

export function openSession(
  token: string,
  campaignId: string,
  sceneId?: string,
): Promise<{ sessionId: string; campaignId: string; inviteCode: string }> {
  return call('/api/sessions', postJson({ campaignId, sceneId }), token)
}

// ─── Fixture builders ─────────────────────────────────────────

/** The one zone every `mapDoc(..., {prep})` call anchors its trigger to. */
const ZONE_ID = 'zone-trigger-1'

/** A `room-revealed` trigger on {@link ZONE_ID} — the shape M3's prep endpoints store. */
export function triggerPrep(text: string): ScenePrep {
  return {
    version: 1,
    triggers: [
      {
        id: 'trigger-1',
        name: 'Reveal narration',
        when: { kind: 'room-revealed', zoneId: ZONE_ID },
        actions: [{ kind: 'show-text', text, toPlayers: true }],
        once: true,
        enabled: true,
      },
    ],
  }
}

/**
 * A minimal but valid `.mapbuilder` doc (version 3.1, bare JSON — the server's
 * `mapImport.ts` reads either form). `prep` is omitted from the object entirely when not
 * given, not sent as `undefined`, so a republish with it left off exercises the server's
 * "absent means untouched" branch rather than an explicit empty one.
 */
export function mapDoc(name: string, opts: { prep?: ScenePrep } = {}): Record<string, unknown> {
  const zone: ZoneChild = {
    id: ZONE_ID,
    name: 'Trigger zone',
    childType: 'zone',
    visible: true,
    shape: { kind: 'point', position: { x: 1, y: 1 } },
  }
  const doc: Record<string, unknown> = {
    version: '3.1',
    mapSettings: { name, gridType: 'square', cellScale: { value: 5, unit: 'ft' }, ambientLight: '#101018' },
    grid: { visible: true, snapDivision: 1, style: 'clean' },
    layers: [
      { id: 'layer-1', name: 'Dungeon', type: 'dungeon', visible: true, locked: false, opacity: 1, children: [zone] },
    ],
    customImages: {},
  }
  if (opts.prep !== undefined) doc.prep = opts.prep
  return doc
}
