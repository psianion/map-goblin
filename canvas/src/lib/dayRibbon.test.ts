import { describe, it, expect } from 'vitest'
import { DAY_MINUTES, KEY_MINUTES, timeColorAt } from '@/store/types'
import { DAY_START, dayGradient, offsetMinutes, ribbonOffset, ribbonX } from './dayRibbon'

describe('day ribbon scale', () => {
  it('puts midnight inside the track, not on both edges', () => {
    expect(ribbonX(DAY_START)).toBe(0)
    expect(ribbonX(KEY_MINUTES.night)).toBe(87.5)
    expect(ribbonX(KEY_MINUTES.noon)).toBe(37.5)
  })

  it('round-trips scrub offsets through midnight', () => {
    for (const minutes of [0, 5, 179, 180, 720, 1435]) {
      expect(offsetMinutes(ribbonOffset(minutes))).toBe(minutes)
    }
  })
})

describe('dayGradient', () => {
  it('samples the colour function it is given rather than interpolating its own', () => {
    const seen: number[] = []
    const gradient = dayGradient((m) => {
      seen.push(m)
      return '#010203'
    })

    // Every stop is a call into the engine's colour function — nothing between the keyframes
    // is invented here, which is what keeps the ribbon from drifting from the canvas.
    expect(seen).toHaveLength(gradient.split('#').length - 1)
    expect(seen[0]).toBe(DAY_START)
    expect(seen.every((m) => m >= 0 && m < DAY_MINUTES)).toBe(true)
    expect(gradient.startsWith('linear-gradient(90deg, #010203 0.00%')).toBe(true)
    expect(gradient.endsWith('#010203 100.00%)')).toBe(true)
  })

  it('carries the real interpolated palette colours at their own hours', () => {
    const gradient = dayGradient((m) => timeColorAt({ preset: 'desert' }, m))
    expect(gradient).toContain(timeColorAt({ preset: 'desert' }, KEY_MINUTES.noon))
    expect(gradient).toContain(timeColorAt({ preset: 'desert' }, KEY_MINUTES.evening))
  })
})
