import { Application, Container, RenderTexture, type Renderer } from 'pixi.js';
import type { RenderEngine, CameraState } from './RenderEngine';
import type { Point, Viewport } from '@/types/geometry';
import { registerManifestBundles, getManifest } from './assetManifest.ts';
import { useStore } from '@/store/store';

export class PixiRenderEngine implements RenderEngine {
  private app: Application | null = null;
  private worldContainer = new Container();
  private overlayContainer = new Container();
  private _viewport: Viewport = { width: 0, height: 0, dpr: 1 };

  async init(container: HTMLDivElement): Promise<void> {
    const dpr = window.devicePixelRatio;
    this._viewport.dpr = dpr;

    this.app = new Application();
    await this.app.init({
      resizeTo: undefined,
      resolution: dpr,
      autoDensity: true,
      antialias: true,
      backgroundColor: 0x2d2d2d,
      // Required for E2E pixel-sampling tests (ctx.drawImage on WebGL canvas)
      preserveDrawingBuffer: true,
    });

    // Guard: destroy() may have been called during async init (React Strict Mode)
    if (!this.app) return;

    await registerManifestBundles();
    useStore.getState().setManifest(getManifest());

    this.app.stage.addChild(this.worldContainer);
    this.app.stage.addChild(this.overlayContainer);

    container.appendChild(this.app.canvas);

    const rect = container.getBoundingClientRect();
    this.resize(rect.width, rect.height);

    // Set initial camera: zoom=20 (1 world unit = 20px), centered on origin
    const initialZoom = 20;
    this.worldContainer.scale.set(initialZoom);
    this.worldContainer.position.set(rect.width / 2, rect.height / 2);

    this.app.ticker.maxFPS = 60;
  }

  destroy(): void {
    if (!this.app) return;
    try {
      const canvas = this.app.canvas;
      this.app.destroy(true, { children: true, texture: true });
      canvas?.parentElement?.removeChild(canvas);
    } catch {
      // PixiJS v8 may throw if init hasn't fully completed (Strict Mode)
    }
    this.app = null;
  }

  stage(): Container {
    return this.worldContainer;
  }

  overlay(): Container {
    return this.overlayContainer;
  }

  canvas(): HTMLCanvasElement {
    if (!this.app) throw new Error('Engine not initialized');
    return this.app.canvas as HTMLCanvasElement;
  }

  render(): void {
    this.app?.render();
  }

  startRenderLoop(): void {
    if (this.app) this.app.ticker.start();
  }

  stopRenderLoop(): void {
    if (this.app) this.app.ticker.stop();
  }

  resize(width: number, height: number): void {
    if (!this.app) return;
    this.app.renderer.resize(width, height);
    this._viewport.width = width;
    this._viewport.height = height;
  }

  setResolution(dpr: number): void {
    if (!this.app) return;
    this._viewport.dpr = dpr;
    this.app.renderer.resolution = dpr;
    this.resize(this._viewport.width, this._viewport.height);
  }

  viewport(): Viewport {
    return { ...this._viewport };
  }

  setCamera(state: CameraState): void {
    this.worldContainer.position.set(state.x, state.y);
    this.worldContainer.scale.set(state.zoom);
  }

  screenToWorld(sx: number, sy: number): Point {
    const { x: cx, y: cy } = this.worldContainer.position;
    const zoom = this.worldContainer.scale.x;
    return {
      x: (sx - cx) / zoom,
      y: (sy - cy) / zoom,
    };
  }

  worldToScreen(wx: number, wy: number): Point {
    const { x: cx, y: cy } = this.worldContainer.position;
    const zoom = this.worldContainer.scale.x;
    return {
      x: wx * zoom + cx,
      y: wy * zoom + cy,
    };
  }

  createRenderTexture(width: number, height: number): RenderTexture {
    if (!this.app) throw new Error('Engine not initialized');
    return RenderTexture.create({
      width,
      height,
      resolution: this._viewport.dpr,
    });
  }

  renderToTexture(container: Container, texture: RenderTexture, clear = true): void {
    if (!this.app) throw new Error('Engine not initialized');
    this.app.renderer.render({ container, target: texture, clear });
  }

  addTickerCallback(fn: () => void): void {
    if (!this.app) throw new Error('Engine not initialized');
    this.app.ticker.add(fn);
  }

  renderer(): Renderer {
    if (!this.app) throw new Error('Engine not initialized');
    return this.app.renderer as unknown as Renderer;
  }
}
