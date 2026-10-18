import { readFileSync } from 'node:fs'
import satori from 'satori'
import { html } from 'satori-html'
import { Resvg } from '@resvg/resvg-js'
import { renderCharacterCard } from '../src/render/card-kit'
const bytes = readFileSync('data/portraits/2.png')
const uri = 'data:image/png;base64,' + bytes.toString('base64')
const t0 = Date.now()
const kill = setTimeout(() => { console.log('TIMEOUT after 60s at stage', stage); process.exit(2) }, 60_000)
let stage = 'satori-only'
const svg = await satori(html(`<div style="display:flex;width:900px;height:500px"><img width="256" height="256" src="${uri}" style="object-fit:cover" /></div>`) as never, { width: 900, height: 500, fonts: [{ name: 'Cardo', data: readFileSync('assets/fonts/Cardo-Regular.ttf'), weight: 400, style: 'normal' }] })
console.log('satori', Date.now() - t0, 'ms, svg bytes', svg.length)
stage = 'resvg-only'
const t1 = Date.now()
new Resvg(svg, { fitTo: { mode: 'width', value: 1800 } }).render().asPng()
console.log('resvg', Date.now() - t1, 'ms')
stage = 'full card'
const t2 = Date.now()
await renderCharacterCard({ name: 'Test', className: 'Rogue', level: 3, campaignName: 'test01', portraitDataUri: uri })
console.log('full card', Date.now() - t2, 'ms')
clearTimeout(kill)
