import { describe, it, expect } from 'vitest'

function hexToNumber(hex: string): number {
  return parseInt(hex.replace('#', ''), 16)
}

function computeSpriteScale(scale: number, flipX: boolean, flipY: boolean) {
  return {
    x: scale * (flipX ? -1 : 1),
    y: scale * (flipY ? -1 : 1),
  }
}

describe('hexToNumber', () => {
  it('converts #ffffff to 0xffffff', () => {
    expect(hexToNumber('#ffffff')).toBe(0xffffff)
  })
  it('converts #ff0000 to 0xff0000', () => {
    expect(hexToNumber('#ff0000')).toBe(0xff0000)
  })
  it('handles hash-less hex strings', () => {
    expect(hexToNumber('1a2b3c')).toBe(0x1a2b3c)
  })
})

describe('computeSpriteScale', () => {
  it('applies scale without flip', () => {
    const s = computeSpriteScale(2, false, false)
    expect(s.x).toBe(2)
    expect(s.y).toBe(2)
  })
  it('negates x for flipX', () => {
    const s = computeSpriteScale(1.5, true, false)
    expect(s.x).toBe(-1.5)
    expect(s.y).toBe(1.5)
  })
  it('negates y for flipY', () => {
    const s = computeSpriteScale(1.5, false, true)
    expect(s.x).toBe(1.5)
    expect(s.y).toBe(-1.5)
  })
  it('negates both for flipX + flipY', () => {
    const s = computeSpriteScale(2, true, true)
    expect(s.x).toBe(-2)
    expect(s.y).toBe(-2)
  })
})
