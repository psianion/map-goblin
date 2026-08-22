import { Container, FillGradient, Graphics, RenderTexture, Sprite } from 'pixi.js'
import type { RenderEngine } from '../RenderEngine'
import type { LightChild } from '../../store/types'
import type { LightManager } from './LightManager'
import { resolveTexture } from '../../assets/textureLoader'

/**
 * Everything the composite below is a function of, as one comparable string.
 *
 * The pass costs a full-viewport FBO clear plus two full-viewport render-target passes and
 * one gradient-texture upload *per light*, every frame — and on an idle table none of its
 * inputs move. `lightFBO` keeps its contents between frames and the compositing sprite goes
 * on drawing it, so a frame whose signature is unchanged would redraw the identical picture.
 *
 * Every input that can change the picture has to appear here, which is what
 * `LightingRenderer.test.ts` pins field by field. The light positions are *screen* space by
 * the time they are drawn, so the camera belongs in the signature as much as the lights do.
 *
 * `maskTextureId` goes in by id *and* by the resolved texture's width: a mask that hasn't
 * finished loading resolves to a 1x1 placeholder, and the id alone doesn't change when the
 * real texture lands — that used to leave a late-loading mask stuck on the fallback gradient
 * until something else invalidated the frame.
 *
 * `timeBucket` is the world clock, already coarsened to a bucket by whoever composed the grade
 * (`shared/world.ts`). A raw clock reading here would defeat the whole memo; a bucket moves the
 * string a few times a second while a DM scrubs and never while the clock is paused. The grade
 * colour covers today's picture on its own — the bucket is what the sun/moon pass (P3) rides
 * on, whose direction moves within one grade colour.
 */
export function lightingSignature(
  camX: number,
  camY: number,
  zoom: number,
  width: number,
  height: number,
  ambientColor: string,
  lights: LightChild[],
  isDirty: (lightId: string) => boolean,
  darkness = 1,
  timeBucket = 0,
): string {
  const parts = [camX, camY, zoom, width, height, ambientColor, darkness, timeBucket]
  for (const l of lights) {
    const maskWidth = l.maskTextureId ? resolveTexture(l.maskTextureId).width : 0
    parts.push(
      l.id,
      l.position.x,
      l.position.y,
      l.radius,
      l.color,
      l.intensity,
      l.falloff,
      l.featherRadius ?? 0,
      l.maskTextureId ?? '',
      maskWidth,
      isDirty(l.id) ? 'dirty' : '',
    )
  }
  return parts.join('|')
}

/**
 * Hard cap on lights composited in one frame. Each one costs a full-viewport render-target
 * pass plus a full-viewport additive composite — measured at ~0.5-0.75ms apiece on the dressed
 * gate map (see `LightingRenderer.test.ts` perf notes), so an uncapped table full of torches
 * turns into tens of milliseconds of GPU time no scheduler fixes without changing the picture.
 * Beyond the cap, the lights nearest the camera win; the rest stay placed and lit up again the
 * moment the table scrolls back to them or another one is hidden.
 *
 * ponytail: known ceiling, and S3 P3 gave it a second edge (D3). The player's fog mask sweeps
 * EVERY source (`lightSources` — placed lights plus carried torches), so past 24 sources a
 * pool the mask has cleared can go unrendered while the map under it stays open: the fog errs
 * *open* there, and which pool loses is a function of where the camera is pointing. A party of
 * six with torches on a lamp-lit map is inside a dozen; revisit the day the P6 gate map plus a
 * full party crosses 24 — either cap the mask by the same rule or batch the composite.
 */
export const MAX_RENDERED_LIGHTS = 24

/** The `cap` nearest lights to (camX, camY), in world space. A no-op under the cap. */
export function cullLightsByDistance(
  lights: LightChild[],
  camX: number,
  camY: number,
  cap: number,
): LightChild[] {
  if (lights.length <= cap) return lights
  return [...lights]
    .sort((a, b) => {
      const da = (a.position.x - camX) ** 2 + (a.position.y - camY) ** 2
      const db = (b.position.x - camX) ** 2 + (b.position.y - camY) ** 2
      return da - db
    })
    .slice(0, cap)
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
 * The grade fills the FBO and the lights *add* on top of it, so a bright enough pool washes
 * the fill out from under itself and lit ground escapes the world's mood entirely — which is
 * what the live walk measured. Tinting each light's contribution by `lerp(white, grade, w)`
 * puts the grade back into the pool without going through the composite, where it would hit
 * the lights and the ground alike and desaturate every torch toward the grade's hue.
 *
 * At 0.35 a torch keeps its own hue dominant — a warm pool stays a warm pool, within a few
 * degrees of its ungraded angle — while a cold night visibly cools it and a day grade leaves
 * it alone. Raise it if night pools still read as day pools; lower it if torches start
 * turning the colour of the sky.
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
 * How much room the grade leaves a light to burn into, 0..1 — the whole of what stops a pool
 * from clamping, and the reason a torch stops mattering at noon.
 *
 * The FBO is filled with the grade and every light *adds* on top of it, then the whole thing
 * multiplies the scene. Add is unsigned, so once the grade sits near white a light has nowhere
 * left to go: the sum saturates, and a saturated pool multiplies by pure white — which is not a
 * bright pool but *no pool at all*, the ground beneath it rendered at its authored daylight
 * brightness with the light's warmth and the world's mood both clipped away. Measured live at
 * midnight and at 17:00: pool centres at (255,255,255) over a graded surround, reading as flat
 * white boxes with hard visibility-polygon edges.
 *
 * Scaling each light's contribution by the headroom above the grade's *brightest* channel is
 * what makes the pass total-light-aware instead of blind: at midnight the grade is dark, the
 * headroom is most of the range and a torch dominates; at golden hour the grade is already at
 * 98% red and the same torch correctly does almost nothing. Off the brightest channel rather
 * than a luminance so the bound is exact — a single light can reach white but never past it —
 * and as one scalar rather than per-channel so the pool keeps its own hue instead of
 * desaturating toward whichever channel happened to have room left.
 *
 * ponytail: bounds one light, not a stack — two pools dead on top of each other can still
 * saturate where they overlap. Screen-blend the composite if a map ever piles them that way.
 */
export function headroom(grade: string): number {
  const [r, g, b] = rgb(grade)
  return 1 - Math.max(r, g, b) / 255
}

/**
 * LightingRenderer — FBO-based light compositing pass.
 *
 * Compositing architecture:
 *  1. Clear lightFBO with the grade, plus the player's bite as a second pass of it.
 *  2. For each visible light, render into an isolated per-light RT:
 *     a. Draw the visibility polygon directly with a radial FillGradient.
 *  3. Composite each per-light RT into lightFBO with additive blend (clear:false).
 *  4. Composite lightFBO over the scene via a multiply-blended full-screen Sprite.
 *
 * Per-light isolation prevents cross-light erasure: each light's visibility
 * polygon only affects its own gradient. A single shared perLightRT is
 * reused (cleared per light) to avoid allocating multiple RenderTextures.
 */
/**
 * Lightmaps are smooth gradients, so they survive upscaling that geometry
 * never could: the FBOs render at half linear resolution (quarter the pixels)
 * and the composite sprite's linear filter stretches them back. Full-res
 * FBOs re-rendered on every camera move were 60-100ms/frame on integrated
 * GPUs — the single biggest pan/zoom cost in the editor.
 */
const LIGHT_FBO_SCALE = 0.5

export class LightingRenderer {
  private engine: RenderEngine
  private lightFBO: RenderTexture
  private perLightRT: RenderTexture
  private perLightContainer: Container
  private ambientContainer: Container
  private compositingSprite: Sprite
  private width: number
  private height: number
  private iconMap = new Map<string, Graphics>()
  private iconsVisible = true
  private lastSignature = ''
  private lastIconSignature = ''
  /**
   * How hard the ambient fill bites *on top of the grade*, 0..1 (S3 P3 §4) — a second pass of
   * the grade over the base, and the whole of what a player's seat gets that a DM's does not.
   *
   * 0 is nobody having asked for one, which is every editor frame and the DM's seat at every
   * level: the base is then the grade alone, exactly what this pass has always drawn. It bites
   * the *unlit* base only — a light adds into the same FBO and washes the fill out inside its
   * own pool — so dialling it back lifts the surround without touching the glows.
   */
  private ambientDarkness = 0
  /**
   * The composed grade, when something has composed one — the mood tint alone today, and mood
   * × time × environment damping once the world clock exists. `null` is "nobody has composed
   * one", which is every editor frame: the map's own `ambientLight` is then the grade, and
   * this pass reads it off the frame like it always has.
   */
  private grade: string | null = null
  /** The clock the grade was composed at, bucketed — see `lightingSignature`. */
  private timeBucket = 0

  constructor(engine: RenderEngine, width: number, height: number) {
    this.engine = engine
    this.width = width
    this.height = height

    this.lightFBO = engine.createRenderTexture(
      Math.max(1, Math.ceil(width * LIGHT_FBO_SCALE)),
      Math.max(1, Math.ceil(height * LIGHT_FBO_SCALE)),
    )
    this.perLightRT = engine.createRenderTexture(
      Math.max(1, Math.ceil(width * LIGHT_FBO_SCALE)),
      Math.max(1, Math.ceil(height * LIGHT_FBO_SCALE)),
    )

    this.perLightContainer = new Container()
    this.perLightContainer.label = 'perLightContainer'

    this.ambientContainer = new Container()
    this.ambientContainer.label = 'ambientContainer'

    this.compositingSprite = new Sprite(this.lightFBO)
    this.compositingSprite.label = 'lightingComposite'
    this.compositingSprite.width = width
    this.compositingSprite.height = height
    this.compositingSprite.blendMode = 'multiply'
    this.compositingSprite.alpha = 0.95

    engine.overlay().addChild(this.compositingSprite)
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
   * Updates per-light icon circles in the overlay. Runs every frame.
   *
   * Guarded the same way the composite below is, and for the same reason: the
   * icons are drawn in *screen* space, so the camera decides where they land as
   * much as the lights do — and on an idle editor neither moves. Unguarded this
   * cleared and re-traced every light's Graphics 60 times a second to draw the
   * identical circle.
   */
  private updateIcons(lightManager: LightManager, camX: number, camY: number, zoom: number): void {
    if (!this.iconsVisible) return
    const allLights = lightManager.getLights()

    const parts: (string | number)[] = [camX, camY, zoom]
    for (const l of allLights) {
      parts.push(l.id, l.position.x, l.position.y, l.color, l.visible !== false ? 1 : 0)
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
        icon = new Graphics()
        icon.label = `light-icon-${light.id}`
        this.engine.overlay().addChild(icon)
        this.iconMap.set(light.id, icon)
      }

      icon.clear()
      const sp = this.engine.worldToScreen(light.position.x, light.position.y)
      const color = parseInt(light.color.replace('#', ''), 16)
      const alpha = light.visible !== false ? 0.9 : 0.4
      icon.setStrokeStyle({ color: 0xffffff, alpha: alpha * 0.7, width: 1.5 })
      icon.circle(sp.x, sp.y, 12)
      icon.fill({ color, alpha })
      icon.stroke()
    }
  }

  /**
   * The scene's light level, as a strength on the ambient fill (S3 P3 §4). The session sets it
   * from the DM's ambient dial; the editor never touches it.
   *
   * `null` is "no dial set" — no bite, which is the only state the editor is ever in and
   * leaves the base as the grade alone, exactly what this pass drew before the dial existed.
   * A number is clamped, because a value outside 0..1 is a caller bug that would otherwise
   * show up as a black table or an unlit one.
   */
  setAmbientLevel(darkness: number | null): void {
    this.ambientDarkness = darkness === null ? 0 : Math.min(1, Math.max(0, darkness))
  }

  /**
   * The scene's grade — one final composed colour, applied to every seat including the DM's.
   *
   * Separate from `setAmbientLevel` on purpose: the grade is *presentation* (what the world
   * looks like) and the bite is *vision* (what a player is allowed to see), and only the
   * second is ever dialled per seat. `null` hands the frame's own `ambientLight` back.
   *
   * `timeBucket` is the clock the colour was composed at, coarsened (`shared/world.ts`) — it
   * rides along here rather than through `updateAndRender` because it is an input to the same
   * composition, and the caller that has one always has the other.
   */
  setGrade(color: string | null, timeBucket = 0): void {
    this.grade = color
    this.timeBucket = timeBucket
  }

  /** Called each frame from renderLoop. `darkness` defaults to whatever the dial last set. */
  updateAndRender(
    lightManager: LightManager,
    camX: number,
    camY: number,
    zoom: number,
    ambientColor: string,
    darkness = this.ambientDarkness,
  ): void {
    this.updateIcons(lightManager, camX, camY, zoom)

    // Viewport first — it sizes the composite, and a resize has to reach the signature
    // below before the guard can decide the picture is unchanged.
    const vp = this.engine.viewport()
    if (vp.width !== this.width || vp.height !== this.height) {
      this.resize(vp.width, vp.height)
    }

    // Cap first: a table with more lights than the budget still owes a picture, just not
    // one drawn from all of them. Everything below only ever sees the culled set.
    const visibleLights = cullLightsByDistance(
      lightManager.getVisibleLights(),
      camX,
      camY,
      MAX_RENDERED_LIGHTS,
    )

    // The grade composites always — a map's mood is not conditional on it owning a torch, and
    // the old no-lights shortcut is why a lightless map was the one map with no mood at all.
    this.compositingSprite.visible = true

    const bite = darkness
    const grade = this.grade ?? ambientColor
    const signature = lightingSignature(
      camX,
      camY,
      zoom,
      this.width,
      this.height,
      grade,
      visibleLights,
      (id) => lightManager.isDirty(id),
      bite,
      this.timeBucket,
    )
    if (signature === this.lastSignature) return
    this.lastSignature = signature

    const [gradeR, gradeG, gradeB] = rgb(grade)
    const gradeColorNum = (gradeR << 16) | (gradeG << 8) | gradeB
    // What the grade leaves for the lights to burn into — see `headroom`.
    const lightRoom = headroom(grade)

    // Everything below draws in FBO pixels — screen coords scaled by the FBO's
    // resolution factor. The composite sprite stretches the result back out.
    const S = LIGHT_FBO_SCALE

    // ── Step 1: Fill lightFBO with the grade, then the bite ──
    // The grade is universal — every seat, every scene, opaque, whatever the bite says. The
    // bite is a *second* pass of the same colour and it is the player's alone: a DM (or the
    // editor) is at 0 and lands on the grade as authored, which is the mood and is theirs to
    // see. Both are the grade, so a neutral white grade still composites to nothing at any
    // bite — the anchor that keeps a map nobody has graded looking untouched.
    this.ambientContainer.removeChildren()
    const ambientG2 = new Graphics()
    const fbw = Math.ceil(this.width * S)
    const fbh = Math.ceil(this.height * S)
    ambientG2.rect(0, 0, fbw, fbh)
    ambientG2.fill({ color: gradeColorNum, alpha: 1 })
    if (bite > 0) {
      ambientG2.rect(0, 0, fbw, fbh)
      ambientG2.fill({ color: gradeColorNum, alpha: bite })
    }
    this.ambientContainer.addChild(ambientG2)
    this.engine.renderToTexture(this.ambientContainer, this.lightFBO, true)

    // Sprite used to composite each per-light RT into lightFBO — natural size,
    // both RTs share the same scaled dimensions.
    const blitSprite = new Sprite(this.perLightRT)
    blitSprite.blendMode = 'add'
    const blitContainer = new Container()
    blitContainer.addChild(blitSprite)

    const frameGradients: FillGradient[] = []

    for (const light of visibleLights) {
      const visibilityVerts = lightManager.getOrComputePolygon(light)
      if (!visibilityVerts || visibilityVerts.length < 3) continue

      const rawCenter = this.engine.worldToScreen(light.position.x, light.position.y)
      const screenCenter = { x: rawCenter.x * S, y: rawCenter.y * S }
      const screenRadius = Math.max(1, light.radius * zoom * S)
      // W1 — the light's own colour, with the grade's share of it taken (`W_LIGHT_GRADE`).
      // This is what puts the world's mood on *lit* ground: the pool keeps its own hue and
      // still cools when the night does, where grading the whole composite instead would
      // drag every torch toward the sky's colour.
      const [lr, lg, lb] = gradedLight(light.color, grade)
      const alpha = Math.min(1, Math.max(0, light.intensity * lightRoom))
      const toRgba = (a: number): string => `rgba(${lr},${lg},${lb},${a.toFixed(4)})`

      const screenFeather = (light.featherRadius ?? 0) * zoom * S
      const feather = Math.min(screenFeather, screenRadius * 0.99)
      const featherOffset = screenRadius > 0 ? feather / screenRadius : 0

      const colorStops: { offset: number; color: string }[] = [
        { offset: 0,             color: toRgba(alpha) },
        { offset: featherOffset, color: toRgba(alpha) },
      ]

      if (light.falloff === 'linear') {
        const zone = 1 - featherOffset
        for (let i = 1; i <= 4; i++) {
          const t = i / 4
          colorStops.push({ offset: featherOffset + zone * t, color: toRgba(alpha * (1 - t)) })
        }
      } else {
        const zone = 1 - featherOffset
        for (let i = 1; i <= 6; i++) {
          const t = i / 6
          colorStops.push({ offset: featherOffset + zone * t, color: toRgba(alpha * (1 - t * t)) })
        }
      }

      const gradient = new FillGradient({
        type: 'radial',
        center: { x: screenCenter.x, y: screenCenter.y },
        innerRadius: 0,
        outerCenter: { x: screenCenter.x, y: screenCenter.y },
        outerRadius: screenRadius,
        textureSpace: 'global',
        colorStops,
      })
      frameGradients.push(gradient)

      // ── Step 2: Render this light into perLightRT (isolated) ──
      this.perLightContainer.removeChildren()

      // Phase 7: If light has a custom mask texture, use it instead of visibility polygon
      if (light.maskTextureId) {
        const maskTex = resolveTexture(light.maskTextureId)
        if (maskTex.width > 1) {
          const maskSprite = new Sprite(maskTex)
          maskSprite.anchor.set(0.5)
          maskSprite.position.set(screenCenter.x, screenCenter.y)
          // Scale mask to cover the light's radius in screen space
          const maskScale = (screenRadius * 2) / Math.max(maskTex.width, maskTex.height)
          maskSprite.scale.set(maskScale)
          maskSprite.alpha = alpha
          maskSprite.tint = (lr << 16) | (lg << 8) | lb
          this.perLightContainer.addChild(maskSprite)
        } else {
          // Mask texture not loaded — fall back to gradient
          const screenPoly: [number, number][] = visibilityVerts.map((v) => {
            const sp = this.engine.worldToScreen(v.point[0], v.point[1])
            return [sp.x * S, sp.y * S] as [number, number]
          })
          const gradG = new Graphics()
          tracePolyTuple(gradG, screenPoly)
          gradG.fill(gradient)
          this.perLightContainer.addChild(gradG)
        }
      } else {
        // Default: Draw visibility polygon with gradient fill
        const screenPoly: [number, number][] = visibilityVerts.map((v) => {
          const sp = this.engine.worldToScreen(v.point[0], v.point[1])
          return [sp.x * S, sp.y * S] as [number, number]
        })

        const gradG = new Graphics()
        tracePolyTuple(gradG, screenPoly)
        gradG.fill(gradient)
        this.perLightContainer.addChild(gradG)
      }

      // Render isolated light into perLightRT (cleared to black each time)
      this.engine.renderToTexture(this.perLightContainer, this.perLightRT, true)

      // ── Step 3: Composite perLightRT into lightFBO with additive blend ──
      this.engine.renderToTexture(blitContainer, this.lightFBO, false)
    }

    // Cleanup
    blitSprite.destroy()
    blitContainer.destroy()
    for (const g of frameGradients) g.destroy()
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

    this.perLightRT.destroy(true)
    this.perLightRT = this.engine.createRenderTexture(fw, fh)
  }

  destroy(): void {
    for (const icon of this.iconMap.values()) {
      this.engine.overlay().removeChild(icon)
      icon.destroy()
    }
    this.iconMap.clear()
    this.engine.overlay().removeChild(this.compositingSprite)
    this.compositingSprite.destroy()
    this.lightFBO.destroy(true)
    this.perLightRT.destroy(true)
    this.perLightContainer.destroy({ children: true })
    this.ambientContainer.destroy({ children: true })
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Trace a polygon path into a Graphics object (without fill/stroke). */
function tracePolyTuple(g: Graphics, poly: [number, number][]): void {
  if (poly.length < 3) return
  g.moveTo(poly[0][0], poly[0][1])
  for (let i = 1; i < poly.length; i++) {
    g.lineTo(poly[i][0], poly[i][1])
  }
  g.closePath()
}
