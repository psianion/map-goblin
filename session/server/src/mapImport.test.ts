// D3 — the server treats a `.mapbuilder` file as schema-validated JSON and nothing more
// (see the header comment on mapImport.ts). These pin the version gate, which is the one
// thing here that moves when the map schema does.

import { describe, expect, it } from 'vitest'
import { validateMapData } from './mapImport'

function doc(version: unknown): unknown {
  return {
    version,
    mapSettings: { name: 'Test' },
    grid: { visible: true },
    layers: [],
  }
}

describe('validateMapData', () => {
  it('accepts every version SUPPORTED_VERSIONS lists', () => {
    for (const version of ['2.0', '3.0', '3.1']) {
      expect(validateMapData(doc(version))).toMatchObject({ ok: true })
    }
  })

  it('still rejects an unknown version', () => {
    const result = validateMapData(doc('4.0'))
    expect(result).toMatchObject({ ok: false })
    if (result.ok) throw new Error('expected rejection')
    expect(result.error).toMatch(/unsupported \.mapbuilder version/)
  })

  it('rejects a payload that is not an object', () => {
    expect(validateMapData('not an object')).toMatchObject({ ok: false })
    expect(validateMapData(null)).toMatchObject({ ok: false })
  })
})
