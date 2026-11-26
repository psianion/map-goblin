// Where the party stands (table lobby pass §3.5, finishing pass 12.1): the party start area's
// cells from its centre outward, then fanned out from that centre, or fanned out beside the PCs
// already on the scene. Shared by the server's Start placement and the module's `place-pc`, so a
// character put on the map by hand lands the way Start would have put it.

import { fanAround } from './fan'
import { OUTSIDE_MAP, SOLID_GROUND } from './types'
import type { PartyStartArea, SceneVision, Token, TokenSize } from './types'

/** Where the party goes: the DM's area, or fanned out beside a point. */
export type PartyTarget = { area: PartyStartArea } | { near: { x: number; y: number }; levelId?: string }

/** Spots tried past one per PC, for a PC whose first spot is taken. */
const SPARE_SPOTS = 24

/** The cell a point is in, as a key. */
export const cellKey = (x: number, y: number): string => `${Math.floor(x)},${Math.floor(y)}`

/** Beside the party: fanned out from the centre of the PC tokens on the scene, on their level. */
export function besideParty(onScene: readonly Token[]): PartyTarget | null {
  const party = onScene.filter((t) => t.kind === 'pc' && !t.hidden)
  if (party.length === 0) return null
  const mean = (pick: (t: Token) => number) => party.reduce((sum, t) => sum + pick(t), 0) / party.length
  const near = { x: Math.floor(mean((t) => t.x)) + 0.5, y: Math.floor(mean((t) => t.y)) + 0.5 }
  return { near, ...(party[0]!.levelId ? { levelId: party[0]!.levelId } : {}) }
}

/** The level a target puts the party on; absent is the first level. */
export const targetLevel = (target: PartyTarget): string | undefined =>
  'area' in target ? target.area.levelId : target.levelId

/** The spots tried for `count` PCs, nearest the centre first: the area's cells, then the fan round its centre. */
export function partySpots(target: PartyTarget, count: number): { x: number; y: number }[] {
  if (!('area' in target)) return fanAround(target.near, count + SPARE_SPOTS)
  const { area } = target
  const centre = { x: Math.floor((area.x0 + area.x1) / 2) + 0.5, y: Math.floor((area.y0 + area.y1) / 2) + 0.5 }
  const cells: { x: number; y: number }[] = []
  for (let y = area.y0; y <= area.y1; y++) for (let x = area.x0; x <= area.x1; x++) cells.push({ x: x + 0.5, y: y + 0.5 })
  cells.sort((a, b) => Math.hypot(a.x - centre.x, a.y - centre.y) - Math.hypot(b.x - centre.x, b.y - centre.y))
  return [...cells, ...fanAround(centre, count + SPARE_SPOTS)]
}

/**
 * Whether a token of `size` can stand at a spot: on ground and not in rock, the walk grid's own
 * first two refusals. Ground the players have not seen yet is fine; placing reveals nothing.
 */
export function standsAt(scene: SceneVision | null, size: TokenSize, x: number, y: number, levelId?: string): boolean {
  if (!scene?.walkRefusal) return true
  const probe: Token = {
    id: '',
    name: '',
    imageAssetId: null,
    size,
    disposition: 'friendly',
    sight: null,
    light: null,
    defId: null,
    x,
    y,
    elevation: 0,
    z: 0,
    hidden: false,
    ownerId: null,
    ...(levelId ? { levelId } : {}),
  }
  const why = scene.walkRefusal(probe, { x, y }, null)
  return !why || !(why.startsWith(OUTSIDE_MAP) || why.startsWith(SOLID_GROUND))
}
