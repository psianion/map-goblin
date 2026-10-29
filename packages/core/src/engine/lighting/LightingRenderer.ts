import { BlurFilter, ColorMatrixFilter, Container, FillGradient, Graphics, RenderTexture, Sprite } from 'pixi.js'
import type { RenderEngine } from '../RenderEngine'
import type { LightChild } from '../../store/types'
import type { GlowProp, LightManager, Regions } from './LightManager'
import type { VisibilityVertex } from './ClockwiseSweep'
import { resolveTexture } from '../../assets/textureLoader'
import { LIGHT_ICON_RADIUS_PX } from '../hitTest'
import { lucideTexture } from '../lucideIcons'
import { prefersReducedMotion } from '../motion'
import { LIGHT_FADE_MS, advancePresence, easePresence } from './presence'
import { NEUTRAL, NOON } from '../../shared/world'
import { litFrame, skyKey, type SkyFrame } from '../../shared/sky'
import { regionGrade, type RegionMood } from '../../shared/regionGrade'
import { animationTime, isFrozen } from '../../shared/freeze'
import type { LightAnimation } from '../../shared/types'

/**
 * What one light contributes to the picture, as one comparable string: everything the light
 * buffer draws from it. Positions, reach, colour, strength, the falloff, the wedge, the flags
 * and when its polygon was last invalidated (`LightManager.staleStamp` — a door swung, a wall
 * moved), plus its presence weight while it fades in or out.
 */
export function lightSetSignature(
  lights: readonly LightChild[],
  staleness: (lightId: string) => number,
  weightOf: (lightId: string) => number = () => 1,
): string {
  const parts: (string | number)[] = []
  for (const l of lights) {
    parts.push(
      l.id,
      // Coarsened: the fade moves this a few dozen times, then it is 1 and the memo holds.
      Math.round(weightOf(l.id) * 64),
      l.position.x,
      l.position.y,
      l.radius,
      l.featherRadius ?? 0,
      l.color,
      l.intensity,
      l.falloff,
      l.cone ? `${l.cone.angle}/${l.cone.direction}` : '',
      l.animation ? `${l.animation.kind}/${l.animation.speed}` : '',
      l.darkness ? 'd' : '',
      l.throughWalls ? 't' : '',
      staleness(l.id),
    )
  }
  return parts.join('|')
}

/**
 * Everything the composite is a function of, as one string. The four draws below are memoised
 * on it: an idle frame (nothing moved, nothing animating) compares one string and draws
 * nothing.
 *
 * - camera and viewport: the buffers are screen space;
 * - `gradeKey`: the shown level's regions, the sky (coarsened, `skyKey`) and the DM-lit switch;
 * - the light set (`lightSetSignature`) and the glowing props;
 * - `time`, only while something animates (a flicker, a pulse, an animated glow): then every
 *   tick is a new frame, and only the light buffer is redrawn.
 */
export function lightingSignature(
  camX: number,
  camY: number,
  zoom: number,
  width: number,
  height: number,
  gradeKey: string,
  lights: readonly LightChild[],
  staleness: (lightId: string) => number,
  weightOf: (lightId: string) => number = () => 1,
  glowKey = '',
  time?: number,
  contentKey = '',
): string {
  return [
    camX,
    camY,
    zoom,
    width,
    height,
    gradeKey,
    glowKey,
    time ?? '',
    contentKey,
    lightSetSignature(lights, staleness, weightOf),
  ].join('|')
}

/**
 * What the lighting falls on: map content only. The composite multiplies where the scene drew
 * something — drawn ground (a background texture, painted terrain), every layer, the overhead
 * props — and is white, a no-op, wherever nothing but the solid sheet fill is under it. The
 * map's empty ground keeps its own colour at every hour, in the editor, the export and at the
 * table.
 */
export interface LightingContent {
  /** The camera-transformed world container. The content pass renders it whole, everything but the content muted. */
  root: Container
  /** The children of `root` that hold map content. Everything else under it (the grid, tool previews, highlights) is not. */
  content: readonly Container[]
  /** Display objects inside the content that are not content themselves: the solid sheet fill. */
  exclude: readonly Container[]
  /** Changes whenever what the content draws may have changed (an edit, a layer flush, a level switch). */
  revision: () => string
}

/**
 * Leaves only the map content under `root` drawing, for the content pass, and returns the undo.
 * Everything else under the root, and every excluded object, drops to alpha 0: an alpha change
 * re-colours a few small containers, where a visibility change would rebuild the whole world's
 * draw list twice per recomposite. A mask the content wears is left as it is.
 */
export function isolateContent(spec: Pick<LightingContent, 'root' | 'content' | 'exclude'>): () => void {
  const keep = new Set<unknown>(spec.content)
  for (const c of spec.content) if (c.mask) keep.add(c.mask)
  const muted: [Container, number][] = []
  const mute = (c: Container): void => {
    if (c.alpha === 0) return
    muted.push([c, c.alpha])
    c.alpha = 0
  }
  for (const child of spec.root.children) if (!keep.has(child)) mute(child)
  for (const c of spec.exclude) mute(c)
  return () => {
    for (const [c, alpha] of muted) c.alpha = alpha
  }
}

/** '#rrggbb' → [r, g, b]. Anything unparseable reads as black, as the old parse did. */
export function rgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())?.[1]
  const v = m ? parseInt(m, 16) : 0
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]
}

/**
 * How much of the grade a light's own colour carries — W1's mechanism, and a tuning knob.
 *
 * The grade fills the buffer and the lights *add* on top of it, so a bright enough pool washes
 * the fill out from under itself and lit ground escapes the world's mood entirely. Tinting each
 * light's contribution by `lerp(white, grade, w)` puts the grade back into the pool without
 * desaturating every torch toward the grade's hue. At 0.35 a torch keeps its own hue dominant.
 */
export const W_LIGHT_GRADE = 0.35

/** A light's colour once the grade has had its share of it. */
export function gradedLight(light: string, grade: string): [number, number, number] {
  const l = rgb(light)
  const g = rgb(grade)
  const ch = (i: number): number =>
    Math.round(l[i] * (1 - W_LIGHT_GRADE + (W_LIGHT_GRADE * g[i]) / 255))
  return [ch(0), ch(1), ch(2)]
}

/**
 * How much room the grade leaves a light to burn into, 0..1 — the reason a torch stops
 * mattering at noon. The buffer is the grade plus every light, then it multiplies the scene;
 * add is unsigned, so a pool over a near-white grade would clamp to white, which multiplies as
 * *no pool at all*. Scaling each light by the headroom above the grade's brightest channel
 * keeps one light inside the range at every hour.
 *
 * ponytail: bounds one light, not a stack — two pools dead on top of each other can still
 * saturate where they overlap (the light buffer is 8-bit).
 */
export function headroom(grade: string): number {
  const [r, g, b] = rgb(grade)
  return 1 - Math.max(r, g, b) / 255
}

/** Where the rim starts rounding off, as a share of the falloff zone. */
export const RIM_START = 0.75

/**
 * How much of a light is left at `t` of the way from the bright edge to the dim edge, 0..1.
 * The authored curve, with the last quarter eased out so a pool runs out instead of ending on
 * a ring.
 */
export function falloffAt(falloff: LightChild['falloff'], t: number): number {
  const u = Math.min(1, Math.max(0, t))
  const authored = falloff === 'linear' ? 1 - u : 1 - u * u
  const r = Math.min(1, Math.max(0, (u - RIM_START) / (1 - RIM_START)))
  return authored * (1 - r * r * (3 - 2 * r))
}

/** Stops per gradient. Twelve, because the curves above are smooth enough to show banding at six. */
const FALLOFF_STOPS = 12

/**
 * The penumbra, in world units: how far a wall's shadow edge is softened. A quarter cell reads
 * as light wrapping a corner rather than as a blur. Weather widens it (`SkyFrame.penumbraScale`).
 */
export const PENUMBRA_CELLS = 0.25
/** Cap on the blur in buffer pixels (times the weather's softness). */
const PENUMBRA_MAX_PX = 12
/** The grade mask's own soft edge, buffer pixels: a mood threshold is a fade, not a line. */
const GRADE_BLUR_PX = 3

/**
 * Lightmaps are smooth gradients, so they survive upscaling: every buffer renders at half
 * linear resolution and the composite sprite's linear filter stretches it back.
 */
const LIGHT_FBO_SCALE = 0.5

/** The bulb glyph's on-screen box — the hit radius (`LIGHT_ICON_RADIUS_PX`) is its half-width. */
const ICON_SIZE_PX = LIGHT_ICON_RADIUS_PX * 2

/**
 * How much of the multiply the composite is allowed — the last 5% left un-multiplied keeps a
 * pitch-black grade off pure black. Shared by the live sprite and the export's.
 */
const COMPOSITE_ALPHA = 0.95

/** How dark a darkness source takes what is under it: near-black, not a hole. */
export const DARKNESS_ALPHA = 0.85

/** Radians of animation phase per second at speed 1. */
const ANIMATION_RATE = 2

/** A deterministic wobble in [-1, 1] for one light: three detuned sines, phase-seeded by its id. */
export function flickerNoise(id: string, t: number): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  const s = ((h >>> 0) % 1000) / 159.15
  return 0.5 * Math.sin(t * 7.3 + s) + 0.3 * Math.sin(t * 13.1 + s * 1.7) + 0.2 * Math.sin(t * 23.9 + s * 2.3)
}

/**
 * What an animation does to a light at time `t` (seconds): flicker shakes the intensity by
 * ±20 % and the reach by ±6 %, seeded per id; pulse breathes the intensity between 70 % and
 * 100 %. Steady when there is no animation. Deterministic under a freeze (t = 0).
 */
export function animationFactor(
  animation: LightAnimation | undefined,
  id: string,
  t: number,
): { intensity: number; radius: number } {
  if (!animation) return { intensity: 1, radius: 1 }
  const phase = t * ANIMATION_RATE * animation.speed
  if (animation.kind === 'pulse') return { intensity: 0.85 + 0.15 * Math.sin(phase), radius: 1 }
  const n = flickerNoise(id, phase)
  return { intensity: 1 + 0.2 * n, radius: 1 + 0.06 * n }
}

/** Whether a night-only light burns at this darkness. */
export function nightOnlyActive(light: Pick<LightChild, 'nightOnly'>, darkness: number): boolean {
  const w = light.nightOnly
  return !w || (darkness >= w.min && darkness <= w.max)
}

/** The sky before anyone installs one: noon, clear, nothing dark — the grade is the tint as authored. */
const NOON_FRAME: SkyFrame = {
  minutes: NOON,
  sun: { azimuth: 0, altitude: 0, intensity: 0, kind: null },
  skyColor: NEUTRAL,
  darkness: 0,
  penumbraScale: 1,
  nightSky: 'full-moon',
  weather: 'clear',
}

/** One light's pooled drawing: a Graphics in the light's own frame, rebuilt only when its shape changes. */
interface PoolEntry {
  g: Graphics
  gradient: FillGradient | null
  /** What the geometry was built from; a different key rebuilds it. */
  key: string
}

/** What one composite run draws with. */
interface FrameInputs {
  sky: SkyFrame
  allLit: boolean
  /** Animation clock, seconds. */
  t: number
  regions: Regions
}

/** Counters for tests and the perf readout. */
export interface LightingStats {
  recomposites: number
  gradePasses: number
  lightPasses: number
  darkPasses: number
  finalPasses: number
  /** Content-mask passes (`setContent`): the world rendered for its coverage, then inverted onto white. */
  contentPasses: number
  /** Duration of the last composite, ms. */
  compositeMs: number
}

/**
 * LightingRenderer — the lighting composite, four draws and no light cap:
 *
 *  1. **Grade mask** (`gradeRT`): the shown level's grade, with each room face filled with its
 *     own region grade (mood × hour × darkness, `regionGrade`), softened at the edges.
 *  2. **Light buffer** (`lightRT`): every active light's swept polygon with its radial gradient,
 *     added together, plus each glowing prop's own sprite as white; one blur over the sum (blur
 *     is linear, so one blur of the sum is the sum of the blurs).
 *  3. **Darkness mask** (`darkRT`): every darkness source's polygon and gradient, blurred.
 *  4. **Content mask** (`contentRT` → `paperRT`), once a host says what the content is
 *     (`setContent`): the world with everything but the map content muted, then its coverage
 *     laid black on white, so the paper buffer reads 1 - coverage.
 *  5. **Final** (`lightFBO`): grade + light, with the darkness mask laid over both in black at
 *     `DARKNESS_ALPHA` (what erasing both inputs does, without touching the buffer's alpha),
 *     and the paper buffer screened over the lot: `1 - coverage × (1 - light)`, the light
 *     where content was drawn and white where only the sheet is. The composite sprite
 *     multiplies it over the scene.
 *
 * Every light's Graphics is pooled by id and drawn in world space under the camera transform:
 * a pan or zoom redraws the buffers but rebuilds no geometry and allocates nothing.
 */
export class LightingRenderer {
  private engine: RenderEngine
  private lightFBO: RenderTexture
  private gradeRT: RenderTexture
  private lightRT: RenderTexture
  private darkRT: RenderTexture
  private compositingSprite: Sprite
  private width: number
  private height: number
  private iconMap = new Map<string, Sprite>()
  private iconsVisible = true
  private lastSignature = ''
  private lastGradeKey = ''
  private lastDarkKey = ''
  /** Presence weight per light id — see `advancePresence`. Empty until the first frame. */
  private presence = new Map<string, number>()
  private lastTickMs = 0
  private lastIconSignature = ''

  // ── The pooled scene the four draws render ──
  private gradeRoot = new Container()
  private gradeBg = new Graphics()
  private gradeFaces = new Graphics()
  private gradeFacesKey = ''
  private lightRoot = new Container()
  private lightLayer = new Container()
  private glowLayer = new Container()
  private darkRoot = new Container()
  private darkLayer = new Container()
  private finalRoot = new Container()
  private gradeSprite: Sprite
  private lightSprite: Sprite
  private darkSprite: Sprite
  // ── The content mask (see `setContent`) ──
  private content: LightingContent | null = null
  /** The world's content at full logical size and half resolution; null until content is set. */
  private contentRT: RenderTexture | null = null
  /** 1 - coverage, at the buffers' size; null until content is set. */
  private paperRT: RenderTexture | null = null
  private lastContentKey = ''
  private paperRoot = new Container()
  private paperBg = new Graphics()
  private contentSprite: Sprite
  private paperSprite: Sprite
  private lightPool = new Map<string, PoolEntry>()
  private darkPool = new Map<string, PoolEntry>()
  private glowPool = new Map<string, Sprite>()
  private penumbra = new BlurFilter({ strength: 0, quality: 2 })
  private darkBlur = new BlurFilter({ strength: 0, quality: 2 })
  private gradeBlur = new BlurFilter({ strength: GRADE_BLUR_PX, quality: 2 })
  /** Turns a glowing prop's sprite white, keeping its alpha: the prop reads in its own colours. */
  private glowWhite = new ColorMatrixFilter()
  // Held once, so a recomposite assigns a filter list without allocating one.
  private penumbraFilters = [this.penumbra]
  private darkFilters = [this.darkBlur]

  /** The sky the composite is drawn under; null until a surface installs one. */
  private sky: SkyFrame | null = null
  /** The DM's "show me everything lit": every region lit, nothing dark, no darkness masks. */
  private allLit = false
  /** The shown level's grade at the last frame — what the fog's void colour and the background read. */
  private lastLevelGrade = '#ffffff'

  readonly stats: LightingStats = {
    recomposites: 0,
    gradePasses: 0,
    lightPasses: 0,
    darkPasses: 0,
    finalPasses: 0,
    contentPasses: 0,
    compositeMs: 0,
  }

  /**
   * The LightManager the last frame drew from. `renderInto` needs one and its callers (the
   * export, through the engine singleton) do not have one.
   */
  private lastLightManager: LightManager | null = null

  /**
   * Drop the composite memo so the next updateAndRender recomposes unconditionally (map load:
   * the first frames can be drawn from the store's pre-load default state).
   */
  invalidate(): void {
    this.lastSignature = ''
    this.lastGradeKey = ''
    this.lastDarkKey = ''
    this.lastContentKey = ''
  }

  constructor(engine: RenderEngine, width: number, height: number) {
    this.engine = engine
    this.width = width
    this.height = height

    const fw = Math.max(1, Math.ceil(width * LIGHT_FBO_SCALE))
    const fh = Math.max(1, Math.ceil(height * LIGHT_FBO_SCALE))
    this.lightFBO = engine.createRenderTexture(fw, fh)
    this.gradeRT = engine.createRenderTexture(fw, fh)
    this.lightRT = engine.createRenderTexture(fw, fh)
    this.darkRT = engine.createRenderTexture(fw, fh)

    this.gradeRoot.label = 'gradeRoot'
    this.gradeBg.label = 'gradeBg'
    this.gradeFaces.label = 'gradeFaces'
    this.gradeFaces.filters = [this.gradeBlur]
    this.gradeRoot.addChild(this.gradeBg)
    this.gradeRoot.addChild(this.gradeFaces)

    this.lightRoot.label = 'lightRoot'
    this.lightLayer.label = 'lightLayer'
    this.glowLayer.label = 'glowLayer'
    this.lightRoot.addChild(this.lightLayer)
    this.lightRoot.addChild(this.glowLayer)
    // RGB to 1, alpha kept.
    this.glowWhite.matrix = [0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0]
    this.glowWhite.blendMode = 'add'
    this.glowLayer.filters = [this.glowWhite]
    this.penumbra.blendMode = 'add'

    // Rendered through a root of its own, like the light buffer: a render target's root is
    // drawn without its own transform, so the camera pose has to sit on a child.
    this.darkRoot.label = 'darkRoot'
    this.darkLayer.label = 'darkLayer'
    this.darkRoot.addChild(this.darkLayer)
    this.darkBlur.blendMode = 'add'

    this.finalRoot.label = 'finalRoot'
    this.gradeSprite = new Sprite(this.gradeRT)
    this.gradeSprite.label = 'gradeSprite'
    this.lightSprite = new Sprite(this.lightRT)
    this.lightSprite.label = 'lightSprite'
    this.lightSprite.blendMode = 'add'
    this.darkSprite = new Sprite(this.darkRT)
    this.darkSprite.label = 'darkSprite'
    this.darkSprite.tint = 0x000000
    this.darkSprite.alpha = DARKNESS_ALPHA
    // Coverage black on white: a black tint keeps the content's alpha and nothing else.
    this.paperRoot.label = 'paperRoot'
    this.paperBg.label = 'paperBg'
    this.contentSprite = new Sprite()
    this.contentSprite.label = 'contentSprite'
    this.contentSprite.tint = 0x000000
    this.contentSprite.scale.set(LIGHT_FBO_SCALE)
    this.paperRoot.addChild(this.paperBg)
    this.paperRoot.addChild(this.contentSprite)
    // Screen: 1 - (1 - paper) × (1 - light) = light where content is, white where it is not.
    this.paperSprite = new Sprite()
    this.paperSprite.label = 'paperSprite'
    this.paperSprite.blendMode = 'screen'
    this.paperSprite.visible = false

    this.finalRoot.addChild(this.gradeSprite)
    this.finalRoot.addChild(this.lightSprite)
    this.finalRoot.addChild(this.darkSprite)
    this.finalRoot.addChild(this.paperSprite)

    this.compositingSprite = new Sprite(this.lightFBO)
    this.compositingSprite.label = 'lightingComposite'
    this.compositingSprite.width = width
    this.compositingSprite.height = height
    this.compositingSprite.blendMode = 'multiply'
    this.compositingSprite.alpha = COMPOSITE_ALPHA

    engine.overlay().addChild(this.compositingSprite)
    // Read-only perf handle for the e2e lanes and the status bar (composite ms, pass counts).
    ;(globalThis as { __ggLighting?: LightingStats }).__ggLighting = this.stats
  }

  /** Screen-space mask holding the composite to a rect; made on first use (see `setClip`). */
  private clipMask: Graphics | null = null
  private clipKey = ''

  /**
   * Hold the composite to a screen-space rect, or lift the hold with `null`. A host that
   * lays the map on its own desk (`editorDesk`) clips the grade to the map's frame,
   * so the desk keeps its colour at any hour. Nothing passes a rect by default.
   */
  setClip(rect: { x: number; y: number; width: number; height: number } | null): void {
    if (!rect) {
      if (this.clipMask) {
        this.compositingSprite.mask = null
        this.engine.overlay().removeChild(this.clipMask)
        this.clipMask.destroy()
        this.clipMask = null
        this.clipKey = ''
      }
      return
    }
    if (!this.clipMask) {
      this.clipMask = new Graphics()
      this.clipMask.label = 'lightingClip'
      this.engine.overlay().addChild(this.clipMask)
      this.compositingSprite.mask = this.clipMask
    }
    const key = `${rect.x},${rect.y},${rect.width},${rect.height}`
    if (key === this.clipKey) return
    this.clipKey = key
    this.clipMask.clear()
    this.clipMask.rect(rect.x, rect.y, Math.max(0, rect.width), Math.max(0, rect.height))
    this.clipMask.fill(0xffffff)
  }

  /** Whether the live view shows the composite; see `setLiveComposite`. */
  private liveComposite = true

  /**
   * Show or skip the composite over the live view. A host that edits on an unlit sheet
   * (`editorDesk`) turns it off; `renderInto` (the export) still lights the file. On by default.
   */
  setLiveComposite(on: boolean): void {
    if (on === this.liveComposite) return
    this.liveComposite = on
    this.compositingSprite.visible = on
    this.invalidate()
  }

  /**
   * Say what the map content is, so the composite lights that and leaves the bare sheet alone
   * (`LightingContent`). Null lifts it: the composite then multiplies the whole view, as it
   * did before there was a content mask. The render loop sets it once.
   */
  setContent(content: LightingContent | null): void {
    this.content = content
    if (content && !this.contentRT) this.makeContentBuffers()
    if (!content) this.dropContentBuffers()
    this.paperSprite.visible = content !== null
    this.invalidate()
  }

  private makeContentBuffers(): void {
    const fw = Math.max(1, Math.ceil(this.width * LIGHT_FBO_SCALE))
    const fh = Math.max(1, Math.ceil(this.height * LIGHT_FBO_SCALE))
    // Full logical size, so the world renders through its own camera transform, at half the
    // screen's resolution: the same pixels the other buffers hold.
    this.contentRT = this.engine.createRenderTexture(
      Math.max(1, this.width),
      Math.max(1, this.height),
      this.engine.viewport().dpr * LIGHT_FBO_SCALE,
    )
    this.paperRT = this.engine.createRenderTexture(fw, fh)
  }

  private dropContentBuffers(): void {
    this.contentRT?.destroy(true)
    this.paperRT?.destroy(true)
    this.contentRT = null
    this.paperRT = null
  }

  /** Editing affordance toggle — the session runner hides light icons; the editor keeps them. */
  setIconsVisible(visible: boolean): void {
    this.iconsVisible = visible
    // Turning them back on has to redraw whatever the guard below last saw.
    this.lastIconSignature = ''
    if (!visible) {
      for (const [id, icon] of this.iconMap) {
        this.engine.overlay().removeChild(icon)
        icon.destroy()
        this.iconMap.delete(id)
      }
    }
  }

  /**
   * Updates the per-light bulb glyphs in the overlay. Runs every frame, guarded on a signature
   * (the icons are screen space, so the camera counts as much as the lights do).
   */
  private updateIcons(lightManager: LightManager, camX: number, camY: number, zoom: number): void {
    if (!this.iconsVisible) return
    const allLights = lightManager.getLights()

    const parts: (string | number)[] = [camX, camY, zoom]
    for (const l of allLights) {
      parts.push(l.id, l.position.x, l.position.y, l.color, l.visible !== false ? 1 : 0, l.darkness ? 1 : 0)
    }
    const signature = parts.join('|')
    if (signature === this.lastIconSignature) return
    this.lastIconSignature = signature

    const lightIds = new Set(allLights.map((l) => l.id))

    for (const [id, icon] of this.iconMap) {
      if (!lightIds.has(id)) {
        this.engine.overlay().removeChild(icon)
        icon.destroy()
        this.iconMap.delete(id)
      }
    }

    for (const light of allLights) {
      let icon = this.iconMap.get(light.id)
      if (!icon) {
        icon = new Sprite()
        icon.label = `light-icon-${light.id}`
        icon.anchor.set(0.5)
        this.engine.overlay().addChild(icon)
        this.iconMap.set(light.id, icon)
      }

      const on = light.visible !== false
      // The glyph is white with its halo baked in, so the on/off swap is a texture swap and
      // the light's own colour is a tint. A darkness source has no colour to show: ink.
      const texture = lucideTexture(on ? 'lightbulb' : 'lightbulb-off', ICON_SIZE_PX)
      if (icon.texture !== texture) icon.texture = texture
      const sp = this.engine.worldToScreen(light.position.x, light.position.y)
      icon.position.set(sp.x, sp.y)
      icon.width = ICON_SIZE_PX
      icon.height = ICON_SIZE_PX
      icon.tint = light.darkness ? 0x333333 : parseInt(light.color.replace('#', ''), 16)
      icon.alpha = on ? 0.9 : 0.4
    }
  }

  /**
   * The sky the composite is drawn under (replaces the old single grade colour). The renderer
   * composes the per-region grade mask from it itself. `allLit` is the DM's "show me
   * everything lit" view: every region lit and darkness 0 for the picture, no darkness masks;
   * night-only lights still follow the real sky.
   */
  setSky(frame: SkyFrame | null, opts: { allLit?: boolean } = {}): void {
    this.sky = frame
    this.allLit = opts.allLit === true
  }

  /** The shown level's grade as the last frame drew it — the fog's void and the background read this. */
  currentGrade(): string {
    return this.lastLevelGrade
  }

  /** Called each frame from renderLoop. */
  updateAndRender(
    lightManager: LightManager,
    camX: number,
    camY: number,
    zoom: number,
    ambientColor: string,
  ): void {
    // Before the guards below — an idle frame still says which manager is lighting the map.
    this.lastLightManager = lightManager
    this.updateIcons(lightManager, camX, camY, zoom)

    // Viewport first — it sizes the composite, and a resize has to reach the signature
    // below before the guard can decide the picture is unchanged.
    const vp = this.engine.viewport()
    if (vp.width !== this.width || vp.height !== this.height) {
      this.resize(vp.width, vp.height)
    }

    const inputs = this.inputsFor(lightManager, ambientColor, this.sky ?? NOON_FRAME, this.allLit)
    this.lastLevelGrade = this.levelGradeOf(inputs)

    // Every visible light, night-only ones filtered by the real sky's darkness. No cap: the
    // buffers cost the same however many lights there are, and the fog mask sweeps them all.
    const candidates = lightManager.getVisibleLights()
    const darkness = (this.sky ?? NOON_FRAME).darkness
    const active = candidates.filter((l) => nightOnlyActive(l, darkness))
    const now = performance.now()
    const dt = this.lastTickMs ? now - this.lastTickMs : 0
    this.lastTickMs = now
    // The first frame has nothing to fade from; reduced motion and a freeze ask for cuts.
    const fadeMs = this.presence.size === 0 || prefersReducedMotion() || isFrozen() ? 0 : LIGHT_FADE_MS
    this.presence = advancePresence(this.presence, new Set(active.map((l) => l.id)), dt, fadeMs)
    const weightOf = (id: string): number => this.presence.get(id) ?? 0
    const visibleLights = candidates.filter((l) => weightOf(l.id) > 0)

    // The grade composites always — a map's mood is not conditional on it owning a torch.
    this.compositingSprite.visible = this.liveComposite
    if (!this.liveComposite) return

    const glows = lightManager.getGlows()
    const animated =
      !isFrozen() &&
      (visibleLights.some((l) => l.animation !== undefined) || glows.some((g) => g.animation !== undefined))
    const signature = lightingSignature(
      camX,
      camY,
      zoom,
      this.width,
      this.height,
      this.gradeKeyOf(inputs),
      visibleLights,
      (id) => lightManager.staleStamp(id),
      weightOf,
      lightManager.getGlowKey(),
      animated ? now : undefined,
      this.content?.revision() ?? '',
    )
    if (signature === this.lastSignature) return
    this.lastSignature = signature

    const started = performance.now()
    this.composite(lightManager, visibleLights, glows, zoom, inputs, this.width, this.height, weightOf, {
      fbo: this.lightFBO,
      gradeRT: this.gradeRT,
      lightRT: this.lightRT,
      darkRT: this.darkRT,
      contentRT: this.contentRT,
      paperRT: this.paperRT,
      memo: true,
    })
    this.stats.compositeMs = performance.now() - started
    this.stats.recomposites++
  }

  /**
   * Draw the lighting composite over `target` for whatever transform the world container is
   * currently on, at `width`×`height` — the map export's path. Runs the same four draws into
   * throwaway buffers at resolution 1, under `frame` (the export dialog's hour, sky and
   * weather; the live sky when absent), every active light with no fade, and flicker/pulse at
   * their rest phase. The live buffers and their memo are left alone.
   *
   * A no-op before the first frame has drawn — see `lastLightManager`.
   */
  renderInto(target: RenderTexture, zoom: number, width: number, height: number, frame?: SkyFrame): void {
    const lightManager = this.lastLightManager
    if (!lightManager) return
    const sky = frame ?? this.sky ?? NOON_FRAME

    const fw = Math.max(1, Math.ceil(width * LIGHT_FBO_SCALE))
    const fh = Math.max(1, Math.ceil(height * LIGHT_FBO_SCALE))
    // Resolution 1, like the target: the sprite below is sized in the target's own pixels.
    const fbo = this.engine.createRenderTexture(fw, fh, 1)
    const gradeRT = this.engine.createRenderTexture(fw, fh, 1)
    const lightRT = this.engine.createRenderTexture(fw, fh, 1)
    const darkRT = this.engine.createRenderTexture(fw, fh, 1)
    // The file's own content mask: the world under the export transform, at half resolution.
    const contentRT = this.content ? this.engine.createRenderTexture(width, height, LIGHT_FBO_SCALE) : null
    const paperRT = this.content ? this.engine.createRenderTexture(fw, fh, 1) : null
    const swap = [
      this.gradeSprite.texture,
      this.lightSprite.texture,
      this.darkSprite.texture,
      this.contentSprite.texture,
      this.paperSprite.texture,
    ] as const

    try {
      const inputs: FrameInputs = { ...this.inputsFor(lightManager, '#ffffff', sky, false), t: 0 }
      const lights = lightManager.getVisibleLights().filter((l) => nightOnlyActive(l, sky.darkness))
      this.composite(lightManager, lights, lightManager.getGlows(), zoom, inputs, width, height, () => 1, {
        fbo,
        gradeRT,
        lightRT,
        darkRT,
        contentRT,
        paperRT,
        memo: false,
      })

      const sprite = new Sprite(fbo)
      sprite.label = 'lightingCompositeExport'
      sprite.width = width
      sprite.height = height
      sprite.blendMode = 'multiply'
      sprite.alpha = COMPOSITE_ALPHA
      const holder = new Container()
      holder.addChild(sprite)
      // clear: false — the world is already in there, this multiplies over it.
      this.engine.renderToTexture(holder, target, false)
      sprite.destroy()
      holder.destroy()
    } finally {
      this.gradeSprite.texture = swap[0]
      this.lightSprite.texture = swap[1]
      this.darkSprite.texture = swap[2]
      this.contentSprite.texture = swap[3]
      this.paperSprite.texture = swap[4]
      fbo.destroy(true)
      gradeRT.destroy(true)
      lightRT.destroy(true)
      darkRT.destroy(true)
      contentRT?.destroy(true)
      paperRT?.destroy(true)
      // The pooled geometry was posed for the export's transform; the next live frame re-poses it.
      this.invalidate()
    }
  }

  /** The regions and sky one composite draws with. A manager nobody fed regions to grades by `ambientColor`. */
  private inputsFor(lightManager: LightManager, ambientColor: string, sky: SkyFrame, allLit: boolean): FrameInputs {
    const set = lightManager.getRegions()
    const regions: Regions = set.key
      ? set
      : { level: { mood: 'lit', moodTint: ambientColor }, rooms: [], key: `ambient:${ambientColor}` }
    return { sky, allLit, t: animationTime(performance.now()), regions }
  }

  /** The sky and mood a region is graded with — everything lit, darkness 0, in the DM-lit view. */
  private gradeOf(mood: RegionMood, inputs: FrameInputs): string {
    if (inputs.allLit) return regionGrade({ ...mood, mood: 'lit' }, litFrame(inputs.sky))
    return regionGrade(mood, inputs.sky)
  }

  private levelGradeOf(inputs: FrameInputs): string {
    return this.gradeOf(inputs.regions.level, inputs)
  }

  private gradeKeyOf(inputs: FrameInputs): string {
    return `${inputs.regions.key}|${skyKey(inputs.sky)}|${inputs.allLit ? 1 : 0}`
  }

  /** The grade at a world point: the room face it is in, else the level's. */
  private gradeAt(x: number, y: number, inputs: FrameInputs): string {
    for (const room of inputs.regions.rooms) {
      if (pointInPoly(x, y, room.face)) return this.gradeOf(room.mood, inputs)
    }
    return this.levelGradeOf(inputs)
  }

  /** Puts a world-space container under the current camera, scaled into buffer pixels. */
  private poseWorld(c: Container, zoom: number): void {
    const S = LIGHT_FBO_SCALE
    const o = this.engine.worldToScreen(0, 0)
    c.position.set(o.x * S, o.y * S)
    c.scale.set(zoom * S)
  }

  /** The pooled entry for `id`, made on first use. */
  private entry(pool: Map<string, PoolEntry>, layer: Container, id: string): PoolEntry {
    let e = pool.get(id)
    if (!e) {
      const g = new Graphics()
      g.label = `light-${id}`
      g.blendMode = 'add'
      layer.addChild(g)
      e = { g, gradient: null, key: '' }
      pool.set(id, e)
    }
    return e
  }

  /** Drops pooled entries whose light is gone from the map (not merely off this frame). */
  private prune(pool: Map<string, PoolEntry>, layer: Container, keep: ReadonlySet<string>): void {
    for (const [id, e] of pool) {
      if (keep.has(id)) continue
      layer.removeChild(e.g)
      e.g.destroy()
      e.gradient?.destroy()
      pool.delete(id)
    }
  }

  /**
   * (Re)builds one light's geometry in its own frame, centred on the light: the swept polygon
   * filled with a white radial gradient (full to the bright edge, then the falloff to the dim
   * edge). Colour and strength are a tint and an alpha set per frame, so a sky change or a
   * flicker never rebuilds this.
   */
  private build(e: PoolEntry, light: LightChild, verts: VisibilityVertex[], key: string): void {
    if (e.key === key) return
    e.key = key
    e.gradient?.destroy()
    const radius = Math.max(1e-3, light.radius)
    const feather = Math.min(Math.max(0, light.featherRadius ?? 0), radius * 0.99)
    const featherOffset = feather / radius
    const stop = (a: number): string => `rgba(255,255,255,${a.toFixed(4)})`
    const colorStops: { offset: number; color: string }[] = [
      { offset: 0, color: stop(1) },
      { offset: featherOffset, color: stop(1) },
    ]
    const zone = 1 - featherOffset
    for (let i = 1; i <= FALLOFF_STOPS; i++) {
      const t = i / FALLOFF_STOPS
      colorStops.push({ offset: featherOffset + zone * t, color: stop(falloffAt(light.falloff, t)) })
    }
    e.gradient = new FillGradient({
      type: 'radial',
      center: { x: 0, y: 0 },
      innerRadius: 0,
      outerCenter: { x: 0, y: 0 },
      outerRadius: radius,
      textureSpace: 'global',
      colorStops,
    })
    const { x, y } = light.position
    e.g.clear()
    e.g.moveTo(verts[0]!.point[0] - x, verts[0]!.point[1] - y)
    for (let i = 1; i < verts.length; i++) e.g.lineTo(verts[i]!.point[0] - x, verts[i]!.point[1] - y)
    e.g.closePath()
    e.g.fill(e.gradient)
  }

  /**
   * The four draws. `target.memo` is the live pass: the grade and darkness buffers are only
   * redrawn when their own inputs move, so an animation tick redraws the light buffer and the
   * final composite alone.
   */
  private composite(
    lightManager: LightManager,
    visibleLights: readonly LightChild[],
    glows: readonly GlowProp[],
    zoom: number,
    inputs: FrameInputs,
    width: number,
    height: number,
    weightOf: (lightId: string) => number,
    target: {
      fbo: RenderTexture
      gradeRT: RenderTexture
      lightRT: RenderTexture
      darkRT: RenderTexture
      contentRT: RenderTexture | null
      paperRT: RenderTexture | null
      memo: boolean
    },
  ): void {
    const S = LIGHT_FBO_SCALE
    const fbw = Math.ceil(width * S)
    const fbh = Math.ceil(height * S)
    const o = this.engine.worldToScreen(0, 0)
    const cameraKey = `${o.x}|${o.y}|${zoom}|${width}|${height}`
    const levelGrade = this.levelGradeOf(inputs)

    // ── 1. Grade mask ──
    const gradeKey = `${this.gradeKeyOf(inputs)}|${cameraKey}`
    if (!target.memo || gradeKey !== this.lastGradeKey) {
      this.lastGradeKey = target.memo ? gradeKey : ''
      this.gradeBg.clear()
      this.gradeBg.rect(0, 0, fbw, fbh)
      this.gradeBg.fill({ color: hexNum(levelGrade), alpha: 1 })
      const facesKey = this.gradeKeyOf(inputs)
      if (facesKey !== this.gradeFacesKey) {
        this.gradeFacesKey = facesKey
        this.gradeFaces.clear()
        for (const room of inputs.regions.rooms) {
          if (room.face.length < 3) continue
          this.gradeFaces.poly(room.face.flat())
          this.gradeFaces.fill({ color: hexNum(this.gradeOf(room.mood, inputs)), alpha: 1 })
        }
      }
      this.poseWorld(this.gradeFaces, zoom)
      this.engine.renderToTexture(this.gradeRoot, target.gradeRT, true)
      this.stats.gradePasses++
    }

    // ── 2. Light buffer ──
    const lit = visibleLights.filter((l) => !l.darkness)
    const dark = inputs.allLit ? [] : visibleLights.filter((l) => l.darkness)
    const liveIds = new Set(lightManager.getLights().map((l) => l.id))
    this.prune(this.lightPool, this.lightLayer, liveIds)
    this.prune(this.darkPool, this.darkLayer, liveIds)
    for (const e of this.lightPool.values()) e.g.visible = false
    for (const light of lit) {
      const verts = lightManager.getOrComputePolygon(light)
      if (!verts || verts.length < 3) continue
      const e = this.entry(this.lightPool, this.lightLayer, light.id)
      this.build(e, light, verts, geometryKey(light, lightManager))
      const anim = animationFactor(light.animation, light.id, inputs.t)
      const grade = this.gradeAt(light.position.x, light.position.y, inputs)
      const [r, g, b] = gradedLight(light.color, grade)
      e.g.visible = true
      e.g.position.set(light.position.x, light.position.y)
      e.g.scale.set(anim.radius)
      e.g.tint = (r << 16) | (g << 8) | b
      e.g.alpha = clamp01(light.intensity * headroom(grade) * easePresence(weightOf(light.id)) * anim.intensity)
    }
    this.syncGlows(glows, inputs.t)
    this.poseWorld(this.lightLayer, zoom)
    this.poseWorld(this.glowLayer, zoom)
    const softness = inputs.sky.penumbraScale
    this.penumbra.strength = Math.min(PENUMBRA_MAX_PX * softness, PENUMBRA_CELLS * softness * zoom * S)
    this.lightLayer.filters = this.penumbra.strength >= 0.5 ? this.penumbraFilters : NO_FILTERS
    this.engine.renderToTexture(this.lightRoot, target.lightRT, true)
    this.stats.lightPasses++

    // ── 3. Darkness mask ──
    for (const e of this.darkPool.values()) e.g.visible = false
    const darkParts: (string | number)[] = [cameraKey]
    for (const light of dark) {
      const verts = lightManager.getOrComputePolygon(light)
      if (!verts || verts.length < 3) continue
      const e = this.entry(this.darkPool, this.darkLayer, light.id)
      const key = geometryKey(light, lightManager)
      this.build(e, light, verts, key)
      e.g.visible = true
      e.g.position.set(light.position.x, light.position.y)
      e.g.scale.set(1)
      e.g.tint = 0xffffff
      e.g.alpha = clamp01(light.intensity * easePresence(weightOf(light.id)))
      darkParts.push(light.id, key, Math.round(e.g.alpha * 64))
    }
    this.darkSprite.visible = darkParts.length > 1
    if (this.darkSprite.visible) {
      const darkKey = darkParts.join('|')
      if (!target.memo || darkKey !== this.lastDarkKey) {
        this.lastDarkKey = target.memo ? darkKey : ''
        this.poseWorld(this.darkLayer, zoom)
        this.darkBlur.strength = this.penumbra.strength
        this.darkLayer.filters = this.darkBlur.strength >= 0.5 ? this.darkFilters : NO_FILTERS
        this.engine.renderToTexture(this.darkRoot, target.darkRT, true)
        this.stats.darkPasses++
      }
    } else {
      this.lastDarkKey = ''
    }

    // ── 4. Content mask: the world's coverage, black on white ──
    const content = this.content
    const { contentRT, paperRT } = target
    this.paperSprite.visible = content !== null && contentRT !== null && paperRT !== null
    if (content && contentRT && paperRT) {
      const contentKey = `${cameraKey}|${content.revision()}`
      if (!target.memo || contentKey !== this.lastContentKey) {
        this.lastContentKey = target.memo ? contentKey : ''
        const restore = isolateContent(content)
        try {
          this.engine.renderToTexture(content.root, contentRT, true)
        } finally {
          restore()
        }
        this.contentSprite.texture = contentRT
        this.paperBg.clear()
        this.paperBg.rect(0, 0, fbw, fbh)
        this.paperBg.fill(0xffffff)
        this.engine.renderToTexture(this.paperRoot, paperRT, true)
        this.stats.contentPasses++
      }
      this.paperSprite.texture = paperRT
    }

    // ── 5. Final: grade + light, darkness laid over both, the bare sheet screened back to white ──
    this.gradeSprite.texture = target.gradeRT
    this.lightSprite.texture = target.lightRT
    this.darkSprite.texture = target.darkRT
    this.engine.renderToTexture(this.finalRoot, target.fbo, true)
    this.stats.finalPasses++
  }

  /** One pooled white sprite per glowing prop, posed on the prop, alpha = strength (× its animation). */
  private syncGlows(glows: readonly GlowProp[], t: number): void {
    const keep = new Set<string>()
    for (const glow of glows) {
      const { prop } = glow
      const texture = resolveTexture(prop.assetId)
      if (!texture || texture.width <= 1) continue
      keep.add(prop.id)
      let sprite = this.glowPool.get(prop.id)
      if (!sprite) {
        sprite = new Sprite(texture)
        sprite.label = `glow-${prop.id}`
        sprite.anchor.set(0.5)
        this.glowLayer.addChild(sprite)
        this.glowPool.set(prop.id, sprite)
      }
      if (sprite.texture !== texture) sprite.texture = texture
      sprite.position.set(prop.position.x, prop.position.y)
      sprite.rotation = prop.rotation
      sprite.width = prop.width * prop.scale
      sprite.height = prop.height * prop.scale
      // The size setters keep the scale's sign, so a pooled sprite flipped last pass is
      // still flipped here: set the flip from the prop, never toggle it.
      sprite.scale.x = Math.abs(sprite.scale.x) * (prop.flipX ? -1 : 1)
      sprite.scale.y = Math.abs(sprite.scale.y) * (prop.flipY ? -1 : 1)
      sprite.alpha = clamp01(glow.strength * animationFactor(glow.animation, prop.id, t).intensity)
    }
    for (const [id, sprite] of this.glowPool) {
      if (keep.has(id)) continue
      this.glowLayer.removeChild(sprite)
      sprite.destroy()
      this.glowPool.delete(id)
    }
  }

  /** How many pooled display objects the light pass holds — constant while the light set is. */
  poolSize(): number {
    return this.lightPool.size + this.darkPool.size + this.glowPool.size
  }

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return

    this.width = width
    this.height = height

    const fw = Math.max(1, Math.ceil(width * LIGHT_FBO_SCALE))
    const fh = Math.max(1, Math.ceil(height * LIGHT_FBO_SCALE))
    this.lightFBO.destroy(true)
    this.lightFBO = this.engine.createRenderTexture(fw, fh)
    this.compositingSprite.texture = this.lightFBO
    this.compositingSprite.width = width
    this.compositingSprite.height = height
    this.gradeRT.destroy(true)
    this.gradeRT = this.engine.createRenderTexture(fw, fh)
    this.lightRT.destroy(true)
    this.lightRT = this.engine.createRenderTexture(fw, fh)
    this.darkRT.destroy(true)
    this.darkRT = this.engine.createRenderTexture(fw, fh)
    if (this.contentRT) {
      this.dropContentBuffers()
      this.makeContentBuffers()
    }
    this.invalidate()
  }

  destroy(): void {
    for (const icon of this.iconMap.values()) {
      this.engine.overlay().removeChild(icon)
      icon.destroy()
    }
    this.iconMap.clear()
    this.setClip(null)
    this.engine.overlay().removeChild(this.compositingSprite)
    this.compositingSprite.destroy()
    for (const e of [...this.lightPool.values(), ...this.darkPool.values()]) e.gradient?.destroy()
    this.lightPool.clear()
    this.darkPool.clear()
    this.glowPool.clear()
    this.penumbra.destroy()
    this.darkBlur.destroy()
    this.gradeBlur.destroy()
    this.glowWhite.destroy()
    this.lightFBO.destroy(true)
    this.gradeRT.destroy(true)
    this.lightRT.destroy(true)
    this.darkRT.destroy(true)
    this.dropContentBuffers()
    this.content = null
    this.paperRoot.destroy({ children: true })
    this.gradeRoot.destroy({ children: true })
    this.lightRoot.destroy({ children: true })
    this.darkRoot.destroy({ children: true })
    this.finalRoot.destroy({ children: true })
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** What a light's pooled geometry is built from: its polygon's staleness, reach and curve. */
function geometryKey(light: LightChild, lightManager: LightManager): string {
  return `${lightManager.staleStamp(light.id)}|${light.position.x}|${light.position.y}|${light.radius}|${light.featherRadius ?? 0}|${light.falloff}`
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

const NO_FILTERS: BlurFilter[] = []

const hexNum = (hex: string): number => {
  const [r, g, b] = rgb(hex)
  return (r << 16) | (g << 8) | b
}

/** Even-odd point in polygon. */
function pointInPoly(x: number, y: number, poly: readonly [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!
    const [xj, yj] = poly[j]!
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
