import { describe, expect, it } from 'vitest'
import { cn } from './utils'

describe('cn', () => {
  it('keeps custom font-size utilities next to text colors', () => {
    expect(cn('text-panel-body', 'text-text-primary')).toBe('text-panel-body text-text-primary')
  })

  it('still merges real conflicts', () => {
    expect(cn('text-panel-body', 'text-panel-small')).toBe('text-panel-small')
    expect(cn('text-text-muted', 'text-text-primary')).toBe('text-text-primary')
  })
})
