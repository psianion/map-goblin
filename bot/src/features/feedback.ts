// Pure model for /feedback (plan §11 M4 / §7). No discord.js import — command-registry.ts
// wires this to the feedback store, which has no discord_id column at all.

import { userInput } from '../lib/errors'
import { TONE, type ContainerSpec } from '../lib/card'

/** Discord draws this in each reader's own timezone and keeps it counting. */
const stamp = (ms: number): string => `<t:${Math.floor(ms / 1000)}:R>`

/** The three the form's radio offers — the DM's sorting, one tap. */
export const FEEDBACK_CATEGORIES = ['Bug', 'Idea', 'Praise'] as const

export const MAX_FEEDBACK = 1000

/** The form, checked at the trust boundary. The refusal reads the text back, since the form
 * is gone by the time this runs and nothing else holds what they wrote. */
export function readFeedbackDraft(fields: Record<string, string>): { text: string; category: string } {
  const text = (fields.text ?? '').trim()
  const category = (fields.category ?? '').trim()
  const refuse = (why: string): never => {
    throw userInput(`${why}\n-# You put · ${text || 'nothing'}`)
  }

  if (!(FEEDBACK_CATEGORIES as readonly string[]).includes(category))
    refuse(`Pick one of ${FEEDBACK_CATEGORIES.join(', ')} — you put "${category}".`)
  if (!text) refuse('There is nothing in there to send.')
  if (text.length > MAX_FEEDBACK) refuse(`That is ${text.length} characters — keep it to ${MAX_FEEDBACK}.`)

  return { text, category }
}

export function feedbackCard(
  campaignName: string,
  text: string,
  sentAt: number,
  thumb?: string,
  category?: string | null,
): ContainerSpec {
  return {
    accent: TONE.quiet,
    eyebrow: [`Anonymous feedback · ${campaignName}`, category].filter(Boolean).join(' · '),
    header: 'Someone at the table said this',
    ...(thumb ? { thumb, thumbAlt: 'A sealed letter' } : {}),
    blocks: [`> ${text.replace(/\n/g, '\n> ')}`, `-# sent ${stamp(sentAt)}`],
    footer: 'Sent without a name. The bot keeps no record of who wrote it.',
  }
}

export function feedbackThanks(): string {
  return 'Thanks — sent anonymously to the DM.'
}
