import type { ScenePrep, TriggerDef } from '@dnd/core/src/shared/prep'
import type { LightChild, Room, ZoneChild } from '@dnd/core/src/shared/types'
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

// ─── M4 triggers-flagship fixture ─────────────────────────

/**
 * One room, two zones: `zone-reveal` (a point, for the room-revealed narration) and
 * `zone-trap` (a rect, for the two enter-region triggers). The server trusts an uploaded
 * document's own `rooms`/zone geometry verbatim (`session/server/src/fog/sceneMap.ts` reads
 * `layer.rooms` straight off the file — it never re-detects them), and the DM's fog-room list
 * reads the same untouched `mapData` (`FogTool`'s `serverRooms`, "the server's rooms, not
 * core's re-detected ones") — so a hand-authored room with no wall geometry at all is exactly
 * as real as one the editor derived from walls, for everything this spec touches.
 *
 * Shapes mirror `session/server/src/triggers.e2e.test.ts`'s own fixture (the wire-level proof
 * of this exact cascade) rather than inventing new geometry to re-derive the same answer.
 */
const TRIGGERS_ROOM_ID = 'room-trig-1'
const ZONE_REVEAL_ID = 'zone-reveal'
const ZONE_TRAP_ID = 'zone-trap'

export const TRIGGERS_FIXTURE = {
  roomId: TRIGGERS_ROOM_ID,
  /**
   * Where the DM's token starts: inside the room, outside the trap rect. Cell-centred
   * (`.5`) so it matches the server's own snap for an odd-cell token (`tokens/validate.ts`'s
   * `snap`) with nothing to round away.
   */
  spawn: { x: 1.5, y: 1.5 },
  /** Inside `zone-trap`'s rect (10,10)-(14,14), also cell-centred. */
  trapPoint: { x: 11.5, y: 11.5 },
  roomText: 'Dust sifts from the ceiling as torches flare to life.',
  trapText: 'A dart trap fires!',
  trapDc: 13,
  trapAbilityLabel: 'DEX save · DC 13',
  trapDamage: '2d6+1',
  rearmText: 'Something stirs in the dark corner.',
  // The definition-leak probe's marker: a DM-only trigger name and prompt text that must
  // never reach a player who never claimed the token it would have targeted.
  secretName: 'Ambush cue (DM only)',
  secretPromptText: 'Shapes move in the dark — roll for initiative!',
  triggerIds: {
    room: 'trg-room',
    trap: 'trg-trap',
    rearm: 'trg-rearm',
    initiative: 'trg-initiative',
  },
} as const

/**
 * Four triggers: a `room-revealed` narration everyone hears, an `enter-region` trap the
 * claiming player answers, a second `enter-region` trigger on the *same* zone with
 * `once: false` (proves a DM-driven move cascades exactly like a player's — test 4 re-enters
 * the same rect from the DM's own seat), and a `once`/authored-`enabled: false` `prompt`
 * trigger that exists only to be force-fired from the DM's Fire button (`fireCommand` skips
 * `enabled`/`disabled` entirely — see module.ts) and never to auto-fire.
 */
export function triggersFlagshipPrep(): ScenePrep {
  const f = TRIGGERS_FIXTURE
  const triggers: TriggerDef[] = [
    {
      id: f.triggerIds.room,
      name: 'Room revealed narration',
      when: { kind: 'room-revealed', zoneId: ZONE_REVEAL_ID },
      actions: [{ kind: 'show-text', text: f.roomText, toPlayers: true }],
      once: true,
      enabled: true,
    },
    {
      id: f.triggerIds.trap,
      name: 'Dart trap',
      when: { kind: 'enter-region', zoneId: ZONE_TRAP_ID },
      actions: [
        { kind: 'trap', text: f.trapText, save: { ability: 'dex', dc: f.trapDc }, damage: f.trapDamage },
      ],
      once: true,
      enabled: true,
    },
    {
      id: f.triggerIds.rearm,
      name: 'Zone rearm ping',
      when: { kind: 'enter-region', zoneId: ZONE_TRAP_ID },
      actions: [{ kind: 'show-text', text: f.rearmText, toPlayers: false }],
      once: false,
      enabled: true,
    },
    {
      id: f.triggerIds.initiative,
      name: f.secretName,
      when: { kind: 'room-revealed', zoneId: ZONE_REVEAL_ID },
      actions: [{ kind: 'prompt', prompt: 'initiative', text: f.secretPromptText }],
      once: true,
      enabled: false,
    },
  ]
  return { version: 1, triggers }
}

/**
 * The map doc `triggersFlagshipPrep()`'s zones anchor to: one room, no walls (mergedFloor
 * stays `null` — nothing in this spec needs the floor to render, only the fog room list and
 * the server's zone→room resolution, both of which read `rooms`/`zones` verbatim). Prep rides
 * in the same document, exactly like `mapDoc`'s `opts.prep` — the UI upload path stores it in
 * one step, no separate `putPrep` call needed.
 */
export function triggersFlagshipDoc(name: string): Record<string, unknown> {
  const room: Room = {
    id: TRIGGERS_ROOM_ID,
    name: 'The Vault',
    boundary: [
      [0, 0],
      [20, 0],
      [20, 20],
      [0, 20],
    ],
    centroid: [10, 10],
    area: 400,
    isPathway: false,
  }
  const zoneReveal: ZoneChild = {
    id: ZONE_REVEAL_ID,
    name: 'Reveal anchor',
    childType: 'zone',
    visible: true,
    shape: { kind: 'point', position: { x: 2, y: 2 } },
  }
  const zoneTrap: ZoneChild = {
    id: ZONE_TRAP_ID,
    name: 'Trap zone',
    childType: 'zone',
    visible: true,
    shape: { kind: 'rect', x: 10, y: 10, width: 4, height: 4 },
  }
  return {
    version: '3.1',
    mapSettings: { name, gridType: 'square', cellScale: { value: 5, unit: 'ft' }, ambientLight: '#101018' },
    grid: { visible: true, snapDivision: 1, style: 'clean' },
    layers: [
      {
        id: 'layer-1',
        name: 'Dungeon',
        type: 'dungeon',
        visible: true,
        locked: false,
        opacity: 1,
        standaloneWalls: [],
        mergedFloor: null,
        // Both empty-ish, but present: the renderer reads `style.wallTextureSetId` and
        // `sublayerVisibility.floor` unconditionally (wallNodeRenderer.ts, subscribeToStore.ts)
        // — an absent object crashes the page, it does not just draw nothing.
        style: {},
        sublayerVisibility: { floor: true, grid: true, walls: true },
        rooms: [room],
        children: [zoneReveal, zoneTrap],
      },
    ],
    customImages: {},
    prep: triggersFlagshipPrep(),
  }
}

// ─── M5 time & weather fixture ─────────────────────────

const LAMP_ZONE_ID = 'zone-lamp'

export const TIME_WEATHER_FIXTURE = {
  /** Outside the lamp zone. */
  spawn: { x: 1.5, y: 1.5 },
  /** Inside `zone-lamp`'s rect (10,10)-(14,14), cell-centred. */
  lampPoint: { x: 11.5, y: 11.5 },
  lightId: 'light-lamp',
  lightName: 'Lamp',
  triggerId: 'trg-lamp',
} as const

/** One `enter-region` trigger wired to a `light` action — M5's live-relight row. */
export function timeWeatherPrep(): ScenePrep {
  const f = TIME_WEATHER_FIXTURE
  const triggers: TriggerDef[] = [
    {
      id: f.triggerId,
      name: 'Lamp trigger',
      when: { kind: 'enter-region', zoneId: LAMP_ZONE_ID },
      actions: [{ kind: 'light', lightId: f.lightId, on: true }],
      once: true,
      enabled: true,
    },
  ]
  return { version: 1, triggers }
}

/**
 * The map doc `timeWeatherPrep()` anchors to: a zone to walk into and the light it wires
 * to, authored off (`visible: false`) so the trigger's flip is observable. No room needed —
 * `enter-region` resolves straight off the zone's own shape, unlike `room-revealed`.
 */
export function timeWeatherDoc(name: string): Record<string, unknown> {
  const f = TIME_WEATHER_FIXTURE
  const zone: ZoneChild = {
    id: LAMP_ZONE_ID,
    name: 'Lamp zone',
    childType: 'zone',
    visible: true,
    shape: { kind: 'rect', x: 10, y: 10, width: 4, height: 4 },
  }
  const light: LightChild = {
    id: f.lightId,
    name: f.lightName,
    childType: 'light',
    visible: false,
    color: '#ffaa55',
    radius: 5,
    featherRadius: 2,
    intensity: 1,
    falloff: 'linear',
    position: { x: 12, y: 12 },
  }
  return {
    version: '3.1',
    mapSettings: { name, gridType: 'square', cellScale: { value: 5, unit: 'ft' }, ambientLight: '#101018' },
    grid: { visible: true, snapDivision: 1, style: 'clean' },
    layers: [
      {
        id: 'layer-1',
        name: 'Dungeon',
        type: 'dungeon',
        visible: true,
        locked: false,
        opacity: 1,
        standaloneWalls: [],
        mergedFloor: null,
        // Both empty-ish, but present — see `triggersFlagshipDoc`'s own note: the renderer
        // reads these unconditionally, an absent object crashes the page rather than drawing
        // nothing.
        style: {},
        sublayerVisibility: { floor: true, grid: true, walls: true },
        rooms: [],
        children: [zone, light],
      },
    ],
    customImages: {},
    prep: timeWeatherPrep(),
  }
}
