// Decision 14: every published scene also lives on disk as exactly one .ggvtt, so a DM's
// maps survive a lost browser and a broken database alike. The file is the editor's own
// container (`MPBLD\0` + gzip of the stored JSON), overwritten in place on every publish,
// moved on a rename and removed with its scene. Never a copy per publish.

import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import type { Stores } from './db/stores'

const MAGIC = Buffer.from('MPBLD\0', 'latin1')
const EXT = '.ggvtt'

/** Lowercase kebab of a name, at most 40 characters; `fallback` when nothing is left. */
export function slug(name: string, fallback: string): string {
  const kebab = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
  return kebab || fallback
}

/** A stored map row's JSON as the file the editor writes and opens. */
export function mapFileBytes(json: string): Buffer {
  return Buffer.concat([MAGIC, gzipSync(Buffer.from(json, 'utf8'))])
}

/** `<campaign-slug>--<first 8 of its id>`, the campaign's folder under the mirror root. */
export function campaignDirName(campaign: { id: string; name: string }): string {
  return `${slug(campaign.name, 'campaign')}--${campaign.id.slice(0, 8)}`
}

/** `<scene-slug>--<first 8 of its id>.ggvtt`, in the export and on disk alike. */
export function sceneFileName(scene: { id: string; name: string }): string {
  return `${slug(scene.name, 'scene')}--${scene.id.slice(0, 8)}${EXT}`
}

/** `maps/` beside the database (`$GAME_SERVER_DATA/maps`); none for an in-memory one. */
export function mirrorRootFor(dbPath: string): string | null {
  return dbPath === ':memory:' ? null : resolve(dirname(dbPath), 'maps')
}

export interface Mirror {
  readonly root: string
  /** Write (or overwrite) the scene's file; a file left under its old name goes. */
  writeScene(sceneId: string): void
  /** The scene is gone: so is its file. */
  removeScene(campaignId: string, sceneId: string): void
  /** Startup: a file for every scene without one, and no file for a scene that is gone. */
  sync(): { written: number; removed: number }
}

type MirrorStores = Pick<Stores, 'campaigns' | 'scenes' | 'maps'>

export function createMirror(root: string, stores: MirrorStores): Mirror {
  const dirOf = (campaignId: string): string | null => {
    const campaign = stores.campaigns.get(campaignId)
    return campaign ? join(root, campaignDirName(campaign)) : null
  }

  /** Files in `dir` that belong to this scene, whatever name they were written under. */
  const filesOf = (dir: string, sceneId: string): string[] => {
    if (!existsSync(dir)) return []
    const tail = `--${sceneId.slice(0, 8)}${EXT}`
    return readdirSync(dir).filter((f) => f.endsWith(tail))
  }

  const write = (sceneId: string): boolean => {
    const scene = stores.scenes.get(sceneId)
    const dir = scene ? dirOf(scene.campaign_id) : null
    const map = scene ? stores.maps.get(scene.map_id) : undefined
    if (!scene || !dir || !map) return false
    mkdirSync(dir, { recursive: true })
    const name = sceneFileName(scene)
    // Temp file then rename: a reader (or a crash) never sees half a map.
    const temp = join(dir, `.${name}.${randomBytes(4).toString('hex')}.tmp`)
    writeFileSync(temp, mapFileBytes(map.data))
    renameSync(temp, join(dir, name))
    for (const old of filesOf(dir, sceneId)) if (old !== name) rmSync(join(dir, old), { force: true })
    return true
  }

  // The mirror is a safety copy: a disk that fails it is logged, never a failed publish.
  const guard = (what: string, run: () => void) => {
    try {
      run()
    } catch (error) {
      console.error(`mirror: ${what} failed:`, error)
    }
  }

  return {
    root,
    writeScene(sceneId) {
      guard(`writing scene ${sceneId}`, () => void write(sceneId))
    },
    removeScene(campaignId, sceneId) {
      guard(`removing scene ${sceneId}`, () => {
        const dir = dirOf(campaignId)
        if (!dir) return
        for (const file of filesOf(dir, sceneId)) rmSync(join(dir, file), { force: true })
      })
    },
    sync() {
      let written = 0
      let removed = 0
      const expected = new Set<string>()
      for (const campaign of stores.campaigns.list()) {
        const dir = join(root, campaignDirName(campaign))
        for (const scene of stores.scenes.listByCampaign(campaign.id)) {
          const path = join(dir, sceneFileName(scene))
          expected.add(path)
          if (!existsSync(path)) guard(`writing scene ${scene.id}`, () => void (write(scene.id) && written++))
        }
      }
      if (!existsSync(root)) return { written, removed }
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const dir = join(root, entry.name)
        for (const file of readdirSync(dir)) {
          const path = join(dir, file)
          if ((file.endsWith(EXT) || file.endsWith('.tmp')) && !expected.has(path)) {
            rmSync(path, { force: true })
            removed++
          }
        }
        if (readdirSync(dir).length === 0) rmdirSync(dir)
      }
      return { written, removed }
    },
  }
}
