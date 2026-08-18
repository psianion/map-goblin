import { describe, expect, it, vi } from 'vitest'
import type { ChatInputCommandInteraction, Interaction } from 'discord.js'
import { routeInteraction, type RouterDeps } from './interaction-router'
import { notAuthorized, userInput } from '../lib/errors'
import type { Command, Registry } from './command-registry'
import { build } from '../lib/custom-id'

const silentLogger = { warn: vi.fn(), error: vi.fn() }

function depsFor(registry: Registry, overrides: Partial<RouterDeps> = {}): RouterDeps {
  return {
    ownerId: 'owner-1',
    campaigns: { byChannel: () => undefined, upsert: (c) => c },
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
    },
    db: {} as RouterDeps['db'],
    announce: async () => {},
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
