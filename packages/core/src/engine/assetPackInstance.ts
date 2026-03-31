import { AssetPackManager } from './assetPackManager'
import { AssetPackDB } from './assetPackDB'
import { cdnConfig } from '../config/cdnConfig'

let instance: AssetPackManager | null = null

export function getAssetPackManager(): AssetPackManager {
  if (!instance) {
    instance = new AssetPackManager({
      cdnBaseUrl: cdnConfig.baseUrl,
      packDB: new AssetPackDB(),
    })
  }
  return instance
}

/** Reset singleton — only for testing. */
export function resetAssetPackManager(): void {
  instance = null
}
