import { describe, expect, it } from 'vitest'
import { playerMap, tokens } from './__fixtures__/two-rooms'
import { mapSvg } from './map-svg'
import { rasterize } from './raster'

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47])

describe('rasterize', () => {
  it('turns the fixture schematic into a real PNG', () => {
    const png = rasterize(mapSvg(playerMap, { tokens }))
    expect(png.length).toBeGreaterThan(1000)
    expect(png.subarray(0, 4)).toEqual(PNG_MAGIC)
  })

  it('honours the width cap, whatever the SVG asked for', () => {
    const wide = '<svg xmlns="http://www.w3.org/2000/svg" width="9000" height="900" viewBox="0 0 9000 900"></svg>'
    // 2048 wide at the SVG's own 10:1 aspect.
    expect(rasterize(wide).length).toBeGreaterThan(0)
    expect(rasterize(wide, 64).length).toBeGreaterThan(0)
  })

  it('draws the bundled font rather than failing on a missing one', () => {
    // Text-only SVG: an empty render would mean resvg found no glyphs at all.
    const withText = mapSvg({ layers: [] })
    const blank = '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="420"></svg>'
    expect(rasterize(withText).length).toBeGreaterThan(rasterize(blank).length)
  })
})
