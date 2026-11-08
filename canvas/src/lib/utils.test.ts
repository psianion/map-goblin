import { describe, expect, it } from 'vitest'
import { cn } from './utils'

describe('cn', () => {
  it('keeps a font size next to a v2 text colour', () => {
    expect(cn('text-[10px]', 'text-text-2')).toBe('text-[10px] text-text-2')
  })

  it('still merges real conflicts', () => {
    expect(cn('text-[10px]', 'text-[11px]')).toBe('text-[11px]')
    expect(cn('text-text-3', 'text-text')).toBe('text-text')
  })
})
