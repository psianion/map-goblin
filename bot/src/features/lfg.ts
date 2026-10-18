// Pure model/reply formatting for the recruiting board + /apply (plan §11 M4). No discord.js
// import — command-registry.ts wires this to the lfg_posts/lfg_applications stores. The file
// keeps its name; the commands and every word a reader sees say "recruiting".

import type { Campaign } from '../db/stores'
import { userInput } from '../lib/errors'
import { type Block, TONE, type ContainerSpec } from '../lib/card'

/** Discord draws these in each reader's own timezone and keeps the relative one counting. */
const stamp = (ms: number): string => `<t:${Math.floor(ms / 1000)}:R>`

/** A writer's own words, block-quoted so the card never reads them as the bot's. */
const quoted = (text: string): string => `> ${text.replace(/\n/g, '\n> ')}`

// ── the two forms, and what their values have to be ──────────────────────────────────────

/** The seat counts the open form offers. Strings: a select's value is one. */
export const SEAT_COUNTS = ['1', '2', '3', '4', '5', '6'] as const

/** Ticked on the open form, shown verbatim on the board post — so each one reads as a phrase
 * a player scanning the board can act on, not a slug. */
export const RECRUIT_TAGS = ['New players welcome', 'Voice', 'Weekly', 'One-shot'] as const

/** The three answers the apply form's radio offers. */
export const EXPERIENCE_LEVELS = ['New to D&D', 'Played some', 'Veteran'] as const

export const MAX_BLURB = 1000
export const MAX_PITCH = 1000
export const MAX_AVAILABILITY = 100

export interface RecruitDraft {
  blurb: string
  seats: number
  tags: string[]
}

/**
 * The open form, checked at the trust boundary: a modal's values arrive as strings off the
 * wire, and the option lists are a suggestion to the client, not a guarantee. A refusal reads
 * the blurb back — the form is gone by the time this runs, so the card has to hold the words
 * long enough to retype them.
 */
export function readRecruitDraft(fields: Record<string, string>): RecruitDraft {
  const blurb = (fields.blurb ?? '').trim()
  const seats = (fields.seats ?? '').trim()
  const refuse = (why: string): never => {
    throw userInput(`${why}\n-# You put · ${blurb || 'nothing'}`)
  }

  if (!blurb) refuse('Say something about the table — that blurb is the whole board post.')
  if (blurb.length > MAX_BLURB) refuse(`That blurb is ${blurb.length} characters — keep it to ${MAX_BLURB}.`)
  if (!(SEAT_COUNTS as readonly string[]).includes(seats))
    refuse(`Seats open has to be ${SEAT_COUNTS[0]} to ${SEAT_COUNTS[SEAT_COUNTS.length - 1]} — you put "${seats}".`)

  const tags = (fields.tags ?? '').split(',').filter((tag) => (RECRUIT_TAGS as readonly string[]).includes(tag))
  return { blurb, seats: Number(seats), tags }
}

export interface ApplicationDraft {
  message: string | null
  experience: string
  availability: string
}

/** The apply form, same boundary. The pitch is optional; the other two are what the DM sorts
 * a stack of applications by, so they are asked for and checked. */
export function readApplicationDraft(fields: Record<string, string>): ApplicationDraft {
  const message = (fields.pitch ?? '').trim()
  const experience = (fields.experience ?? '').trim()
  const availability = (fields.availability ?? '').trim()
  const refuse = (why: string): never => {
    throw userInput(`${why}\n-# You put · ${[availability, message].filter(Boolean).join(' · ') || 'nothing'}`)
  }

  if (message.length > MAX_PITCH) refuse(`That pitch is ${message.length} characters — keep it to ${MAX_PITCH}.`)
  if (!(EXPERIENCE_LEVELS as readonly string[]).includes(experience))
    refuse(`Pick one of ${EXPERIENCE_LEVELS.join(', ')} — you put "${experience}".`)
  if (!availability) refuse('Say when you can play — it is the first thing the DM checks.')
  if (availability.length > MAX_AVAILABILITY)
    refuse(`That is ${availability.length} characters — keep it to ${MAX_AVAILABILITY}.`)

  return { message: message || null, experience, availability }
}

// ── the cards ────────────────────────────────────────────────────────────────────────────

export function lfgBoardPost(
  campaign: Campaign,
  blurb: string,
  thumb?: string,
  seats?: number,
  tags: string[] = [],
): ContainerSpec {
  const blocks: Block[] = [`### About the table\n${quoted(blurb)}`]
  if (tags.length) blocks.push(`-# ${tags.join(' · ')}`)
  if (campaign.ddbUrl)
    blocks.push({ text: '-# The campaign page, if you want to read ahead', link: { label: 'D&D Beyond', url: campaign.ddbUrl } })
  return {
    accent: TONE.live,
    eyebrow: 'Looking for players',
    header: campaign.name,
    // The DM is named, not summoned: an application reaches them in their own channel.
    subhead: [`**DM** <@${campaign.dmDiscordId}>`, seats ? `**Seats open** · ${seats}` : '']
      .filter(Boolean)
      .join('\n'),
    noPing: true,
    ...(thumb ? { thumb, thumbAlt: 'Campaign banner' } : {}),
    blocks,
    footer: 'Press **Apply** and the DM hears from you directly',
  }
}

export function lfgClosedNotice(campaignName: string, thumb?: string): ContainerSpec {
  return {
    accent: TONE.quiet,
    eyebrow: 'Recruiting closed',
    header: campaignName,
    ...(thumb ? { thumb, thumbAlt: 'Campaign banner' } : {}),
    blocks: ['The table is full. Applications are closed for now.'],
  }
}

export function applicationCard(
  campaignName: string,
  dmDiscordId: string,
  applicantId: string,
  message: string | null,
  appliedAt: number,
  applicantAvatar?: string,
  experience?: string | null,
  availability?: string | null,
): ContainerSpec {
  // Above the pitch, because these two are what the DM sorts by and the pitch is what they
  // read once a row is worth reading.
  const answers = [
    experience ? `**Experience** · ${experience}` : '',
    availability ? `**Availability** · ${availability}` : '',
  ].filter(Boolean)
  return {
    eyebrow: `New application · ${campaignName}`,
    header: 'Someone wants a seat',
    ...(applicantAvatar ? { thumb: applicantAvatar, thumbAlt: 'The applicant’s avatar' } : {}),
    // The DM's mention stays in body text, not the footer: this line is the ping.
    blocks: [
      `<@${dmDiscordId}> — <@${applicantId}> would like to join.\n-# applied ${stamp(appliedAt)}`,
      ...(answers.length ? [answers.join('\n')] : []),
      ...(message ? [{ rule: 'line' } as const, `### Their pitch\n${quoted(message)}`] : []),
    ],
    footer: 'Reach out to them directly to talk it through',
  }
}

export function applyConfirmation(campaignName: string): string {
  return `Application sent to **${campaignName}**'s DM.`
}

export function lfgOpenConfirmation(campaignName: string): string {
  return `**${campaignName}** is now recruiting on the board.`
}

export function lfgCloseConfirmation(campaignName: string): string {
  return `**${campaignName}** is no longer recruiting.`
}
