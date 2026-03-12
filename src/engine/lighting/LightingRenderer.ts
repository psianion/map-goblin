import { Container, FillGradient, Graphics, RenderTexture, Sprite } from 'pixi.js'
import type { RenderEngine } from '../RenderEngine'
import type { LightManager } from './LightManager'

/**
 * LightingRenderer — FBO-based light compositing pass.
 *
 * Compositing architecture:
 *  1. Clear lightFBO with the ambient color (base darkness).
 *  2. For each visible light, render into an isolated per-light RT:
 *     a. Draw the visibility polygon directly with a radial FillGradient.
 *  3. Composite each per-light RT into lightFBO with additive blend (clear:false).
 *  4. Composite lightFBO over the scene via a multiply-blended full-screen Sprite.
 *
 * Per-light isolation prevents cross-light erasure: each light's visibility
 * polygon only affects its own gradient. A single shared perLightRT is
 * reused (cleared per light) to avoid allocating multiple RenderTextures.
 */
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

  constructor(engine: RenderEngine, width: number, height: number) {
    this.engine = engine
    this.width = width
    this.height = height

    this.lightFBO = engine.createRenderTexture(width, height)
    this.perLightRT = engine.createRenderTexture(width, height)

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

  /** Updates per-light icon circles in the overlay. Runs every frame. */
  private updateIcons(lightManager: LightManager): void {
    const allLights = lightManager.getLights()
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

  /** Called each frame from renderLoop. */
  updateAndRender(
    lightManager: LightManager,
    _camX: number,
    _camY: number,
    zoom: number,
    ambientColor: string,
  ): void {
    this.updateIcons(lightManager)

    const visibleLights = lightManager.getVisibleLights()

    if (visibleLights.length === 0) {
      this.compositingSprite.visible = false
      return
    }
    this.compositingSprite.visible = true

    const ambientHex = parseInt(ambientColor.replace('#', ''), 16)
    const ambientR = (ambientHex >> 16) & 0xff
    const ambientG = (ambientHex >> 8) & 0xff
    const ambientB = ambientHex & 0xff
    const ambientColorNum = (ambientR << 16) | (ambientG << 8) | ambientB

    // ── Step 1: Fill lightFBO with ambient color ──
    this.ambientContainer.removeChildren()
    const ambientG2 = new Graphics()
    ambientG2.rect(0, 0, this.width, this.height)
    ambientG2.fill({ color: ambientColorNum, alpha: 1 })
    this.ambientContainer.addChild(ambientG2)
    this.engine.renderToTexture(this.ambientContainer, this.lightFBO, true)

    // Sprite used to composite each per-light RT into lightFBO
    const blitSprite = new Sprite(this.perLightRT)
    blitSprite.width = this.width
    blitSprite.height = this.height
    blitSprite.blendMode = 'add'
    const blitContainer = new Container()
    blitContainer.addChild(blitSprite)

    const frameGradients: FillGradient[] = []

    for (const light of visibleLights) {
      const visibilityVerts = lightManager.getOrComputePolygon(light)
      if (!visibilityVerts || visibilityVerts.length < 3) continue

      const screenCenter = this.engine.worldToScreen(light.position.x, light.position.y)
      const screenRadius = Math.max(1, light.radius * zoom)
      const lightHex = parseInt(light.color.replace('#', ''), 16)
      const lr = (lightHex >> 16) & 0xff
      const lg = (lightHex >> 8) & 0xff
      const lb = lightHex & 0xff
      const alpha = Math.min(1, light.intensity)
      const toRgba = (a: number): string => `rgba(${lr},${lg},${lb},${a.toFixed(4)})`

      const screenFeather = (light.featherRadius ?? 0) * zoom
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

      // Draw visibility polygon directly with gradient fill (no circle, no Clipper2 shadow)
      const screenPoly: [number, number][] = visibilityVerts.map((v) => {
        const sp = this.engine.worldToScreen(v.point[0], v.point[1])
        return [sp.x, sp.y] as [number, number]
      })

      const gradG = new Graphics()
      tracePolyTuple(gradG, screenPoly)
      gradG.fill(gradient)
      this.perLightContainer.addChild(gradG)

      // Render isolated light into perLightRT (cleared to black each time)
      this.engine.renderToTexture(this.perLightContainer, this.perLightRT, true)

      // ── Step 3: Composite perLightRT into lightFBO with additive blend ──
      this.engine.renderToTexture(blitContainer, this.lightFBO, false)
    }

    // Cleanup
    blitSprite.destroy()
    blitContainer.destroy()
    for (const g of frameGradients) g.destroy()

    const vp = this.engine.viewport()
    if (vp.width !== this.width || vp.height !== this.height) {
      this.resize(vp.width, vp.height)
    }
  }

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return

    this.width = width
    this.height = height

    this.lightFBO.destroy(true)
    this.lightFBO = this.engine.createRenderTexture(width, height)
    this.compositingSprite.texture = this.lightFBO
    this.compositingSprite.width = width
    this.compositingSprite.height = height

    this.perLightRT.destroy(true)
    this.perLightRT = this.engine.createRenderTexture(width, height)
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
