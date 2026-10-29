import type { Container, Renderer, RenderTexture, Ticker } from 'pixi.js';
import type { Point, Viewport } from '../types/geometry';

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

export interface RenderEngine {
  /** `useBackBuffer`: draw through a back buffer so advanced blend modes (the table's greyscale darkvision) work on WebGL. */
  init(container: HTMLDivElement, options?: { useBackBuffer?: boolean }): Promise<void>;
  destroy(): void;
  stage(): Container;
  overlay(): Container;
  canvas(): HTMLCanvasElement;
  render(): void;
  startRenderLoop(): void;
  stopRenderLoop(): void;
  resize(width: number, height: number): void;
  setResolution(dpr: number): void;
  viewport(): Viewport;
  setCamera(state: CameraState): void;
  screenToWorld(sx: number, sy: number): Point;
  worldToScreen(wx: number, wy: number): Point;
  /**
   * An offscreen target of `width`x`height` logical pixels. `resolution` defaults to the
   * screen's DPR, which suits the passes that stand in for the canvas. A file (the export,
   * map thumbnails) passes 1, so the texture holds exactly the pixels it will write.
   */
  createRenderTexture(width: number, height: number, resolution?: number): RenderTexture;
  renderToTexture(container: Container, texture: RenderTexture, clear?: boolean): void;
  addTickerCallback(fn: () => void): void;
  ticker(): Ticker;
  renderer(): Renderer;
}
