import { describe, expect, it } from 'vitest'
import { commandsToDeploy, syncDiff } from './sync-commands'
import { registry, type Command, type Registry } from './command-registry'

const stub = (name: string, devOnly?: boolean): Command => ({
  data: { toJSON: () => ({ name }) },
  devOnly,
  authorize: () => {},
  execute: async () => {},
})

describe('commandsToDeploy', () => {
  const reg: Registry = { ping: stub('ping'), wip: stub('wip', true) }

  it('excludes dev-only commands by default', () => {
    expect(commandsToDeploy(reg, new Set()).map((c) => c.name)).toEqual(['ping'])
  })

  it('includes a dev-only command listed in DEV_FEATURES', () => {
    expect(commandsToDeploy(reg, new Set(['wip'])).map((c) => c.name)).toEqual(['ping', 'wip'])
  })

  it('deploys every real command declared in the registry', () => {
    expect(commandsToDeploy(registry, new Set()).map((c) => c.name)).toEqual(Object.keys(registry))
  })
})

describe('syncDiff', () => {
  it('reports added, removed and unchanged', () => {
    expect(syncDiff(['ping', 'map'], ['map', 'stale'])).toEqual({
      added: ['ping'],
      removed: ['stale'],
      unchanged: ['map'],
    })
  })
})
