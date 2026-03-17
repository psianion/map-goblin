// src/store/migration.ts
import type { SerializedMapData } from './types.ts'

export const CURRENT_VERSION = '2.0' as const

export function migrateToLatest(data: SerializedMapData): SerializedMapData {
  if (data.version === '2.0') {
    return data
  }

  throw new Error(
    `Cannot open files from version "${data.version}". This version requires v2.0 format.`,
  )
}
