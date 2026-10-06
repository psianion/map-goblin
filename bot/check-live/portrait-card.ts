import { readFileSync } from 'node:fs'
import { Resvg } from '@resvg/resvg-js'
import { renderCharacterCard } from '../src/render/card-kit'
const raw = readFileSync('data/portraits/2.png')
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><image href="data:image/png;base64,${raw.toString('base64')}" width="512" height="512" preserveAspectRatio="xMidYMid slice"/></svg>`
const png = new Resvg(svg, { fitTo: { mode: 'width', value: 512 } }).render().asPng()
const t0 = Date.now()
const card = await renderCharacterCard({ name: 'Test', className: 'Rogue', level: 3, campaignName: 'test01', portraitDataUri: 'data:image/png;base64,' + png.toString('base64') })
console.log('card with normalised portrait', Date.now() - t0, 'ms ->', card.length, 'bytes')
