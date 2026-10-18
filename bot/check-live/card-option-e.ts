// Option E: the banner, but washed onto parchment — the portrait bleeds in from the left and
// soaks out into the paper with a ragged watercolour edge; ink text on the paper side.
// E1 multiplies the picture into the paper (print feel); E2 only fades it (normal blend).
import { readFileSync, writeFileSync } from 'node:fs'
import { rasterize } from '../src/render/raster'

const W = 900, H = 320
const portrait = 'data:image/png;base64,' + readFileSync('data/portraits/2.png').toString('base64')
const input = { name: 'KNeel', className: 'PaliLock', level: 9, campaign: 'test01' }
const PARCH = '#f4ead9', INK = '#2a2016', GOLD = '#b08d57', MUTED = '#6b5c46'

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => `&${{ '<': 'lt', '>': 'gt', '&': 'amp', '"': 'quot', "'": 'apos' }[c]!};`)
const text = (s: string, x: number, y: number, size: number, extra = '') =>
  `<text x="${x}" y="${y}" font-family="Cardo" font-size="${size}" ${extra}>${esc(s)}</text>`

function optionE(multiply: boolean, edgeScale: number): string {
  const defs =
    // Paper grain over the whole sheet.
    `<filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7"/><feColorMatrix type="matrix" values="0 0 0 0 0.3 0 0 0 0 0.25 0 0 0 0 0.18 0 0 0 0.08 0"/><feComposite in2="SourceGraphic" operator="over"/></filter>` +
    // The wash: opaque on the left, gone by two thirds across, with a soaked ragged edge.
    `<linearGradient id="washGrad" x1="0" x2="1"><stop offset="0.38" stop-color="#fff"/><stop offset="0.72" stop-color="#000"/></linearGradient>` +
    `<filter id="soak" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.012 0.03" numOctaves="3" seed="3" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="${edgeScale}" xChannelSelector="R" yChannelSelector="G"/><feGaussianBlur stdDeviation="2"/></filter>` +
    `<mask id="wash" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect x="-40" y="-40" width="${W + 80}" height="${H + 80}" fill="url(#washGrad)" filter="url(#soak)"/></mask>` +
    // A touch less saturation so the picture sits in the paper rather than on it.
    `<filter id="pigment"><feColorMatrix type="saturate" values="0.88"/></filter>` +
    `<clipPath id="sheet"><rect width="${W}" height="${H}"/></clipPath>`
  const body =
    `<rect width="${W}" height="${H}" fill="${PARCH}"/>` +
    `<g mask="url(#wash)" clip-path="url(#sheet)"${multiply ? ' style="mix-blend-mode:multiply"' : ''}>` +
    `<image x="0" y="0" width="${W}" height="${H}" href="${portrait}" preserveAspectRatio="xMidYMin slice" filter="url(#pigment)"/>` +
    `</g>` +
    `<rect width="${W}" height="${H}" fill="transparent" filter="url(#grain)"/>` +
    text(input.campaign.toUpperCase(), 868, 84, 15, `fill="${GOLD}" letter-spacing="4" text-anchor="end"`) +
    text(input.name, 868, 180, 72, `fill="${INK}" font-weight="700" text-anchor="end"`) +
    text(`${input.className}  ·  Level ${input.level}`, 868, 226, 28, `fill="${MUTED}" text-anchor="end"`) +
    `<rect x="812" y="248" width="56" height="2" fill="${GOLD}"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W * 2}" height="${H * 2}" viewBox="0 0 ${W} ${H}"><defs>${defs}</defs>${body}</svg>`
}

for (const [key, multiply, edge] of [['e1', true, 42], ['e2', false, 42]] as const) {
  const t = Date.now()
  const png = rasterize(optionE(multiply, edge), W * 2)
  writeFileSync(`test-output/card-option-${key}.png`, png)
  console.log(`option ${key}: ${png.length} bytes in ${Date.now() - t} ms`)
}
