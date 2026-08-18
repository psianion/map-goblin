// Live self-check: logs in for real and posts a pass/fail checklist to the log channel, so
// the channel becomes the deploy record. The check list is plain async functions; only
// main() touches Discord, so runChecks stays unit-testable.

import { Events, MessageFlags } from 'discord.js'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createClient } from '../src/bot/client'
import { registry } from '../src/bot/command-registry'
import { commandsToDeploy, deployedCommandNames, syncDiff } from '../src/bot/sync-commands'
import { openDb } from '../src/db/db'
import { createCampaigns, createFeedback, createNotes, createSchedulePolls } from '../src/db/stores'
import { parseEnv, type Env } from '../src/env'
import { rollExpression } from '../src/features/dice'
import { toggleVote, winningOption } from '../src/features/schedule'
import { renderCharacterCard } from '../src/render/card-kit'
import { container } from '../src/lib/ui'

export interface Check {
  name: string
  /** Resolves with a note on success; throwing (or rejecting) is the failure. */
  run: () => Promise<string>
}

export interface CheckResult {
  name: string
  ok: boolean
  note: string
}

/** Runs every check, in order, and never throws — a thrown error becomes a failed row. */
export async function runChecks(checks: Check[]): Promise<CheckResult[]> {
  const results: CheckResult[] = []
  for (const check of checks) {
    try {
      results.push({ name: check.name, ok: true, note: await check.run() })
    } catch (err) {
      results.push({ name: check.name, ok: false, note: err instanceof Error ? err.message : String(err) })
    }
  }
  return results
}

export function formatResults(results: CheckResult[]): string[] {
  return results.map((r) => `${r.ok ? '✅' : '❌'} **${r.name}** — ${r.note}`)
}

/** Milestone 1 surface: config, storage, command deployment. Features append their own. */
export function m1Checks(env: Env): Check[] {
  return [
    {
      name: 'env',
      run: async () => `${Object.keys(env).length} fields validated`,
    },
    {
      name: 'database',
      run: async () => {
        const db = openDb(join(env.BOT_DATA, 'bot.db'))
        const row = db.prepare<[], { n: number }>('SELECT count(*) AS n FROM migrations').get()
        db.close()
        return `open at ${env.BOT_DATA}, ${row?.n ?? 0} migrations applied`
      },
    },
    {
      name: 'command sync',
      run: async () => {
        const declared = commandsToDeploy(registry, env.DEV_FEATURES).map((c) => c.name)
        const diff = syncDiff(declared, await deployedCommandNames(env))
        if (diff.added.length || diff.removed.length)
          throw new Error(`drift — missing [${diff.added}], stale [${diff.removed}]; run pnpm sync`)
        return `${diff.unchanged.length} commands deployed and handled`
      },
    },
  ]
}

/** Milestone 2 surface: card rendering (registry/DB checks already covered by m1Checks). */
export function m2Checks(): Check[] {
  return [
    {
      name: 'character card',
      run: async () => {
        const png = await renderCharacterCard({
          name: 'Smoke Test',
          className: 'Ranger',
          level: 1,
          campaignName: 'Smoke Campaign',
        })
        return `${png.length} byte PNG`
      },
    },
  ]
}

/** Milestone 3 surface: dice parser + FTS5 round-trip (DB/registry checks already covered). */
export function m3Checks(): Check[] {
  return [
    {
      name: 'dice parser',
      run: async () => {
        const result = rollExpression('2d6+3')
        if (result.terms.length !== 2) throw new Error('unexpected term count')
        return `2d6+3 -> ${result.total}`
      },
    },
    {
      name: 'notes fts5',
      run: async () => {
        const db = openDb(':memory:')
        createCampaigns(db).upsert({
          goblinCampaignId: 'smoke',
          name: 'Smoke',
          channelId: 'smoke-chan',
          dmChannelId: 'smoke-dm',
          dmDiscordId: 'smoke-dm-user',
          roleId: 'smoke-role',
        })
        const notes = createNotes(db)
        notes.add('smoke', 'smoke-user', 'the goblin found a key')
        const hits = notes.search('smoke', '"goblin"')
        db.close()
        if (hits.length !== 1) throw new Error('fts round-trip found 0 matches')
        return 'search round-trip ok'
      },
    },
  ]
}

/** Milestone 4 surface: schedule polls + feedback's anonymous schema (DB/registry already
 * covered by m1Checks; LFG/apply reuse the same store round-trip shape as schedule). */
export function m4Checks(): Check[] {
  return [
    {
      name: 'schedule poll round-trip',
      run: async () => {
        const db = openDb(':memory:')
        createCampaigns(db).upsert({
          goblinCampaignId: 'smoke',
          name: 'Smoke',
          channelId: 'smoke-chan',
          dmChannelId: 'smoke-dm',
          dmDiscordId: 'smoke-dm-user',
          roleId: 'smoke-role',
        })
        const polls = createSchedulePolls(db)
        const poll = polls.create('smoke', ['2026-08-21T20:00:00Z', '2026-08-22T14:00:00Z'])
        const voted = polls.setVotes(poll.id, toggleVote(poll.votes, 'smoke-user', 0))
        const winner = winningOption(voted)
        db.close()
        if (winner?.index !== 0) throw new Error('vote round-trip did not pick the voted option')
        return 'create -> vote -> winner ok'
      },
    },
    {
      name: 'feedback schema is anonymous',
      run: async () => {
        const db = openDb(':memory:')
        createCampaigns(db).upsert({
          goblinCampaignId: 'smoke',
          name: 'Smoke',
          channelId: 'smoke-chan',
          dmChannelId: 'smoke-dm',
          dmDiscordId: 'smoke-dm-user',
          roleId: 'smoke-role',
        })
        createFeedback(db).add('smoke', 'smoke feedback text')
        const columns = (db.prepare('PRAGMA table_info(feedback)').all() as { name: string }[]).map((c) => c.name)
        db.close()
        if (columns.includes('discord_id')) throw new Error('feedback table carries an author column')
        return 'no author column'
      },
    },
  ]
}

async function main(): Promise<void> {
  const env = parseEnv()
  const results = await runChecks([...m1Checks(env), ...m2Checks(), ...m3Checks(), ...m4Checks()])
  const failed = results.filter((r) => !r.ok).length

  const client = createClient()
  await new Promise<void>((resolve) => {
    client.once(Events.ClientReady, () => resolve())
    void client.login(env.DISCORD_BOT_TOKEN)
  })

  const channel = await client.channels.fetch(env.LOG_CHANNEL_ID)
  if (channel?.isSendable()) {
    await channel.send({
      components: [
        container({
          header: failed === 0 ? 'Smoke passed' : `Smoke failed — ${failed}`,
          blocks: [formatResults(results).join('\n')],
        }),
      ],
      flags: MessageFlags.IsComponentsV2,
    })
  }

  await client.destroy()
  process.exit(failed === 0 ? 0 : 1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
