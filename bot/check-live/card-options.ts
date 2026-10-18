// Four character-card directions, rendered with the bot's own font + rasteriser so the mock IS
// the shipping pipeline. Output: bot/test-output/card-option-{a,b,c,d}.png
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { rasterize } from '../src/render/raster'

const W = 900, H = 320
const portrait = 'data:image/png;base64,' + readFileSync('data/portraits/2.png').toString('base64')
const input = { name: 'KNeel', className: 'PaliLock', level: 9, campaign: 'test01' }

const PARCH = '#f4ead9', PARCH2 = '#e8dcc4', INK = '#2a2016', GOLD = '#b08d57', MUTED = '#6b5c46'
const NIGHT = '#14110d', SLATE = '#262a2e', SLATE2 = '#33393f', PARCH_DIM = '#d9c9a8'

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => `&${{ '<': 'lt', '>': 'gt', '&': 'amp', '"': 'quot', "'": 'apos' }[c]!};`)
const text = (s: string, x: number, y: number, size: number, extra = '') =>
  `<text x="${x}" y="${y}" font-family="Cardo" font-size="${size}" ${extra}>${esc(s)}</text>`
const svg = (body: string, defs = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W * 2}" height="${H * 2}" viewBox="0 0 ${W} ${H}"><defs>${defs}</defs>${body}</svg>`
const grain = (id: string, opacity: number) =>
  `<filter id="${id}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7"/><feColorMatrix type="matrix" values="0 0 0 0 0.3 0 0 0 0 0.25 0 0 0 0 0.18 0 0 0 ${opacity} 0"/><feComposite in2="SourceGraphic" operator="over"/></filter>`
const img = (x: number, y: number, w: number, h: number, clip: string) =>
  `<image x="${x}" y="${y}" width="${w}" height="${h}" href="${portrait}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clip})"/>`

// A — Torchlit plate: near-black surround, full-height portrait, warm glow behind the name.
function optionA(): string {
  const defs =
    `<clipPath id="pa"><rect x="0" y="0" width="320" height="${H}"/></clipPath>` +
    `<radialGradient id="glow" cx="0.62" cy="0.5" r="0.55"><stop offset="0" stop-color="#7a5322" stop-opacity="0.55"/><stop offset="1" stop-color="${NIGHT}" stop-opacity="0"/></radialGradient>` +
    `<linearGradient id="fade" x1="0" x2="1"><stop offset="0.7" stop-color="${NIGHT}" stop-opacity="0"/><stop offset="1" stop-color="${NIGHT}" stop-opacity="0.85"/></linearGradient>` +
    grain('ga', 0.06)
  const body =
    `<rect width="${W}" height="${H}" fill="${NIGHT}"/>` +
    `<rect width="${W}" height="${H}" fill="url(#glow)"/>` +
    img(0, 0, 320, H, 'pa') +
    `<rect x="0" y="0" width="320" height="${H}" fill="url(#fade)"/>` +
    `<rect x="320" y="0" width="2" height="${H}" fill="${GOLD}"/>` +
    `<rect x="12" y="12" width="${W - 24}" height="${H - 24}" fill="none" stroke="${GOLD}" stroke-opacity="0.45" stroke-width="1.5"/>` +
    text(input.campaign.toUpperCase(), 372, 78, 15, `fill="${GOLD}" letter-spacing="4"`) +
    text(input.name, 370, 168, 68, `fill="${PARCH}" font-weight="700"`) +
    text(`${input.className}  ·  Level ${input.level}`, 372, 214, 27, `fill="${PARCH_DIM}"`) +
    `<rect x="372" y="236" width="56" height="2" fill="${GOLD}"/>` +
    `<rect width="${W}" height="${H}" fill="transparent" filter="url(#ga)"/>`
  return svg(body, defs)
}

// B — Sheet header: parchment with grain, double-rule portrait frame, name over a rule, labelled cells.
function optionB(): string {
  const defs = `<clipPath id="pb"><rect x="28" y="28" width="264" height="264"/></clipPath>` + grain('gb', 0.09)
  const cell = (label: string, value: string, x: number, bold = false) =>
    text(label, x, 214, 13, `fill="${MUTED}" letter-spacing="3"`) +
    text(value, x, 250, 30, `fill="${INK}"${bold ? ' font-weight="700"' : ''}`)
  const body =
    `<rect width="${W}" height="${H}" fill="${PARCH}"/>` +
    `<rect width="${W}" height="${H}" fill="transparent" filter="url(#gb)"/>` +
    `<rect x="28" y="28" width="264" height="264" fill="${PARCH2}"/>` +
    img(28, 28, 264, 264, 'pb') +
    `<rect x="28" y="28" width="264" height="264" fill="none" stroke="${INK}" stroke-width="3"/>` +
    `<rect x="36" y="36" width="248" height="248" fill="none" stroke="${INK}" stroke-width="1" stroke-opacity="0.7"/>` +
    text(input.name, 336, 132, 62, `fill="${INK}" font-weight="700"`) +
    `<rect x="336" y="152" width="536" height="2" fill="${INK}"/>` +
    `<rect x="336" y="157" width="536" height="1" fill="${INK}" fill-opacity="0.5"/>` +
    cell('CLASS', input.className, 336) +
    cell('LEVEL', String(input.level), 640, true) +
    text(input.campaign.toUpperCase(), 872, 296, 13, `fill="${MUTED}" letter-spacing="3" text-anchor="end"`)
  return svg(body, defs)
}

// C — Banner: the portrait is the whole card, a night scrim rises from the right, text sits in it.
function optionC(): string {
  const defs =
    `<clipPath id="pc"><rect x="0" y="0" width="${W}" height="${H}"/></clipPath>` +
    `<linearGradient id="scrim" x1="0" x2="1"><stop offset="0.28" stop-color="${NIGHT}" stop-opacity="0.05"/><stop offset="0.6" stop-color="${NIGHT}" stop-opacity="0.88"/><stop offset="1" stop-color="${NIGHT}" stop-opacity="0.97"/></linearGradient>` +
    `<linearGradient id="foot" x1="0" y1="0" x2="0" y2="1"><stop offset="0.6" stop-color="${NIGHT}" stop-opacity="0"/><stop offset="1" stop-color="${NIGHT}" stop-opacity="0.7"/></linearGradient>`
  const body =
    `<rect width="${W}" height="${H}" fill="${NIGHT}"/>` +
    img(0, 0, W, H, 'pc').replace('xMidYMid slice', 'xMidYMin slice') +
    `<rect width="${W}" height="${H}" fill="url(#scrim)"/>` +
    `<rect width="${W}" height="${H}" fill="url(#foot)"/>` +
    text(input.campaign.toUpperCase(), 868, 76, 15, `fill="${GOLD}" letter-spacing="4" text-anchor="end"`) +
    text(input.name, 868, 176, 72, `fill="${PARCH}" font-weight="700" text-anchor="end"`) +
    text(`${input.className}  ·  Level ${input.level}`, 868, 222, 28, `fill="${PARCH_DIM}" text-anchor="end"`) +
    `<rect x="812" y="244" width="56" height="2" fill="${GOLD}"/>`
  return svg(body, defs)
}

// D — Token: the portrait as the table's own token, ink ring and gold inner ring, level chip, stone grid.
function optionD(): string {
  const cx = 168, cy = 160, r = 116
  const defs = `<clipPath id="pd"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>` +
    `<radialGradient id="pool" cx="0.19" cy="0.5" r="0.5"><stop offset="0" stop-color="#8a5a24" stop-opacity="0.5"/><stop offset="1" stop-color="${SLATE}" stop-opacity="0"/></radialGradient>` +
    `<pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="${SLATE2}" stroke-width="1"/></pattern>`
  const body =
    `<rect width="${W}" height="${H}" fill="${SLATE}"/>` +
    `<rect width="${W}" height="${H}" fill="url(#grid)"/>` +
    `<rect width="${W}" height="${H}" fill="url(#pool)"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r + 10}" fill="${INK}"/>` +
    img(cx - r, cy - r, r * 2, r * 2, 'pd') +
    `<circle cx="${cx}" cy="${cy}" r="${r + 2}" fill="none" stroke="${GOLD}" stroke-width="4"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r + 9}" fill="none" stroke="${INK}" stroke-width="6"/>` +
    `<circle cx="${cx + 86}" cy="${cy + 86}" r="28" fill="${GOLD}" stroke="${INK}" stroke-width="4"/>` +
    text(String(input.level), cx + 86, cy + 98, 32, `fill="${INK}" font-weight="700" text-anchor="middle"`) +
    text(input.campaign.toUpperCase(), 340, 84, 15, `fill="${GOLD}" letter-spacing="4"`) +
    text(input.name, 338, 168, 66, `fill="${PARCH}" font-weight="700"`) +
    text(input.className, 340, 212, 28, `fill="${PARCH_DIM}"`) +
    text(`Level ${input.level}`, 340, 250, 20, `fill="${GOLD}"`)
  return svg(body, defs)
}

mkdirSync('test-output', { recursive: true })
for (const [key, build] of Object.entries({ a: optionA, b: optionB, c: optionC, d: optionD })) {
  const t = Date.now()
  const png = rasterize(build(), W * 2)
  writeFileSync(`test-output/card-option-${key}.png`, png)
  console.log(`option ${key}: ${png.length} bytes in ${Date.now() - t} ms`)
}
