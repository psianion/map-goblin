import { describe, it, expect, beforeEach, vi } from 'vitest'
import { CatalogBrowser, hammingDistance, type CatalogMeta, type CatalogEntry } from './catalogBrowser'

const MOCK_META: CatalogMeta = {
  version: '1.0.0',
  totalEntries: 4,
  chunkCount: 2,
  chunks: [
    { index: 0, url: 'chunks/0.json', entryCount: 2 },
    { index: 1, url: 'chunks/1.json', entryCount: 2 },
  ],
  invertedIndex: {
    floor: [0],
    wall: [1],
    dungeon: [0, 1],
    cave: [0],
  },
}

const CHUNK_0: CatalogEntry[] = [
  {
    entryId: 'dungeon-classic:stone_1x1_floor_A',
    packId: 'dungeon-classic',
    localId: 'stone_1x1_floor_A',
    type: 'floor',
    theme: 'dungeon',
    material: 'stone',
    tags: ['indoor', 'dungeon'],
    pHash: 'a0b1c2d3',
    thumbnailUrl: '/thumb/stone_floor.webp',
  },
  {
    entryId: 'dungeon-classic:cave_1x1_floor_B',
    packId: 'dungeon-classic',
    localId: 'cave_1x1_floor_B',
    type: 'floor',
    theme: 'cave',
    material: 'stone',
    tags: ['underground'],
    pHash: 'a0b1c2d4',
    thumbnailUrl: '/thumb/cave_floor.webp',
  },
]

const CHUNK_1: CatalogEntry[] = [
  {
    entryId: 'dungeon-classic:stone-slate_straight_wall_A',
    packId: 'dungeon-classic',
    localId: 'stone-slate_straight_wall_A',
    type: 'wall',
    theme: 'dungeon',
    material: 'stone-slate',
    tags: ['indoor', 'dungeon'],
    pHash: 'ff00ff00',
    thumbnailUrl: '/thumb/stone_wall.webp',
  },
  {
    entryId: 'dungeon-classic:stone-slate_corner_wall_A',
    packId: 'dungeon-classic',
    localId: 'stone-slate_corner_wall_A',
    type: 'wall',
    theme: 'dungeon',
    material: 'stone-slate',
    tags: ['indoor', 'dungeon'],
    thumbnailUrl: '/thumb/stone_corner.webp',
  },
]

function createMockFetch() {
  return vi.fn(async (url: string) => {
    if (url.endsWith('/meta.json')) {
      return { json: async () => MOCK_META } as Response
    }
    if (url.endsWith('/chunks/0.json')) {
      return { json: async () => CHUNK_0 } as Response
    }
    if (url.endsWith('/chunks/1.json')) {
      return { json: async () => CHUNK_1 } as Response
    }
    throw new Error(`Unexpected fetch: ${url}`)
  })
}

describe('CatalogBrowser', () => {
  let browser: CatalogBrowser
  let mockFetch: ReturnType<typeof createMockFetch>

  beforeEach(() => {
    mockFetch = createMockFetch()
    browser = new CatalogBrowser('https://cdn.example.com', mockFetch)
  })

  it('fetches and caches meta.json', async () => {
    const meta = await browser.loadMeta()
    expect(meta.version).toBe('1.0.0')
    expect(meta.chunkCount).toBe(2)

    // Second call should use cache (no additional fetch)
    await browser.loadMeta()
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('uses inverted index to load only relevant chunks', async () => {
    const results = await browser.search({ type: 'floor' })
    // Should only fetch meta + chunk 0 (floor is in chunk 0 only)
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(results).toHaveLength(2)
    expect(results.every((r) => r.type === 'floor')).toBe(true)
  })

  it('filters within loaded chunks by theme and query', async () => {
    const results = await browser.search({ type: 'floor', theme: 'cave' })
    expect(results).toHaveLength(1)
    expect(results[0]!.localId).toBe('cave_1x1_floor_B')
  })

  it('finds similar entries by pHash Hamming distance', async () => {
    // First load chunks so there's data to search
    await browser.search({})

    // a0b1c2d3 vs a0b1c2d4 should be very close
    const similar = browser.findSimilar('a0b1c2d3', 8)
    expect(similar.length).toBeGreaterThanOrEqual(1)
    expect(similar[0]!.pHash).toBe('a0b1c2d3')
  })
})

describe('hammingDistance', () => {
  it('returns 0 for identical hashes', () => {
    expect(hammingDistance('abcd1234', 'abcd1234')).toBe(0)
  })

  it('counts differing bits between hex strings', () => {
    // '0' = 0000, '1' = 0001 → 1 bit different
    expect(hammingDistance('0', '1')).toBe(1)
    // 'f' = 1111, '0' = 0000 → 4 bits different
    expect(hammingDistance('f', '0')).toBe(4)
  })

  it('returns Infinity for different-length strings', () => {
    expect(hammingDistance('abc', 'abcd')).toBe(Infinity)
  })
})
