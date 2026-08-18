// The one entry point for interactionCreate, and the one place that catches. Two rules the
// whole design leans on:
//   1. authorize runs BEFORE deferReply — an unauthorized user must not see the bot think.
//   2. command bodies are try/catch-free; they throw BotError and this maps it to a reply.

import {
  MessageFlags,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
  type MessageComponentInteraction,
} from 'discord.js'
import { parse } from '../lib/custom-id'
import { BotError, notAuthorized, notFound, toUserReply } from '../lib/errors'
import { log as defaultLog } from '../lib/log'
import type { AuthContext, Deps, Registry } from './command-registry'

export interface RouterDeps extends Deps {
  registry: Registry
  /** One audit line per command, usually channelLog.audit. */
  audit?: (line: string) => void
  logger?: Pick<typeof defaultLog, 'warn' | 'error'>
}

type MemberLike = { roles?: string[] | { cache: Map<string, unknown> } } | null

function roleIdsOf(member: MemberLike): string[] {
  const roles = member?.roles
  if (!roles) return []
  return Array.isArray(roles) ? roles : [...roles.cache.keys()]
}

function contextOf(interaction: ChatInputCommandInteraction | MessageComponentInteraction): AuthContext {
  return {
    userId: interaction.user.id,
    channelId: interaction.channelId ?? '',
    roleIds: roleIdsOf(interaction.member as MemberLike),
  }
}

export async function routeInteraction(interaction: Interaction, deps: RouterDeps): Promise<void> {
  if (interaction.isChatInputCommand()) return routeCommand(interaction, deps)
  if (interaction.isAutocomplete()) return routeAutocomplete(interaction, deps)
  if (interaction.isMessageComponent()) return routeComponent(interaction, deps)
}

async function routeCommand(interaction: ChatInputCommandInteraction, deps: RouterDeps): Promise<void> {
  const started = Date.now()
  const label = `/${interaction.commandName} by @${interaction.user.username}`
  try {
    const command = deps.registry[interaction.commandName]
    if (!command) throw notFound(`I don't have a /${interaction.commandName} any more.`)

    command.authorize(contextOf(interaction), deps)
    await interaction.deferReply(command.ephemeral === false ? {} : { flags: MessageFlags.Ephemeral })
    await command.execute(interaction, deps)

    deps.audit?.(`✅ ${label} — ${elapsed(started)}`)
  } catch (err) {
    deps.audit?.(`❌ ${label} — ${elapsed(started)}`)
    report(err, deps, { interaction: interaction.commandName })
    await replyError(interaction, err)
  }
}

async function routeComponent(interaction: MessageComponentInteraction, deps: RouterDeps): Promise<void> {
  try {
    const id = parse(interaction.customId)
    if (!id) throw notFound('That control is from an older message.')
    // Owner stamp: one player cannot drive another player's buttons.
    if (id.userId !== interaction.user.id) throw notAuthorized("That's someone else's button.")

    const handler = deps.registry[id.namespace]?.component
    if (!handler) throw notFound('That control is from an older message.')
    await handler(interaction, id, deps)
  } catch (err) {
    report(err, deps, { component: interaction.customId })
    await replyError(interaction, err)
  }
}

async function routeAutocomplete(interaction: AutocompleteInteraction, deps: RouterDeps): Promise<void> {
  // Autocomplete has no error surface — a failure is an empty list, never a reply.
  try {
    await deps.registry[interaction.commandName]?.autocomplete?.(interaction, deps)
  } catch (err) {
    report(err, deps, { autocomplete: interaction.commandName })
    await interaction.respond([]).catch(() => {})
  }
}

function elapsed(started: number): string {
  return `${((Date.now() - started) / 1000).toFixed(1)}s`
}

function report(err: unknown, deps: RouterDeps, context: Record<string, unknown>): void {
  const logger = deps.logger ?? defaultLog
  if (err instanceof BotError) logger.warn(err.code, { ...context, message: err.userMessage })
  else logger.error('unhandled interaction error', { ...context, error: String(err) })
}

async function replyError(
  interaction: ChatInputCommandInteraction | MessageComponentInteraction,
  err: unknown,
): Promise<void> {
  const content = toUserReply(err)
  // Swallowed: a dead or expired interaction is not worth a second failure.
  if (interaction.deferred || interaction.replied) await interaction.editReply({ content }).catch(() => {})
  else await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {})
}
