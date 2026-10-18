import { describe, expect, it } from 'vitest'
import { HEALTH_ACCENT_BAD, HEALTH_ACCENT_OK, healthBoard, type HealthInput } from './health'
import { cardText } from '../lib/card'

const NOW = 1_700_000_000_000
const DAY = 24 * 60 * 60 * 1000

const base: HealthInput = {
  botTag: 'Eye#6885',
  commit: 'abc1234',
  bootAt: NOW - 3 * 60 * 60 * 1000 - 12 * 60 * 1000,
  gatewayMs: 292,
  commandCount: 18,
  guildName: 'Goblin Den',
  serverMs: 8,
  serverUrl: 'http://127.0.0.1:5600',
  seats: [{ campaignName: 'Fieldstone Keep', expiresAt: NOW + 6 * DAY + 1000 }],
  tables: [
    {
      campaignId: 'camp-1',
      joinUrl: 'https://table.example/join/AB2CD3',
      campaignName: 'Fieldstone Keep',
      sceneName: 'Riverside Mill',
      players: 1,
      dmConnected: true,
      connected: true,
      attempts: 0,
      startedAt: NOW - 42 * 60 * 1000,
    },
  ],
  dbOk: true,
  rssBytes: 34 * 1048576,
  nodeVersion: 'v22.14.0',
  now: NOW,
}

const text = (input: HealthInput): string => cardText(healthBoard(input))

describe('healthBoard', () => {
  it('renders every line green when everything answers', () => {
    const board = healthBoard(base)
    expect(board.accent).toBe(HEALTH_ACCENT_OK)
    expect(board.eyebrow).toBe('Health · Eye#6885')
    expect(board.header).toBe('All systems steady')
    expect(board.footer).toBe('Up 3h 12m · build abc1234')
    expect(text(base)).toBe(
      [
        'Health · Eye#6885',
        'All systems steady',
        '**Discord**  gateway 292ms · 18 commands · Goblin Den',
        '**Server**  http://127.0.0.1:5600 reachable 8ms · seats fresh (6d)',
        '**Table**  Fieldstone Keep · Riverside Mill · 1 player · observer ok · 42m',
        '**Storage**  db ok · 34 MB rss · node v22.14.0',
        'Up 3h 12m · build abc1234',
      ].join('\n'),
    )
  })

  it('goes red and names the cause for a dead server, dead seats, or a reconnecting observer', () => {
    expect(healthBoard({ ...base, serverMs: null }).accent).toBe(HEALTH_ACCENT_BAD)
    expect(text({ ...base, serverMs: null })).toContain('http://127.0.0.1:5600 UNREACHABLE')

    const dead = { ...base, seats: [{ campaignName: 'Fieldstone Keep', expiresAt: NOW - 1 }] }
    expect(healthBoard(dead).accent).toBe(HEALTH_ACCENT_BAD)
    expect(text(dead)).toContain('seats EXPIRED: Fieldstone Keep')

    const flapping = { ...base, tables: [{ ...base.tables[0]!, connected: false, attempts: 3 }] }
    expect(healthBoard(flapping).accent).toBe(HEALTH_ACCENT_BAD)
    expect(text(flapping)).toContain('observer reconnecting, attempt 3')
  })

  it('flags seats inside the refresh margin without going red, and says when nothing runs', () => {
    const soon = {
      ...base,
      seats: [{ campaignName: 'Fieldstone Keep', expiresAt: NOW + 4 * 60 * 60 * 1000 }],
      tables: [],
    }
    const board = healthBoard(soon)
    expect(board.accent).toBe(HEALTH_ACCENT_OK)
    expect(text(soon)).toContain('seats renew on next use (4h)')
    expect(text(soon)).toContain('**Tables**  none running')
  })
})
