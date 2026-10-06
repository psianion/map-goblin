// Pure formatting for the in-game calendar (plan §11 M3). `calendarLine` is the seam
// milestone 5's session recaps embed directly.

import type { CalendarState } from '../db/stores'
import { type ContainerSpec } from '../lib/card'

/** "Day 37 — The Long Winter", or the day-1 default before a DM has touched it. */
export function calendarLine(state: CalendarState | undefined): string {
  if (!state) return 'Day 1'
  return state.epochLabel ? `Day ${state.day} — ${state.epochLabel}` : `Day ${state.day}`
}

export function calendarShow(state: CalendarState | undefined, campaignName?: string, thumb?: string): ContainerSpec {
  return {
    eyebrow: campaignName ? `World calendar · ${campaignName}` : 'World calendar',
    header: `Day ${state?.day ?? 1}`,
    big: true,
    ...(state?.epochLabel ? { subhead: `_${state.epochLabel}_` } : {}),
    ...(thumb ? { thumb, thumbAlt: 'World calendar' } : {}),
    footer: '`/calendar advance` moves the date · DM only',
  }
}

export function calendarSetConfirmation(state: CalendarState): string {
  return `Set to **${calendarLine(state)}**.`
}

export function calendarAdvanceAnnouncement(state: CalendarState, days: number, thumb?: string): ContainerSpec {
  const singular = Math.abs(days) === 1
  return {
    eyebrow: 'World calendar',
    header: `${days} day${singular ? '' : 's'} ${singular ? 'passes' : 'pass'}`,
    ...(thumb ? { thumb, thumbAlt: 'World calendar' } : {}),
    blocks: [`It is now **${calendarLine(state)}**.`],
  }
}
