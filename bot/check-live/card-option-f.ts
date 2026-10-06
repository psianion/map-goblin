// Option F: the whole portrait, uncropped, on the left of the parchment; its right half
// dissolves into the paper. F1 fades to the right only; F2 fades harder, from a third of the way across, ending near-gone.
import { readFileSync, writeFileSync } from 'node:fs'
import { rasterize } from '../src/render/raster'

const W = 900, H = 320
const portrait = 'data:image/png;base64,' + readFileSync('data/portraits/2.png').toString('base64')
const input = { name: 'KNeel', className: 'PaliLock', level: 9, campaign: 'test01' }
const PARCH = '#f4ead9', INK = '#2a2016', GOLD = '#b08d57', MUTED = '#6b5c46'

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => `&${{ '<': 'lt', '>': 'gt', '&': 'amp', '"': 'quot', "'": 'apos' }[c]!};`)
const text = (s: string, x: number, y: number, size: number, extra = '') =>
  `<text x="${x}" y="${y}" font-family="Cardo" font-size="${size}" ${extra}>${esc(s)}</text>`

// The portrait is square; drawn whole it is H tall and H wide, flush left.
const PX = 0, PY = 0, PW = 360, PH = 320

function optionF(blot: boolean): string {
  const maskFill = blot
    ? `<linearGradient id="washGrad" x1="0" x2="1"><stop offset="0.28" stop-color="#fff"/><stop offset="0.9" stop-color="#101010"/></linearGradient>`
    : `<linearGradient id="washGrad" x1="0" x2="1"><stop offset="0.42" stop-color="#fff"/><stop offset="0.95" stop-color="#262626"/></linearGradient>`
  const defs =
    `<filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7"/><feColorMatrix type="matrix" values="0 0 0 0 0.3 0 0 0 0 0.25 0 0 0 0 0.18 0 0 0 0.08 0"/><feComposite in2="SourceGraphic" operator="over"/></filter>` +
    maskFill +
    `<filter id="soak" x="-15%" y="-15%" width="130%" height="130%"><feTurbulence type="fractalNoise" baseFrequency="0.014 0.03" numOctaves="3" seed="5" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="34" xChannelSelector="R" yChannelSelector="G"/><feGaussianBlur stdDeviation="2.5"/></filter>` +
    `<mask id="wash" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect x="${PX - 40}" y="${PY - 40}" width="${PW + 80}" height="${PH + 80}" fill="url(#washGrad)" filter="url(#soak)"/></mask>` +
    `<filter id="pigment"><feColorMatrix type="saturate" values="0.9"/></filter>` +
    `<clipPath id="sheet"><rect width="${W}" height="${H}"/></clipPath>`
  const body =
    `<rect width="${W}" height="${H}" fill="${PARCH}"/>` +
    `<g mask="url(#wash)" clip-path="url(#sheet)">` +
    // "meet" keeps the whole picture; it lands H tall at the left edge, nothing cropped.
    `<image x="${PX}" y="${PY}" width="${PW}" height="${PH}" href="${portrait}" preserveAspectRatio="xMinYMid meet" filter="url(#pigment)"/>` +
    `</g>` +
    `<rect width="${W}" height="${H}" fill="transparent" filter="url(#grain)"/>` +
    text(input.campaign.toUpperCase(), 404, 92, 15, `fill="${GOLD}" letter-spacing="4"`) +
    text(input.name, 400, 184, 78, `fill="${INK}" font-weight="700"`) +
    text(`${input.className}  ·  Level ${input.level}`, 404, 230, 29, `fill="${MUTED}"`) +
    `<rect x="404" y="252" width="56" height="2" fill="${GOLD}"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W * 2}" height="${H * 2}" viewBox="0 0 ${W} ${H}"><defs>${defs}</defs>${body}</svg>`
}

for (const [key, blot] of [['f1', false], ['f2', true]] as const) {
  const t = Date.now()
  const png = rasterize(optionF(blot), W * 2)
  writeFileSync(`test-output/card-option-${key}.png`, png)
  console.log(`option ${key}: ${png.length} bytes in ${Date.now() - t} ms`)
}
