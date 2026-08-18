// Guild-scoped registration, driven by the same registry the router dispatches from — the
// only way "deployed" and "handled" cannot drift. Run with `pnpm --filter @dnd/bot sync`.

import { REST, Routes } from 'discord.js'
import { pathToFileURL } from 'node:url'
import { parseEnv, type Env } from '../env'
import { log } from '../lib/log'
import { registry, type Registry } from './command-registry'

/** Declarations to PUT: dev-only commands stay off the guild unless DEV_FEATURES names them. */
export function commandsToDeploy(
  reg: Registry,
  devFeatures: ReadonlySet<string>,
): { name: string }[] {
  return Object.entries(reg)
    .filter(([name, command]) => !command.devOnly || devFeatures.has(name))
    .map(([, command]) => command.data.toJSON())
}

export interface SyncDiff {
  added: string[]
  removed: string[]
  unchanged: string[]
}

export function syncDiff(declared: string[], deployed: string[]): SyncDiff {
  const live = new Set(deployed)
  const wanted = new Set(declared)
  return {
    added: declared.filter((name) => !live.has(name)).sort(),
    removed: deployed.filter((name) => !wanted.has(name)).sort(),
    unchanged: declared.filter((name) => live.has(name)).sort(),
  }
}

function restFor(env: Env): REST {
  return new REST({ version: '10' }).setToken(env.DISCORD_BOT_TOKEN)
}

export async function deployedCommandNames(env: Env, rest = restFor(env)): Promise<string[]> {
  const live = (await rest.get(
    Routes.applicationGuildCommands(env.DISCORD_APP_ID, env.DISCORD_GUILD_ID),
  )) as { name: string }[]
  return live.map((c) => c.name)
}

/** PUTs the full declared set (a PUT is also the deletion path) and reports what changed. */
export async function syncCommands(env: Env, reg: Registry = registry, rest = restFor(env)): Promise<SyncDiff> {
  const body = commandsToDeploy(reg, env.DEV_FEATURES)
  const before = await deployedCommandNames(env, rest)
  await rest.put(Routes.applicationGuildCommands(env.DISCORD_APP_ID, env.DISCORD_GUILD_ID), { body })
  return syncDiff(
    body.map((c) => c.name),
    before,
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = parseEnv()
  const diff = await syncCommands(env)
  log.info('commands synced', { guild: env.DISCORD_GUILD_ID, ...diff })
}
