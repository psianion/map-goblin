import { describe, expect, it, vi } from 'vitest'
import { nicknameFor, trySyncNickname } from './nickname'

describe('nicknameFor', () => {
  it('appends the player suffix', () => {
    expect(nicknameFor('Thalor')).toBe('Thalor (Player)')
  })

  it('truncates the name, not the suffix, to the 32-char cap', () => {
    const nick = nicknameFor('A'.repeat(40))
    expect(nick).toHaveLength(32)
    expect(nick.endsWith(' (Player)')).toBe(true)
  })
})

describe('trySyncNickname', () => {
  it('sets the nickname when the member is manageable', async () => {
    const setNickname = vi.fn(async () => {})
    const member = { id: 'user-1', manageable: true, setNickname }
    await trySyncNickname(member, 'Thalor')
    expect(setNickname).toHaveBeenCalledWith('Thalor (Player)')
  })

  it('skips silently and warns when the member outranks the bot', async () => {
    const setNickname = vi.fn(async () => {})
    const warn = vi.fn()
    const member = { id: 'user-1', manageable: false, setNickname }
    await trySyncNickname(member, 'Thalor', { warn })
    expect(setNickname).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('never throws when setNickname itself rejects', async () => {
    const setNickname = vi.fn(async () => {
      throw new Error('missing permission')
    })
    const warn = vi.fn()
    const member = { id: 'user-1', manageable: true, setNickname }
    await expect(trySyncNickname(member, 'Thalor', { warn })).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledOnce()
  })
})
