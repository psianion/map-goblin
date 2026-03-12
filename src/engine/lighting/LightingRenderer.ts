import { Container, FillGradient, Graphics, RenderTexture, Sprite } from 'pixi.js'
import type { RenderEngine } from '../RenderEngine'
import type { LightManager } from './LightManager'

/**
 * LightingRenderer — FBO-based light compositing pass.
 *
 * Each frame:
 *  1. Clears the offscreen lightFBO RenderTexture.
 *  2. Draws each visible light's visibility polygon with a radial FillGradient
 *     for linear/quadratic falloff, then composites into the FBO.
 *  3. Composites the FBO over the scene via a full-screen Sprite in the overlay.
 *
 * The compositingSprite uses 'multiply' blend mode so it darkens areas with no light
 * while leaving lit areas bright. The ambient light sets the base brightness.
 *
 * Note on FillGradient lifetime: FillGradients with textureSpace:'global' embed
 * screen-space coordinates and must be rebuilt every frame (camera movement
 * invalidates them). They are created per-frame and destroyed immediately after
 * renderToTexture() completes, keeping GPU texture memory bounded.
 */
export class LightingRenderer {
  private engine: RenderEngine
  private lightFBO: RenderTexture
  private lightContainer: Container
  private compositingSprite: Sprite
  private width: number
  private height: number

  constructor(engine: RenderEngine, width: number, height: number) {
    this.engine = engine
    this.width = width
    this.height = height

    // Off-screen RenderTexture for accumulating light
    this.lightFBO = engine.createRenderTexture(width, height)

    // Container used to draw lights into the FBO (in world-space coords)
    this.lightContainer = new Container()
    this.lightContainer.label = 'lightContainer'

    // Full-screen sprite in overlay (screen-space), shows the composited lighting
    this.compositingSprite = new Sprite(this.lightFBO)
    this.compositingSprite.label = 'lightingComposite'
    this.compositingSprite.width = width
    this.compositingSprite.height = height
    this.compositingSprite.blendMode = 'multiply'
    this.compositingSprite.alpha = 0.95

    // Add to overlay so it sits above the world but below UI chrome
    engine.overlay().addChild(this.compositingSprite)
  }

  /**
   * Called each frame from renderLoop.
   * Redraws all visible lights and composites the result.
   */
  updateAndRender(
    lightManager: LightManager,
    _camX: number,
    _camY: number,
    zoom: number,
    ambientColor: string,
  ): void {
    const visibleLights = lightManager.getVisibleLights()

    // No lights → hide compositing sprite (show full brightness / ambient only)
    if (visibleLights.length === 0) {
      this.compositingSprite.visible = false
      return
    }
    this.compositingSprite.visible = true

    // Parse ambient color to 0-255 channels
    const ambientHex = parseInt(ambientColor.replace('#', ''), 16)
    const ambientR = (ambientHex >> 16) & 0xff
    const ambientG = (ambientHex >> 8) & 0xff
    const ambientB = ambientHex & 0xff

    // Clear and redraw all lights into the FBO each frame
    this.lightContainer.removeChildren()

    // Draw ambient fill first (base darkness layer)
    const ambient = new Graphics()
    ambient.rect(0, 0, this.width, this.height)
    ambient.fill({
      color: (ambientR << 16) | (ambientG << 8) | ambientB,
      alpha: 1,
    })
    this.lightContainer.addChild(ambient)

    // Collect per-frame FillGradients so they can be destroyed after renderToTexture.
    // FillGradients with textureSpace:'global' embed screen coords and cannot be cached
    // across frames — camera movement invalidates them every frame.
    const frameGradients: FillGradient[] = []

    // Draw each visible light
    for (const light of visibleLights) {
      const polygon = lightManager.getCachedPolygon(light.id)
      if (!polygon || polygon.length < 3) continue

      const lightHex = parseInt(light.color.replace('#', ''), 16)
      const lightGraphics = new Graphics()

      // Convert world-space polygon to screen space
      // The FBO is screen-sized, so we need to transform: screen = world * zoom + camOffset
      // camX and camY are world-space origin in screen coords: screenPos = (world - cam) * zoom
      // But the FBO maps 1:1 to screen pixels, so we need world→screen transform.
      // The overlay is NOT camera-transformed, so we use screenToWorld in reverse.
      // We directly use the engine's worldToScreen transform for each point.
      const screenPoints: number[] = []
      for (const [wx, wy] of polygon) {
        const sp = this.engine.worldToScreen(wx, wy)
        screenPoints.push(sp.x, sp.y)
      }

      if (screenPoints.length >= 6) {
        // Build path from screen-space points
        lightGraphics.moveTo(screenPoints[0], screenPoints[1])
        for (let i = 2; i < screenPoints.length; i += 2) {
          lightGraphics.lineTo(screenPoints[i], screenPoints[i + 1])
        }
        lightGraphics.closePath()

        // Build radial gradient centered at the light's screen position.
        // Rebuilt every frame because screen coords change on any camera move.
        const screenCenter = this.engine.worldToScreen(light.position.x, light.position.y)
        const screenRadius = Math.max(1, light.radius * zoom)
        const alpha = Math.min(1, light.intensity)
        const lr = (lightHex >> 16) & 0xff
        const lg = (lightHex >> 8) & 0xff
        const lb = lightHex & 0xff
        const toRgba = (a: number): string => `rgba(${lr},${lg},${lb},${a.toFixed(4)})`

        const colorStops =
          light.falloff === 'linear'
            ? [
                { offset: 0, color: toRgba(alpha) },
                { offset: 1, color: toRgba(0) },
              ]
            : [
                { offset: 0, color: toRgba(alpha) },
                { offset: 0.75, color: toRgba(alpha * 0.25) },
                { offset: 1, color: toRgba(0) },
              ]

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
        lightGraphics.fill(gradient)
      }

      this.lightContainer.addChild(lightGraphics)
    }

    // Render the light container into the FBO, then release frame gradients
    this.engine.renderToTexture(this.lightContainer, this.lightFBO)
    for (const g of frameGradients) g.destroy()

    // Update compositing sprite size in case of resize
    this.compositingSprite.width = this.width
    this.compositingSprite.height = this.height

    const vp = this.engine.viewport()
    if (vp.width !== this.width || vp.height !== this.height) {
      this.resize(vp.width, vp.height)
    }
  }

  /**
   * Resize the FBO when the canvas resizes.
   */
  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return

    this.width = width
    this.height = height

    this.lightFBO.destroy(true)
    this.lightFBO = this.engine.createRenderTexture(width, height)
    this.compositingSprite.texture = this.lightFBO
    this.compositingSprite.width = width
    this.compositingSprite.height = height
  }

  /**
   * Clean up GPU resources.
   */
  destroy(): void {
    this.engine.overlay().removeChild(this.compositingSprite)
    this.compositingSprite.destroy()
    this.lightFBO.destroy(true)
    this.lightContainer.destroy({ children: true })
  }
}
