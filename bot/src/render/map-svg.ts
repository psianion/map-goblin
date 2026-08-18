// The map snapshot renderer (plan §5): a redacted map document in, one SVG string out.
//
// Deliberately not a Pixi replica — a *parchment schematic*. The art style guide's palette and
// linework rules (dark ink outlines, subtle terrain-tinted grid, doors reading as objects in
// wall gaps, open floor centres kept token-readable) survive the translation to flat vector;
// painted texture and baked lighting do not, and faking them here would be worse than owning
// the schematic look.
//
// Pure and deterministic: no clock, no randomness, no network, no discord.js. The document is
// whatever `GET /api/maps/:sceneId` handed the bot — already redacted server-side for the
// token's role (plan §4), so nothing in here filters map data by visibility. It reads `unknown`
// defensively because a wire document is not a compile-time promise.
//
// ponytail: schematic SVG, not a textured render; upgrade to a headless renderer only if
// players reject the look.

export type Disposition = 'friendly' | 'neutral' | 'hostile'

/** The only token fields the schematic draws. Mapped from the WS `tokens` module state. */
export interface MapToken {
  id: string
  name: string
  /** Centre, in grid cells. */
  x: number
  y: number
  /** Width in cells (SIZE_CELLS on the game side). */
  cells: number
  disposition: Disposition
  /** DM-only tokens. Never present in a player-role render — see `visibleTokens`. */
  hidden: boolean
}

export interface MapSvgOptions {
  /** Live tokens for this scene, when a session is running. */
  tokens?: MapToken[]
  /** The DM's own unfogged view: secret doors and hidden tokens are drawn, and marked. */
  dmView?: boolean
  /** Overrides the document's own map name in the sheet header. */
  title?: string
}

// ── palette (art style guide §4, matching render/card-kit.ts) ────────────────────────────
const PAGE = '#e7d9bf'
const FLOOR = '#f5ecda'
const INK = '#2a2016'
const ACCENT = '#b08d57'
const MUTED = '#6b5c46'
const WATER = '#6f8a93'
const DISPOSITION: Record<Disposition, string> = {
  friendly: '#4f7043',
  neutral: '#8a7a52',
  hostile: '#8c3b2e',
}

/** Discord shows a map at a few hundred pixels wide; past this, detail is wasted bytes. */
export const MAX_WIDTH_PX = 2048
const MAX_PX_PER_CELL = 48
/** One cell of quiet around the geometry, so walls never touch the sheet edge. */
const PAD = 1
/** Output-pixel type sizes, converted to cell units per render so they stay constant. */
const TITLE_PX = 26
const LABEL_PX = 20
const SCALE_PX = 18

// ── the shapes the schematic actually draws ──────────────────────────────────────────────

type Ring = [number, number][]
interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}
interface Wall {
  points: [number, number][]
  width: number
}
interface Door {
  x: number
  y: number
  width: number
  angle: number
  state: 'open' | 'closed' | 'locked'
  secret: boolean
}
interface Label {
  text: string
  x: number
  y: number
  size: number
  rotation: number
}
interface RoomLabel {
  text: string
  x: number
  y: number
}
interface Scene {
  name: string
  cellScale: { value: number; unit: string }
  frame: Bounds | null
  floors: Ring[][]
  waters: Ring[][]
  walls: Wall[]
  doors: Door[]
  labels: Label[]
  rooms: RoomLabel[]
  lamps: { x: number; y: number }[]
}

// ── defensive readers ────────────────────────────────────────────────────────────────────

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

function readRings(value: unknown): Ring[] {
  return list(value)
    .map((ring) =>
      list(ring)
        .filter((p): p is unknown[] => Array.isArray(p) && p.length >= 2)
        .map((p): [number, number] => [num(p[0]), num(p[1])]),
    )
    .filter((ring) => ring.length >= 3)
}

/** Room label text: the DM's override wins over the detected name, same as the editor. */
function readRooms(layer: Rec): RoomLabel[] {
  const overrides = isRec(layer.roomNameOverrides) ? layer.roomNameOverrides : {}
  return list(layer.rooms)
    .filter(isRec)
    .filter((room) => room.isPathway !== true && num(room.area) >= 4)
    .map((room) => {
      const centroid = list(room.centroid)
      return {
        text: str(overrides[str(room.id)], str(room.name)),
        x: num(centroid[0]),
        y: num(centroid[1]),
      }
    })
    .filter((room) => room.text.length > 0)
}

/** Authored `state` is a string in the file; a live table's door state arrives as flags. */
function readDoorState(value: unknown): Door['state'] {
  if (isRec(value)) return value.open === true ? 'open' : value.locked === true ? 'locked' : 'closed'
  const text = str(value, 'closed')
  return text === 'open' || text === 'locked' ? text : 'closed'
}

export function readScene(doc: unknown, dmView: boolean): Scene {
  const root = isRec(doc) ? doc : {}
  const settings = isRec(root.mapSettings) ? root.mapSettings : {}
  const cellScale = isRec(settings.cellScale) ? settings.cellScale : {}
  const scene: Scene = {
    name: str(settings.name, 'Unnamed map'),
    cellScale: { value: num(cellScale.value, 5) || 5, unit: str(cellScale.unit, 'ft') },
    frame: isRec(root.frame)
      ? {
          minX: num(root.frame.minX),
          minY: num(root.frame.minY),
          maxX: num(root.frame.maxX),
          maxY: num(root.frame.maxY),
        }
      : null,
    floors: [],
    waters: [],
    walls: [],
    doors: [],
    labels: [],
    rooms: [],
    lamps: [],
  }

  for (const layer of list(root.layers).filter(isRec)) {
    if (layer.type !== 'dungeon' || layer.visible === false) continue
    scene.rooms.push(...readRooms(layer))

    for (const wall of list(layer.standaloneWalls).filter(isRec)) {
      // Invisible and ethereal walls are sight/movement rules, not masonry — drawing them
      // would put ink where the map has none.
      const kind = str(wall.wallType, 'normal')
      if (kind === 'invisible' || kind === 'ethereal') continue
      const points = list(wall.points)
        .filter((p): p is unknown[] => Array.isArray(p) && p.length >= 2)
        .map((p): [number, number] => [num(p[0]), num(p[1])])
      if (points.length >= 2) scene.walls.push({ points, width: clamp(num(wall.width, 0.3), 0.12, 0.6) })
    }

    for (const child of list(layer.children).filter(isRec)) {
      if (child.visible === false) continue
      switch (child.childType) {
        case 'shape':
          scene.floors.push(readRings(child.contours))
          break
        case 'water':
          scene.waters.push(readRings(child.contours))
          break
        case 'door': {
          // A secret door is the DM's alone. The server already cut it from every player
          // document; this is the second lock, so a mis-issued token still cannot leak one.
          if (child.isSecret === true && !dmView) break
          const position = list(child.position)
          scene.doors.push({
            x: num(position[0]),
            y: num(position[1]),
            width: clamp(num(child.width, 1), 0.4, 6),
            angle: num(child.angle),
            state: readDoorState(child.state),
            secret: child.isSecret === true,
          })
          break
        }
        case 'text': {
          const position = isRec(child.position) ? child.position : {}
          const text = str(child.text).trim()
          if (!text) break
          scene.labels.push({
            text,
            x: num(position.x),
            y: num(position.y),
            size: clamp(num(child.fontSize, 0.5) * (num(child.scale, 1) || 1), 0.2, 3),
            rotation: num(child.rotation),
          })
          break
        }
        case 'light': {
          const position = isRec(child.position) ? child.position : {}
          scene.lamps.push({ x: num(position.x), y: num(position.y) })
          break
        }
        // assets keep their meaning in the painted render, not in a schematic — skipped.
        default:
          break
      }
    }
  }
  return scene
}

// ── geometry ─────────────────────────────────────────────────────────────────────────────

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))

function boundsOf(scene: Scene, tokens: MapToken[]): Bounds | null {
  const box: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  const add = (x: number, y: number): void => {
    box.minX = Math.min(box.minX, x)
    box.minY = Math.min(box.minY, y)
    box.maxX = Math.max(box.maxX, x)
    box.maxY = Math.max(box.maxY, y)
  }
  for (const rings of [...scene.floors, ...scene.waters]) for (const ring of rings) for (const [x, y] of ring) add(x, y)
  for (const wall of scene.walls) for (const [x, y] of wall.points) add(x, y)
  for (const door of scene.doors) add(door.x, door.y)
  for (const room of scene.rooms) add(room.x, room.y)
  for (const label of scene.labels) add(label.x, label.y)
  for (const token of tokens) add(token.x, token.y)
  if (box.minX === Infinity) return null

  // A standalone wall can run far past the rooms it divides (they are drawn as long lines and
  // trimmed at render time on the game side). Clipping the view to the floors keeps one such
  // wall from shrinking the whole map to a stripe.
  const floors = floorBounds(scene)
  if (floors) {
    box.minX = Math.max(box.minX, floors.minX - 2)
    box.minY = Math.max(box.minY, floors.minY - 2)
    box.maxX = Math.min(box.maxX, floors.maxX + 2)
    box.maxY = Math.min(box.maxY, floors.maxY + 2)
  }
  return box
}

function floorBounds(scene: Scene): Bounds | null {
  const box: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  for (const rings of scene.floors)
    for (const ring of rings)
      for (const [x, y] of ring) {
        box.minX = Math.min(box.minX, x)
        box.minY = Math.min(box.minY, y)
        box.maxX = Math.max(box.maxX, x)
        box.maxY = Math.max(box.maxY, y)
      }
  return box.minX === Infinity ? null : box
}

type Segment = [number, number, number, number]

/** Every straight edge a door could be sitting in: standalone walls and floor outlines. */
function segmentsOf(scene: Scene): Segment[] {
  const out: Segment[] = []
  for (const wall of scene.walls)
    for (let i = 1; i < wall.points.length; i++)
      out.push([wall.points[i - 1][0], wall.points[i - 1][1], wall.points[i][0], wall.points[i][1]])
  for (const rings of scene.floors)
    for (const ring of rings)
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]
        const b = ring[(i + 1) % ring.length]
        out.push([a[0], a[1], b[0], b[1]])
      }
  return out
}

/**
 * A door's authored `angle` is intent — the game resolves the real one against the wall the
 * door landed on, and the bot has no resolver. So it does the cheap half of the same job:
 * the nearest edge within a cell wins, and the authored angle is the fallback.
 */
function doorAngle(door: Door, segments: Segment[]): number {
  let best = Infinity
  let angle = door.angle
  for (const [ax, ay, bx, by] of segments) {
    const dx = bx - ax
    const dy = by - ay
    const lengthSq = dx * dx + dy * dy
    if (lengthSq === 0) continue
    const t = clamp(((door.x - ax) * dx + (door.y - ay) * dy) / lengthSq, 0, 1)
    const distance = Math.hypot(door.x - (ax + t * dx), door.y - (ay + t * dy))
    if (distance < best) {
      best = distance
      angle = Math.atan2(dy, dx)
    }
  }
  return best <= 1 ? angle : door.angle
}

// ── SVG emission ─────────────────────────────────────────────────────────────────────────

/** Three decimals is well under a pixel at any scale this renders at, and keeps snapshots stable. */
const f = (n: number): string => String(Math.round(n * 1000) / 1000)

const escapeXml = (text: string): string =>
  text.replace(/[<>&"']/g, (c) => `&${{ '<': 'lt', '>': 'gt', '&': 'amp', '"': 'quot', "'": 'apos' }[c]!};`)

function ringsPath(rings: Ring[]): string {
  return rings
    .map((ring) => `M${ring.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}Z`)
    .join('')
}

function text(content: string, x: number, y: number, size: number, options: Record<string, string> = {}): string {
  const attrs = Object.entries({
    x: f(x),
    y: f(y),
    'font-size': f(size),
    'font-family': 'Cardo, serif',
    fill: INK,
    ...options,
  })
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ')
  return `<text ${attrs}>${escapeXml(content)}</text>`
}

/**
 * Players never receive a hidden token — the server strips them for a player-role connection.
 * The bot's observer holds the DM's stream, though, so this is the one filter the renderer
 * owes: a player-facing render drops them here (plan §4's fog-leak guarantee).
 */
function visibleTokens(tokens: MapToken[], dmView: boolean): MapToken[] {
  return dmView ? tokens : tokens.filter((token) => !token.hidden)
}

/** Thick enough to cover the wall stroke it sits in, so the door reads as an object in a gap
 * rather than a lump of the same ink (style guide rule 8). */
const LEAF_THICKNESS = 0.42

function drawDoor(door: Door, angle: number): string {
  const degrees = (angle * 180) / Math.PI
  const ux = Math.cos(angle)
  const uy = Math.sin(angle)
  const half = door.width / 2
  const [ax, ay] = [door.x - ux * half, door.y - uy * half]
  const [bx, by] = [door.x + ux * half, door.y + uy * half]

  // Jamb ticks first: the pair of stops that make the run of wall read as a gap.
  const tick = 0.34
  const jamb = (x: number, y: number): string =>
    `<line x1="${f(x + uy * tick)}" y1="${f(y - ux * tick)}" x2="${f(x - uy * tick)}" y2="${f(y + ux * tick)}" stroke="${INK}" stroke-width="0.09" stroke-linecap="round"/>`

  /** A drawn leaf: a plate of board centred on (cx, cy), lying along `rotation`. */
  const leaf = (cx: number, cy: number, rotation: number, fill: string, dash: string): string =>
    `<rect x="${f(cx - half)}" y="${f(cy - LEAF_THICKNESS / 2)}" width="${f(door.width)}" height="${f(LEAF_THICKNESS)}" fill="${fill}" stroke="${INK}" stroke-width="0.07"${dash} transform="rotate(${f(rotation)} ${f(cx)} ${f(cy)})"/>`

  const parts = [jamb(ax, ay), jamb(bx, by)]

  if (door.secret) {
    // DM view only. A dashed accent leaf plus a lozenge — unmistakable next to a real door.
    parts.push(leaf(door.x, door.y, degrees, ACCENT, ` fill-opacity="0.5" stroke-dasharray="0.22 0.16"`))
    const r = clamp(door.width * 0.2, 0.12, 0.26)
    parts.push(
      `<path d="M${f(door.x)} ${f(door.y - r)}L${f(door.x + r)} ${f(door.y)}L${f(door.x)} ${f(door.y + r)}L${f(door.x - r)} ${f(door.y)}Z" fill="${ACCENT}" stroke="${INK}" stroke-width="0.05"/>`,
    )
    return parts.join('')
  }

  if (door.state === 'open') {
    // Hinged at the near jamb, swung a quarter turn, with the arc it swept.
    const [cx, cy] = [ax - (uy * door.width) / 2, ay + (ux * door.width) / 2]
    parts.push(leaf(cx, cy, degrees + 90, FLOOR, ''))
    parts.push(
      `<path d="M${f(ax - uy * door.width)} ${f(ay + ux * door.width)}A${f(door.width)} ${f(door.width)} 0 0 1 ${f(bx)} ${f(by)}" fill="none" stroke="${MUTED}" stroke-width="0.05" stroke-dasharray="0.18 0.14"/>`,
    )
    return parts.join('')
  }

  parts.push(leaf(door.x, door.y, degrees, FLOOR, ''))
  // A locked door wears its keyhole.
  if (door.state === 'locked')
    parts.push(`<circle cx="${f(door.x)}" cy="${f(door.y)}" r="0.09" fill="${ACCENT}"/>`)
  return parts.join('')
}

function drawToken(token: MapToken, dmView: boolean): string {
  const r = clamp(token.cells, 0.5, 6) / 2
  const fill = DISPOSITION[token.disposition] ?? DISPOSITION.neutral
  const initial = (token.name.trim()[0] ?? '?').toUpperCase()
  const dash = token.hidden && dmView ? ` stroke-dasharray="${f(r * 0.5)} ${f(r * 0.35)}"` : ''
  return [
    `<circle cx="${f(token.x)}" cy="${f(token.y)}" r="${f(r * 0.82)}" fill="${fill}" stroke="${INK}" stroke-width="${f(r * 0.16)}"${dash}/>`,
    text(initial, token.x, token.y + r * 0.34, r * 0.95, {
      fill: FLOOR,
      'text-anchor': 'middle',
      'font-weight': '700',
    }),
  ].join('')
}

function scaleBar(scene: Scene, view: Bounds, contentWidth: number, cellPx: number): string {
  const target = contentWidth / 8
  const cells = [1, 2, 5, 10, 20, 50].reduce((best, n) => (Math.abs(n - target) < Math.abs(best - target) ? n : best), 1)
  const x = view.minX + PAD / 2
  const y = view.maxY - (SCALE_PX * 0.6) / cellPx
  const tick = 0.22
  return [
    `<line x1="${f(x)}" y1="${f(y)}" x2="${f(x + cells)}" y2="${f(y)}" stroke="${INK}" stroke-width="0.07"/>`,
    `<line x1="${f(x)}" y1="${f(y - tick)}" x2="${f(x)}" y2="${f(y + tick)}" stroke="${INK}" stroke-width="0.07"/>`,
    `<line x1="${f(x + cells)}" y1="${f(y - tick)}" x2="${f(x + cells)}" y2="${f(y + tick)}" stroke="${INK}" stroke-width="0.07"/>`,
    text(
      `${cells} sq · ${round1(cells * scene.cellScale.value)} ${scene.cellScale.unit}`,
      x + cells + 0.35,
      y + SCALE_PX / cellPx / 3,
      SCALE_PX / cellPx,
      { fill: MUTED },
    ),
  ].join('')
}

const round1 = (n: number): number => Math.round(n * 10) / 10

/** The honest empty sheet: a redacted document with nothing in it is not an error. */
function emptySheet(title: string, dmView: boolean): string {
  const [w, h] = [720, 420]
  const note = dmView ? 'This scene has no geometry yet.' : "The party hasn't uncovered any of this map yet."
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    `<rect x="0" y="0" width="${w}" height="${h}" fill="${PAGE}"/>`,
    `<rect x="14" y="14" width="${w - 28}" height="${h - 28}" fill="none" stroke="${ACCENT}" stroke-width="2" stroke-dasharray="10 8"/>`,
    text(title.toUpperCase(), w / 2, 150, 22, { fill: ACCENT, 'text-anchor': 'middle', 'letter-spacing': '3' }),
    text('Nothing explored yet', w / 2, 216, 42, { 'text-anchor': 'middle', 'font-weight': '700' }),
    text(note, w / 2, 262, 20, { fill: MUTED, 'text-anchor': 'middle' }),
    '</svg>',
  ].join('')
}

/**
 * The whole renderer: document → parchment schematic. Options carry only what the document
 * cannot: the live tokens, and whether this is the DM's own view.
 */
export function mapSvg(doc: unknown, options: MapSvgOptions = {}): string {
  const dmView = options.dmView === true
  const scene = readScene(doc, dmView)
  const tokens = visibleTokens(options.tokens ?? [], dmView)
  const title = options.title ?? scene.name

  // The frame the server stamps on a redacted document measures the *full* map, so an early
  // party gets a sheet the size of the dungeon rather than the size of one room — which is
  // the point: it shows how much is still dark.
  const content = scene.frame ?? boundsOf(scene, tokens)
  if (!content || content.maxX - content.minX <= 0 || content.maxY - content.minY <= 0)
    return emptySheet(title, dmView)

  const contentWidth = content.maxX - content.minX
  const viewWidth = contentWidth + PAD * 2
  const cellPx = Math.min(MAX_PX_PER_CELL, MAX_WIDTH_PX / viewWidth)
  // Header and footer bands are sized in output pixels, so type stays legible at any zoom.
  const headBand = (TITLE_PX * 1.9) / cellPx
  const footBand = (SCALE_PX * 2.4) / cellPx
  const view: Bounds = {
    minX: content.minX - PAD,
    minY: content.minY - PAD - headBand,
    maxX: content.maxX + PAD,
    maxY: content.maxY + PAD + footBand,
  }
  const viewHeight = view.maxY - view.minY
  const width = Math.round(viewWidth * cellPx)
  const height = Math.round(viewHeight * cellPx)

  const floorPath = scene.floors.map(ringsPath).join('')
  const segments = segmentsOf(scene)
  const box = floorBounds(scene) ?? content
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${f(view.minX)} ${f(view.minY)} ${f(viewWidth)} ${f(viewHeight)}">`,
    `<rect x="${f(view.minX)}" y="${f(view.minY)}" width="${f(viewWidth)}" height="${f(viewHeight)}" fill="${PAGE}"/>`,
  ]

  if (floorPath) out.push(`<defs><clipPath id="floors"><path d="${floorPath}" clip-rule="evenodd"/></clipPath></defs>`)

  if (floorPath) {
    out.push(`<path d="${floorPath}" fill-rule="evenodd" fill="${FLOOR}"/>`)
    // Grid: one-cell squares, terrain-tinted and low contrast, clipped to the floors so the
    // unexplored page stays blank (style guide rule 2).
    const lines: string[] = []
    for (let x = Math.ceil(box.minX); x <= Math.floor(box.maxX); x++)
      lines.push(`M${f(x)} ${f(box.minY)}V${f(box.maxY)}`)
    for (let y = Math.ceil(box.minY); y <= Math.floor(box.maxY); y++)
      lines.push(`M${f(box.minX)} ${f(y)}H${f(box.maxX)}`)
    if (lines.length)
      out.push(
        `<g clip-path="url(#floors)"><path d="${lines.join('')}" fill="none" stroke="${MUTED}" stroke-opacity="0.3" stroke-width="0.025"/></g>`,
      )
    out.push(`<path d="${floorPath}" fill-rule="evenodd" fill="none" stroke="${INK}" stroke-width="0.13"/>`)
  }

  // Water sits on the floor it flooded, so it is drawn over it — and over the grid, which the
  // references show continuing under the surface rather than on top of it.
  for (const rings of scene.waters)
    out.push(
      `<path d="${ringsPath(rings)}" fill-rule="evenodd" fill="${WATER}" fill-opacity="0.5" stroke="${INK}" stroke-width="0.07"/>`,
    )

  for (const wall of scene.walls)
    out.push(
      `<polyline points="${wall.points.map(([x, y]) => `${f(x)},${f(y)}`).join(' ')}" fill="none" stroke="${INK}" stroke-width="${f(wall.width)}" stroke-linecap="round" stroke-linejoin="round"/>`,
    )

  // Lights are a hint, not a bake: a warm mark and a soft ring where the painted render would
  // pool light. The schematic cannot carry the glow, but it can say where to imagine one.
  for (const lamp of scene.lamps)
    out.push(
      `<circle cx="${f(lamp.x)}" cy="${f(lamp.y)}" r="0.85" fill="${ACCENT}" fill-opacity="0.16"/>`,
      `<circle cx="${f(lamp.x)}" cy="${f(lamp.y)}" r="0.18" fill="${ACCENT}" stroke="${INK}" stroke-width="0.04"/>`,
    )

  for (const door of scene.doors) out.push(drawDoor(door, doorAngle(door, segments)))

  for (const label of scene.labels)
    out.push(
      text(label.text, label.x, label.y, label.size, {
        'text-anchor': 'middle',
        fill: MUTED,
        ...(label.rotation ? { transform: `rotate(${f((label.rotation * 180) / Math.PI)} ${f(label.x)} ${f(label.y)})` } : {}),
      }),
    )

  const roomFont = clamp(LABEL_PX / cellPx, 0.3, 0.95)
  for (const room of scene.rooms)
    out.push(
      text(room.text, room.x, room.y + roomFont * 0.35, roomFont, {
        'text-anchor': 'middle',
        'font-weight': '700',
        'fill-opacity': '0.85',
      }),
    )

  for (const token of tokens) out.push(drawToken(token, dmView))

  const titleFont = TITLE_PX / cellPx
  out.push(
    text(title.toUpperCase(), view.minX + PAD / 2, view.minY + titleFont * 1.1, titleFont, {
      fill: ACCENT,
      'font-weight': '700',
      'letter-spacing': f(titleFont * 0.12),
    }),
  )
  if (dmView)
    out.push(
      text('DM VIEW', view.maxX - PAD / 2, view.minY + titleFont * 1.1, titleFont * 0.7, {
        fill: MUTED,
        'text-anchor': 'end',
        'letter-spacing': f(titleFont * 0.1),
      }),
    )
  out.push(scaleBar(scene, view, contentWidth, cellPx))
  out.push('</svg>')
  return out.join('')
}
