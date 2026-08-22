import { describe, expect, it, vi } from 'vitest'
import type { ChatInputCommandInteraction, Interaction } from 'discord.js'
import { routeInteraction, type RouterDeps } from './interaction-router'
import { notAuthorized, userInput } from '../lib/errors'
import type { Command, Registry } from './command-registry'
import { build, SHARED_OWNER } from '../lib/custom-id'

const silentLogger = { warn: vi.fn(), error: vi.fn() }

/** Every store method the router itself never reaches. */
const unused = (): never => {
  throw new Error('not used in this test')
}

function depsFor(registry: Registry, overrides: Partial<RouterDeps> = {}): RouterDeps {
  return {
    ownerId: 'owner-1',
    botData: 'unused-bot-data',
    campaigns: {
      byChannel: () => undefined,
      byId: () => undefined,
      upsert: (c) => ({ ...c, nextSessionAt: null, serviceToken: null, playerToken: null }),
      setNextSession: () => {
        throw new Error('not used in this test')
      },
      setTokens: () => {
        throw new Error('not used in this test')
      },
    },
    characters: {
      create: () => {
        throw new Error('not used in this test')
      },
      update: () => {
        throw new Error('not used in this test')
      },
      byId: () => undefined,
      byCampaignAndName: () => undefined,
      byOwner: () => [],
      byCampaign: () => [],
      touchLastPlayed: unused,
    },
    quests: {
      add: () => {
        throw new Error('not used in this test')
      },
      complete: () => {
        throw new Error('not used in this test')
      },
      active: () => [],
      byCampaign: () => [],
    },
    notes: {
      add: () => {
        throw new Error('not used in this test')
      },
      search: () => [],
    },
    rolls: {
      record: () => {
        throw new Error('not used in this test')
      },
      byId: () => undefined,
      statsByCampaign: () => [],
    },
    ledger: {
      add: () => {
        throw new Error('not used in this test')
      },
      recent: () => [],
      goldTotal: () => 0,
    },
    calendar: {
      get: () => undefined,
      set: () => {
        throw new Error('not used in this test')
      },
      advance: () => {
        throw new Error('not used in this test')
      },
    },
    schedulePolls: {
      create: () => {
        throw new Error('not used in this test')
      },
      byId: () => undefined,
      setMessageRef: () => {
        throw new Error('not used in this test')
      },
      setVotes: () => {
        throw new Error('not used in this test')
      },
      close: () => {
        throw new Error('not used in this test')
      },
    },
    lfgPosts: {
      create: () => {
        throw new Error('not used in this test')
      },
      open: () => [],
      openForCampaign: () => undefined,
      close: () => {},
    },
    lfgApplications: {
      add: () => {
        throw new Error('not used in this test')
      },
    },
    feedback: {
      add: () => {
        throw new Error('not used in this test')
      },
    },
    sessions: {
      start: unused,
      byId: () => undefined,
      live: () => [],
      lastEnded: () => undefined,
      finish: unused,
      setLiveMessageId: unused,
      setRecapMessageId: unused,
      setLogThreadId: unused,
      stats: () => ({ played: 0, lastStartedAt: null }),
    },
    lfgChannelId: 'lfg-chan',
    goblin: {
      mintServiceToken: unused,
      getScenes: unused,
      openSession: unused,
      endSession: unused,
      getMap: unused,
      getAsset: unused,
    },
    goblinAdminPass: 'admin-pass',
    sessionRunner: {
      start: unused,
      end: unused,
      liveState: () => undefined,
      encounter: () => undefined,
      command: () => false,
      resume: unused,
      stopAll: unused,
    },
    db: {} as RouterDeps['db'],
    announce: async () => undefined,
    edit: async () => {},
    registry,
    logger: silentLogger,
    ...overrides,
  }
}

function commandInteraction(name: string, userId = 'user-1') {
  const calls: string[] = []
  const interaction = {
    calls,
    commandName: name,
    channelId: 'chan-1',
    user: { id: userId, username: 'goblin' },
    member: { roles: ['role-1'] },
    deferred: false,
    replied: false,
    isChatInputCommand: () => true,
    isAutocomplete: () => false,
    isMessageComponent: () => false,
    deferReply: vi.fn(async () => {
      calls.push('defer')
      interaction.deferred = true
    }),
    reply: vi.fn(async (opts: { content: string }) => {
      calls.push(`reply:${opts.content}`)
    }),
    editReply: vi.fn(async (opts: string | { content: string }) => {
      calls.push(`edit:${typeof opts === 'string' ? opts : opts.content}`)
    }),
  }
  return interaction
}

const command = (over: Partial<Command> = {}): Command => ({
  data: { toJSON: () => ({ name: 'test' }) },
  authorize: () => {},
  execute: async () => {},
  ...over,
})

describe('routeInteraction — commands', () => {
  it('authorizes before deferring', async () => {
    const interaction = commandInteraction('test')
    const registry: Registry = {
      test: command({
        authorize: () => interaction.calls.push('authorize'),
        execute: async () => {
          interaction.calls.push('execute')
        },
      }),
    }
    await routeInteraction(interaction as unknown as Interaction, depsFor(registry))
    expect(interaction.calls).toEqual(['authorize', 'defer', 'execute'])
  })

  it('never defers when authorize throws, and replies ephemerally', async () => {
    const interaction = commandInteraction('test')
    const registry: Registry = {
      test: command({
        authorize: () => {
          throw notAuthorized('That one is for the bot operator.')
        },
      }),
    }
    await routeInteraction(interaction as unknown as Interaction, depsFor(registry))
    expect(interaction.deferReply).not.toHaveBeenCalled()
    expect(interaction.calls).toEqual(['reply:That one is for the bot operator.'])
  })

  it('maps a BotError from execute to its user message', async () => {
    const interaction = commandInteraction('test')
    const registry: Registry = {
      test: command({
        execute: async () => {
          throw userInput('Roll expression looks wrong.')
        },
      }),
    }
    await routeInteraction(interaction as unknown as Interaction, depsFor(registry))
    expect(interaction.calls).toEqual(['defer', 'edit:Roll expression looks wrong.'])
  })

  it('never leaks an unknown error to the user', async () => {
    const interaction = commandInteraction('test')
    const registry: Registry = {
      test: command({
        execute: async () => {
          throw new Error('sqlite: no such table: secrets')
        },
      }),
    }
    await routeInteraction(interaction as unknown as Interaction, depsFor(registry))
    expect(interaction.calls[1]).toBe('edit:Something went wrong on my end. It has been logged.')
  })

  it('writes one audit line per outcome', async () => {
    const audit = vi.fn<(line: string) => void>()
    const okInteraction = commandInteraction('test')
    const badInteraction = commandInteraction('nope')
    const registry: Registry = { test: command() }
    await routeInteraction(okInteraction as unknown as Interaction, depsFor(registry, { audit }))
    await routeInteraction(badInteraction as unknown as Interaction, depsFor(registry, { audit }))
    expect(audit.mock.calls.map(([line]) => line[0])).toEqual(['✅', '❌'])
    expect(audit.mock.calls[0][0]).toContain('/test by @goblin')
  })

  it('rejects an unknown command name', async () => {
    const interaction = commandInteraction('ghost')
    await routeInteraction(interaction as unknown as Interaction, depsFor({}))
    expect(interaction.calls).toEqual(["reply:I don't have a /ghost any more."])
  })

  it('lets a function `ephemeral` pick per-interaction, e.g. per subcommand', async () => {
    const interaction = commandInteraction('test') as unknown as ChatInputCommandInteraction & { calls: string[] }
    ;(interaction as unknown as { options: { getSubcommand: () => string } }).options = {
      getSubcommand: () => 'add',
    }
    const registry: Registry = { test: command({ ephemeral: (i) => i.options.getSubcommand() === 'list' }) }
    await routeInteraction(interaction as unknown as Interaction, depsFor(registry))
    expect(interaction.deferReply).toHaveBeenCalledWith({})
  })
})

describe('routeInteraction — components', () => {
  function componentInteraction(customId: string, userId: string) {
    const calls: string[] = []
    return {
      calls,
      customId,
      channelId: 'chan-1',
      user: { id: userId, username: 'goblin' },
      member: { roles: [] },
      deferred: false,
      replied: false,
      isChatInputCommand: () => false,
      isAutocomplete: () => false,
      isMessageComponent: () => true,
      reply: vi.fn(async (opts: { content: string }) => {
        calls.push(`reply:${opts.content}`)
      }),
      editReply: vi.fn(async () => {}),
    }
  }

  it('runs the handler for the stamped owner', async () => {
    const handler = vi.fn<NonNullable<Command['component']>>(async () => {})
    const registry: Registry = { map: command({ component: handler }) }
    const interaction = componentInteraction(build('map', 'refresh', 'user-1'), 'user-1')
    await routeInteraction(interaction as unknown as Interaction, depsFor(registry))
    expect(handler).toHaveBeenCalledOnce()
    expect(handler.mock.calls[0][1]).toMatchObject({ namespace: 'map', action: 'refresh' })
  })

  it("rejects a click on someone else's control", async () => {
    const handler = vi.fn<NonNullable<Command['component']>>(async () => {})
    const registry: Registry = { map: command({ component: handler }) }
    const interaction = componentInteraction(build('map', 'refresh', 'user-1'), 'intruder')
    await routeInteraction(interaction as unknown as Interaction, depsFor(registry))
    expect(handler).not.toHaveBeenCalled()
    expect(interaction.calls).toEqual(["reply:That's someone else's button."])
  })

  it('rejects an id it did not build', async () => {
    const interaction = componentInteraction('legacy-button', 'user-1')
    await routeInteraction(interaction as unknown as Interaction, depsFor({}))
    expect(interaction.calls).toEqual(['reply:That control is from an older message.'])
  })

  it('runs the handler for ANY clicker on a shared-sentinel control (poll votes, LFG apply)', async () => {
    const handler = vi.fn<NonNullable<Command['component']>>(async () => {})
    const registry: Registry = { schedule: command({ component: handler }) }
    const id = build('schedule', 'vote', SHARED_OWNER, '1', '0')
    const first = componentInteraction(id, 'user-1')
    const second = componentInteraction(id, 'user-2')
    await routeInteraction(first as unknown as Interaction, depsFor(registry))
    await routeInteraction(second as unknown as Interaction, depsFor(registry))
    expect(handler).toHaveBeenCalledTimes(2)
    expect(first.calls).toEqual([])
    expect(second.calls).toEqual([])
  })

  it('still enforces the strict owner stamp for a non-shared id, even one from the same namespace', async () => {
    const handler = vi.fn<NonNullable<Command['component']>>(async () => {})
    const registry: Registry = { schedule: command({ component: handler }) }
    const id = build('schedule', 'close', 'dm-1', '1')
    const interaction = componentInteraction(id, 'someone-else')
    await routeInteraction(interaction as unknown as Interaction, depsFor(registry))
    expect(handler).not.toHaveBeenCalled()
    expect(interaction.calls).toEqual(["reply:That's someone else's button."])
  })
})

describe('routeInteraction — role helpers via a live registry', () => {
  it('passes the member role ids to authorize', async () => {
    const seen: string[][] = []
    const interaction = commandInteraction('test')
    const registry: Registry = {
      test: command({ authorize: (ctx) => void seen.push(ctx.roleIds) }),
    }
    await routeInteraction(interaction as unknown as ChatInputCommandInteraction, depsFor(registry))
    expect(seen).toEqual([['role-1']])
  })
})
