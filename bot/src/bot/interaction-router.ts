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
  type ModalSubmitInteraction,
} from 'discord.js'
import { parse, SHARED_OWNER } from '../lib/custom-id'
import { notice, TONE } from '../lib/card'
import { BotError, notAuthorized, notFound, toUserReply, type BotErrorCode } from '../lib/errors'
import { container } from '../lib/ui'
import { log as defaultLog } from '../lib/log'
import type { AuthContext, Deps, Registry } from './command-registry'

export interface RouterDeps extends Deps {
  registry: Registry
  /** One audit line per command, usually channelLog.audit. */
  audit?: (line: string) => void
  logger?: Pick<typeof defaultLog, 'warn' | 'error'>
}

/** A button the bot can no longer act on — the message outlived the build that made it. Says
 * the one thing that fixes it, because nothing about a dead button suggests it. */
const OLD_CONTROL = 'That control is from an older message — run the command again.'

/** Its modal twin: a form left open across a restart submits into a build that no longer
 * knows it. Same fix, different noun. */
const OLD_FORM = 'That form is from an older message — run the command again.'

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
    // Only chat input interactions carry a subcommand; lets authorize give different roles
    // to different subcommands of the same command (e.g. /quests log vs /quests add).
    subcommand: 'options' in interaction ? (interaction.options.getSubcommand(false) ?? undefined) : undefined,
  }
}

export async function routeInteraction(interaction: Interaction, deps: RouterDeps): Promise<void> {
  if (interaction.isChatInputCommand()) return routeCommand(interaction, deps)
  if (interaction.isAutocomplete()) return routeAutocomplete(interaction, deps)
  if (interaction.isMessageComponent()) return routeComponent(interaction, deps)
  if (interaction.isModalSubmit()) return routeModal(interaction, deps)
}

async function routeCommand(interaction: ChatInputCommandInteraction, deps: RouterDeps): Promise<void> {
  const started = Date.now()
  const label = `/${interaction.commandName} by @${interaction.user.username}`
  try {
    const command = deps.registry[interaction.commandName]
    if (!command) throw notFound(`I don't have a /${interaction.commandName} any more.`)

    command.authorize(contextOf(interaction), deps)
    // A modal has to be the command's *first* response, so a command that opens one is never
    // deferred — its execute calls showModal and the work happens on the submit.
    if (!command.opensModal?.(interaction)) {
      const ephemeral = typeof command.ephemeral === 'function' ? command.ephemeral(interaction) : command.ephemeral !== false
      await interaction.deferReply(ephemeral ? { flags: MessageFlags.Ephemeral } : {})
    }
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
    if (!id) throw notFound(OLD_CONTROL)
    // Owner stamp: one player cannot drive another player's buttons — unless it's stamped
    // shared (poll votes, LFG apply), where the handler itself does the auth.
    if (id.userId !== SHARED_OWNER && id.userId !== interaction.user.id)
      throw notAuthorized("That's someone else's button — run the command yourself to get your own.")

    const handler = deps.registry[id.namespace]?.component
    if (!handler) throw notFound(OLD_CONTROL)
    await handler(interaction, id, deps)
  } catch (err) {
    report(err, deps, { component: interaction.customId })
    await replyError(interaction, err)
  }
}

async function routeModal(interaction: ModalSubmitInteraction, deps: RouterDeps): Promise<void> {
  try {
    const id = parse(interaction.customId)
    if (!id) throw notFound(OLD_FORM)
    // Same owner stamp as a button: the form was opened for one person, and only they submit
    // it — unless it is stamped shared, where the handler does its own auth.
    if (id.userId !== SHARED_OWNER && id.userId !== interaction.user.id)
      throw notAuthorized("That's someone else's form — run the command yourself to get your own.")

    const handler = deps.registry[id.namespace]?.modal
    if (!handler) throw notFound(OLD_FORM)
    // Deferred here rather than in every handler: a submit always writes something and often
    // talks to the game server first, and a modal has no "thinking" state of its own.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral })
    await handler(interaction, id, deps)
  } catch (err) {
    report(err, deps, { modal: interaction.customId })
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

/** What went wrong, in two words, above the sentence that says what to do about it. */
const ERROR_EYEBROW: Record<BotErrorCode, string> = {
  not_authorized: 'Not yours to use',
  wrong_channel: 'Wrong channel',
  not_found: 'Not found',
  user_input: 'Check that again',
  internal: 'Something broke',
}

async function replyError(
  interaction: ChatInputCommandInteraction | MessageComponentInteraction | ModalSubmitInteraction,
  err: unknown,
): Promise<void> {
  const eyebrow = ERROR_EYEBROW[err instanceof BotError ? err.code : 'internal']
  const components = [container(notice(toUserReply(err), eyebrow, TONE.alert))]
  // Swallowed: a dead or expired interaction is not worth a second failure.
  if (interaction.deferred || interaction.replied)
    await interaction.editReply({ components, flags: MessageFlags.IsComponentsV2 }).catch(() => {})
  else
    await interaction.reply({ components, flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral] }).catch(() => {})
}
