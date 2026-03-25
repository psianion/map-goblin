import type { Container, Renderer, RenderTexture, Ticker } from 'pixi.js';
import type { Point, Viewport } from '@/types/geometry';

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

export interface RenderEngine {
  init(container: HTMLDivElement): Promise<void>;
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
  createRenderTexture(width: number, height: number): RenderTexture;
  renderToTexture(container: Container, texture: RenderTexture, clear?: boolean): void;
  addTickerCallback(fn: () => void): void;
  ticker(): Ticker;
  renderer(): Renderer;
}
