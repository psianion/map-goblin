// Table v2 — effect timers tick when Next turns the round, through the registry the way
// production wires it, and the DM hears which ended.

import { describe, expect, it } from 'vitest'
import type { ServerMessage } from '@dnd/core/src/shared/protocol'
import type { Viewer } from '@dnd/mechanics/contract'
import { initiativeModule } from '@dnd/mechanics/initiative'
import { tokensModule, type TokensState } from '@dnd/mechanics/tokens'
import { openDb } from '../db/db'
import { createStores } from '../db/stores'
import { afterWrites, effectsTick } from './effectsTick'
import { ModuleRegistry, type DispatchContext } from './registry'

const DM: Viewer = { role: 'dm', identityId: 'dm-1' }
const SCENE = 'scene-1'

function table() {
  const stores = createStores(openDb(':memory:'))
  const campaign = stores.campaigns.create('Camp')
  const registry = new ModuleRegistry(stores.moduleState, afterWrites(effectsTick))
  registry.register(tokensModule())
  registry.register(initiativeModule)
  const sent: ServerMessage[] = []
  const ctx: DispatchContext = {
    campaignId: campaign.id,
    sessionId: 'sess-1',
    activeSceneId: SCENE,
    sender: DM,
    players: [],
    broadcast: (msg) => sent.push(msg),
  }
  const run = (module: string, action: string, payload: unknown) => registry.dispatch(module, action, payload, ctx)
  const tokens = () => (registry.readState(campaign.id, 'tokens') as TokensState).byScene[SCENE]
  return { run, tokens, sent }
}

describe('effect timers tick on Next', () => {
  it('ticks once per round, not per turn, and names the timer that ran out to the DM', () => {
    const t = table()
    expect(t.run('tokens', 'place', { name: 'Bram', x: 1, y: 1 })).toBeNull()
    expect(t.run('tokens', 'place', { name: 'Ogre', x: 3, y: 3 })).toBeNull()
    const [bram, ogre] = Object.values(t.tokens())
    expect(t.run('tokens', 'set-effect', { target: bram.id, name: 'Bless', rounds: 2 })).toBeNull()
    expect(
      t.run('initiative', 'start', {
        entries: [
          { name: 'Bram', kind: 'pc', tokenId: bram.id, initiative: 15 },
          { name: 'Ogre', kind: 'npc', tokenId: ogre.id, initiative: 8 },
        ],
      }),
    ).toBeNull()
    expect(t.run('initiative', 'begin', {})).toBeNull()

    // Round 1 → Ogre's turn: no tick yet.
    t.run('initiative', 'next', {})
    expect(t.tokens()[bram.id].effects).toEqual([{ name: 'Bless', roundsLeft: 2 }])
    // Round 2 begins: one tick.
    t.run('initiative', 'next', {})
    expect(t.tokens()[bram.id].effects).toEqual([{ name: 'Bless', roundsLeft: 1 }])
    t.run('initiative', 'next', {})
    t.run('initiative', 'next', {})
    expect(t.tokens()[bram.id].effects).toEqual([])
    expect(t.sent.filter((m) => m.type === 'effects-ended')).toEqual([
      { type: 'effects-ended', sceneId: SCENE, ended: [{ tokenId: bram.id, tokenName: 'Bram', name: 'Bless' }] },
    ])
  })

  it('a wire command cannot reach tick-effects', () => {
    const t = table()
    expect(t.run('tokens', 'tick-effects', { sceneId: SCENE })).toMatchObject({ code: 'invalid-command' })
  })
})
