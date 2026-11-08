// The campaign export (decision 14): one zip a DM can keep, holding everything the server
// knows about a campaign. Built with fflate's streaming Zip so entries leave as they are
// made. Maps and pictures are compressed already and are stored; the JSON is deflated.
//
//   manifest.json   campaign, scenes in order with visibility, prep and file, protocol, when
//   maps/*.ggvtt    each scene's map, the file the editor opens
//   state.json      every module's stored state for the campaign, by module
//   assets/<id>.<ext> + assets.json   uploaded pictures and what each one is

import { Zip, ZipDeflate, ZipPassThrough } from 'fflate'
import type { Campaign, Stores } from './db/stores'
import { mapFileBytes, sceneFileName } from './mirror'

export interface ExportSink {
  write(chunk: Uint8Array): void
  end(): void
  fail(error: Error): void
}

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

type ExportStores = Pick<Stores, 'scenes' | 'maps' | 'moduleState' | 'assets'>

export function writeCampaignExport(
  stores: ExportStores,
  campaign: Campaign,
  protocolVersion: number,
  sink: ExportSink,
): void {
  const zip = new Zip((error, chunk, final) => {
    if (error) return sink.fail(error)
    sink.write(chunk)
    if (final) sink.end()
  })
  const add = (name: string, bytes: Uint8Array, deflate: boolean) => {
    const entry = deflate ? new ZipDeflate(name, { level: 6 }) : new ZipPassThrough(name)
    zip.add(entry)
    entry.push(bytes, true)
  }
  const addJson = (name: string, value: unknown) =>
    add(name, new TextEncoder().encode(JSON.stringify(value, null, 2)), true)

  try {
    const scenes = stores.scenes.listByCampaign(campaign.id).map((scene) => {
      const file = `maps/${sceneFileName(scene)}`
      const map = stores.maps.get(scene.map_id)
      if (map) add(file, mapFileBytes(map.data), false)
      return {
        id: scene.id,
        name: scene.name,
        order: scene.sort_index,
        visibleToPlayers: scene.visible_to_players === 1,
        prep: scene.prep === null ? null : (JSON.parse(scene.prep) as unknown),
        file: map ? file : null,
      }
    })

    const assets = stores.assets.listByCampaign(campaign.id).map((asset) => {
      const file = `assets/${asset.id}.${EXTENSIONS[asset.mime] ?? 'bin'}`
      add(file, asset.bytes, false)
      return { id: asset.id, file, mime: asset.mime, size: asset.size, createdAt: asset.created_at }
    })

    addJson('state.json', stores.moduleState.listByCampaign(campaign.id))
    addJson('assets.json', assets)
    addJson('manifest.json', {
      kind: 'good-goblin-campaign',
      exportedAt: new Date().toISOString(),
      protocolVersion,
      campaign: { id: campaign.id, name: campaign.name, createdAt: campaign.created_at, updatedAt: campaign.updated_at },
      scenes,
      note: 'Importing this archive is not supported yet; keep it as a backup.',
    })
    zip.end()
  } catch (error) {
    zip.terminate()
    sink.fail(error instanceof Error ? error : new Error(String(error)))
  }
}
