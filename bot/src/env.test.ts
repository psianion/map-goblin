import { describe, expect, it } from 'vitest'
import { parseEnv } from './env'

const good = {
  DISCORD_BOT_TOKEN: 'tok',
  DISCORD_APP_ID: '123456789012345678',
  DISCORD_GUILD_ID: '123456789012345678',
  DISCORD_OWNER_ID: '123456789012345678',
  LOG_CHANNEL_ID: '123456789012345678',
  LFG_CHANNEL_ID: '123456789012345678',
  GOBLIN_SERVER_URL: 'http://localhost:8787',
  GOBLIN_ADMIN_PASS: 'pass',
  PUBLIC_TABLE_URL: 'https://table.example.com',
  BOT_DATA: '/data',
}

describe('parseEnv', () => {
  it('parses a complete env', () => {
    const env = parseEnv(good)
    expect(env.DISCORD_APP_ID).toBe('123456789012345678')
    expect(env.DEV_FEATURES.size).toBe(0)
  })

  it('splits DEV_FEATURES into a set', () => {
    expect([...parseEnv({ ...good, DEV_FEATURES: 'map, ping ,' }).DEV_FEATURES]).toEqual(['map', 'ping'])
  })

  it.each(Object.keys(good))('fails naming the missing field %s', (field) => {
    const partial = { ...good, [field]: undefined }
    expect(() => parseEnv(partial)).toThrowError(new RegExp(field))
  })

  it('rejects a non-snowflake id', () => {
    expect(() => parseEnv({ ...good, DISCORD_OWNER_ID: 'sainayan' })).toThrowError(/DISCORD_OWNER_ID/)
  })

  it('never puts a value in the error', () => {
    expect(() => parseEnv({ ...good, DISCORD_BOT_TOKEN: '' })).not.toThrowError(/tok/)
  })

  it('accepts https and loopback http, rejects plaintext off-box', () => {
    expect(parseEnv({ ...good, GOBLIN_SERVER_URL: 'https://goblin.example.com' })).toBeTruthy()
    expect(parseEnv({ ...good, GOBLIN_SERVER_URL: 'http://127.0.0.1:8787' })).toBeTruthy()
    expect(() => parseEnv({ ...good, GOBLIN_SERVER_URL: 'http://goblin.example.com' })).toThrowError(
      /GOBLIN_SERVER_URL/,
    )
    expect(() => parseEnv({ ...good, GOBLIN_SERVER_URL: 'not-a-url' })).toThrowError(/GOBLIN_SERVER_URL/)
  })
})
