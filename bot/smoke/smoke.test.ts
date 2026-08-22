import { describe, expect, it } from 'vitest'
import { formatResults, runChecks } from './smoke'

describe('runChecks', () => {
  it('records notes, turns throws into failures, and keeps going', async () => {
    const results = await runChecks([
      { name: 'env', run: async () => '11 fields validated' },
      {
        name: 'command sync',
        run: async () => {
          throw new Error('drift — missing [map]')
        },
      },
      { name: 'database', run: async () => 'open' },
    ])

    expect(results).toEqual([
      { name: 'env', ok: true, note: '11 fields validated' },
      { name: 'command sync', ok: false, note: 'drift — missing [map]' },
      { name: 'database', ok: true, note: 'open' },
    ])
  })

  it('formats a checklist a human can read at a glance', () => {
    expect(formatResults([{ name: 'env', ok: true, note: 'ok' }])).toEqual(['✅ **env** — ok'])
  })
})
