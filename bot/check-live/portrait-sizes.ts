import { readFileSync } from 'node:fs'
import { Resvg } from '@resvg/resvg-js'
import { renderCharacterCard } from '../src/render/card-kit'
const raw = readFileSync('data/portraits/2.png')
const px = Number(process.argv[2])
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}"><image href="data:image/png;base64,${raw.toString('base64')}" width="${px}" height="${px}" preserveAspectRatio="xMidYMid slice"/></svg>`
const png = new Resvg(svg, { fitTo: { mode: 'width', value: px } }).render().asPng()
const t0 = Date.now()
await renderCharacterCard({ name: 'Test', className: 'Rogue', level: 3, campaignName: 'test01', portraitDataUri: 'data:image/png;base64,' + png.toString('base64') })
console.log(px + 'px portrait:', png.length, 'bytes, card in', Date.now() - t0, 'ms')
