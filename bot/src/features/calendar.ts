// Pure formatting for the in-game calendar (plan §11 M3). `calendarLine` is the seam
// milestone 5's session recaps embed directly.

import type { CalendarState } from '../db/stores'
import type { ContainerSpec } from '../lib/ui'

/** "Day 37 — The Long Winter", or the day-1 default before a DM has touched it. */
export function calendarLine(state: CalendarState | undefined): string {
  if (!state) return 'Day 1'
  return state.epochLabel ? `Day ${state.day} — ${state.epochLabel}` : `Day ${state.day}`
}

export function calendarShow(state: CalendarState | undefined): ContainerSpec {
  return { header: 'Calendar', blocks: [calendarLine(state)] }
}

export function calendarSetConfirmation(state: CalendarState): string {
  return `Set to **${calendarLine(state)}**.`
}

export function calendarAdvanceAnnouncement(state: CalendarState, days: number): ContainerSpec {
  const singular = Math.abs(days) === 1
  return {
    header: `${days} day${singular ? '' : 's'} ${singular ? 'passes' : 'pass'}`,
    blocks: [`It is now **${calendarLine(state)}**.`],
  }
}
