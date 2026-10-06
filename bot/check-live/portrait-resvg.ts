import { readFileSync } from 'node:fs'
import { Resvg } from '@resvg/resvg-js'
const bytes = readFileSync('data/portraits/2.png')
const uri = 'data:image/png;base64,' + bytes.toString('base64')
const t0 = Date.now()
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><image href="${uri}" width="512" height="512" preserveAspectRatio="xMidYMid slice"/></svg>`
const png = new Resvg(svg, { fitTo: { mode: 'width', value: 512 } }).render().asPng()
console.log('resvg normalise', Date.now() - t0, 'ms ->', png.length, 'bytes, IHDR', png.readUInt32BE(16) + 'x' + png.readUInt32BE(20), 'color', png[25])
