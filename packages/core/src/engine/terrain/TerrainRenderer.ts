import {
  BufferImageSource,
  Container,
  Mesh,
  MeshGeometry,
  Rectangle,
  RenderTexture,
  Shader,
  Sprite,
  Texture,
} from 'pixi.js';
import type { RenderEngine } from '../RenderEngine';
import { useStore } from '../../store/store';
import { DEFAULT_TERRAIN_PALETTE } from '../../store/slices/mapSettings';
import * as textureLoader from '../../assets/textureLoader';
import { getTextureEntry } from '../../assets/textureManifest';

/** Half-extent of the paintable terrain region in world units (grid cells). */
export const TERRAIN_EXTENT_HALF = 64;
/** Splatmap resolution — 2048 texels over 128 cells = 16 texels/cell. */
export const SPLAT_SIZE = 2048;
/** Number of paintable terrain slots (2 splatmaps × RGB channels). */
export const TERRAIN_SLOTS = 6;

/** customImages keys the splat bitmaps persist under (ride the existing save/embed pipeline). */
export const SPLAT_IMAGE_KEYS = ['__terrain-splat-0__', '__terrain-splat-1__'] as const;

const WORLD_SIZE = TERRAIN_EXTENT_HALF * 2;
const TEXELS_PER_CELL = SPLAT_SIZE / WORLD_SIZE;
/** Max size for extracted palette tile textures (memory cap). */
const MAX_TILE_EXTRACT = 1024;
/** Channel tints for additive single-channel painting. */
const CHANNEL_TINTS = [0xff0000, 0x00ff00, 0x0000ff];

const VERTEX_SRC = `
  in vec2 aPosition;
  in vec2 aUV;
  out vec2 vUV;
  uniform mat3 uProjectionMatrix;
  uniform mat3 uWorldTransformMatrix;
  uniform mat3 uTransformMatrix;
  void main() {
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
    vUV = aUV;
  }
`;

// Dungeondraft-style splat blending: per-slot weights from the splatmap
// channels, sharpened by per-pixel texture luminance (pseudo-height) so
// boundaries interlock naturally instead of crossfading.
const FRAGMENT_SRC = `
  in vec2 vUV;
  out vec4 finalColor;
  uniform sampler2D uSplat0;
  uniform sampler2D uSplat1;
  uniform sampler2D uTex0;
  uniform sampler2D uTex1;
  uniform sampler2D uTex2;
  uniform sampler2D uTex3;
  uniform sampler2D uTex4;
  uniform sampler2D uTex5;
  uniform vec2 uExtentMin;
  uniform float uExtentSize;
  uniform vec2 uTile0;
  uniform vec2 uTile1;
  uniform vec2 uTile2;
  uniform vec2 uTile3;
  uniform vec2 uTile4;
  uniform vec2 uTile5;

  float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  void main() {
    vec3 s0 = texture(uSplat0, vUV).rgb;
    vec3 s1 = texture(uSplat1, vUV).rgb;
    float raw = s0.r + s0.g + s0.b + s1.r + s1.g + s1.b;
    if (raw < 0.004) {
      finalColor = vec4(0.0);
      return;
    }
    vec2 wp = uExtentMin + vUV * uExtentSize;
    vec3 c0 = texture(uTex0, fract(wp / uTile0)).rgb;
    vec3 c1 = texture(uTex1, fract(wp / uTile1)).rgb;
    vec3 c2 = texture(uTex2, fract(wp / uTile2)).rgb;
    vec3 c3 = texture(uTex3, fract(wp / uTile3)).rgb;
    vec3 c4 = texture(uTex4, fract(wp / uTile4)).rgb;
    vec3 c5 = texture(uTex5, fract(wp / uTile5)).rgb;

    float e = 0.35;
    float w0 = pow(s0.r * (e + lum(c0)), 3.0);
    float w1 = pow(s0.g * (e + lum(c1)), 3.0);
    float w2 = pow(s0.b * (e + lum(c2)), 3.0);
    float w3 = pow(s1.r * (e + lum(c3)), 3.0);
    float w4 = pow(s1.g * (e + lum(c4)), 3.0);
    float w5 = pow(s1.b * (e + lum(c5)), 3.0);
    float sum = w0 + w1 + w2 + w3 + w4 + w5 + 1e-6;

    vec3 col = (c0 * w0 + c1 * w1 + c2 * w2 + c3 * w3 + c4 * w4 + c5 * w5) / sum;
    float alpha = clamp(raw * 2.5, 0.0, 1.0);
    finalColor = vec4(col * alpha, alpha);
  }
`;

export interface StrokeRegionSnapshot {
  rtIndex: 0 | 1;
  rect: { x: number; y: number; width: number; height: number };
  before: Uint8Array;
  after: Uint8Array;
}

/** Create a soft radial brush texture (white core → transparent edge). */
function createBrushTexture(): Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.15, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return Texture.from(canvas);
}

export class TerrainRenderer {
  readonly container: Container;
  private engine: RenderEngine;
  private mesh: Mesh<MeshGeometry, Shader> | null = null;
  private shader: Shader | null = null;
  private splatRTs: [RenderTexture, RenderTexture];
  private tileRTs: (RenderTexture | null)[] = new Array(TERRAIN_SLOTS).fill(null);
  private brushTexture: Texture | null = null;
  private stampSprite: Sprite | null = null;
  private stampContainer: Container | null = null;
  private strokeBackup: RenderTexture | null = null;
  private strokeDirty: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
  private loadedPaletteKey = '';
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  /** Data URLs we wrote to the store — used to tell our own writes from map loads. */
  private lastPersisted: (string | null)[] = [null, null];
  private unsubscribers: (() => void)[] = [];
  private destroyed = false;

  constructor(engine: RenderEngine) {
    this.engine = engine;
    this.container = new Container();
    this.container.label = 'terrainLayer';

    this.splatRTs = [
      RenderTexture.create({ width: SPLAT_SIZE, height: SPLAT_SIZE, resolution: 1 }),
      RenderTexture.create({ width: SPLAT_SIZE, height: SPLAT_SIZE, resolution: 1 }),
    ];

    this.buildMesh();
    this.watchStore();
  }

  private buildMesh(): void {
    const min = -TERRAIN_EXTENT_HALF;
    const max = TERRAIN_EXTENT_HALF;
    const geometry = new MeshGeometry({
      positions: new Float32Array([min, min, max, min, max, max, min, max]),
      uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    });

    const white = Texture.WHITE.source;
    const tiles: Record<string, { value: Float32Array; type: string }> = {};
    for (let i = 0; i < TERRAIN_SLOTS; i++) {
      tiles[`uTile${i}`] = { value: new Float32Array([1, 1]), type: 'vec2<f32>' };
    }

    this.shader = Shader.from({
      gl: { vertex: VERTEX_SRC, fragment: FRAGMENT_SRC },
      resources: {
        terrainUniforms: {
          uExtentMin: { value: new Float32Array([min, min]), type: 'vec2<f32>' },
          uExtentSize: { value: WORLD_SIZE, type: 'f32' },
          ...tiles,
        },
        uSplat0: this.splatRTs[0].source,
        uSplat1: this.splatRTs[1].source,
        uTex0: white,
        uTex1: white,
        uTex2: white,
        uTex3: white,
        uTex4: white,
        uTex5: white,
      },
    });

    this.mesh = new Mesh({ geometry, shader: this.shader });
    this.mesh.label = 'terrainMesh';
    this.container.addChild(this.mesh);
  }

  // ─── Palette ─────────────────────────────────────────────

  getPalette(): (string | null)[] {
    const stored = useStore.getState().mapSettings.terrain?.palette;
    const palette = stored ?? DEFAULT_TERRAIN_PALETTE;
    const out = palette.slice(0, TERRAIN_SLOTS);
    while (out.length < TERRAIN_SLOTS) out.push(null);
    return out;
  }

  /** Load palette textures and extract each into a standalone repeat-tileable RT. */
  async loadPalette(): Promise<void> {
    const palette = this.getPalette();
    const key = palette.join('|');
    if (key === this.loadedPaletteKey) return;
    this.loadedPaletteKey = key;

    for (let slot = 0; slot < TERRAIN_SLOTS; slot++) {
      const id = palette[slot];
      if (!id) continue;
      try {
        if (!id.includes(':') && !textureLoader.getSync(id)) {
          await textureLoader.load(id);
        }
      } catch {
        continue;
      }
      if (this.destroyed || this.loadedPaletteKey !== key) return;

      const tex = textureLoader.resolveTexture(id);
      if (tex.width <= 1) continue;

      const w = Math.min(tex.width, MAX_TILE_EXTRACT);
      const h = Math.min(tex.height, MAX_TILE_EXTRACT);
      const rt = RenderTexture.create({ width: w, height: h, resolution: 1 });
      const sprite = new Sprite(tex);
      sprite.width = w;
      sprite.height = h;
      const holder = new Container();
      holder.addChild(sprite);
      this.engine.renderToTexture(holder, rt, true);
      holder.destroy({ children: true });

      this.tileRTs[slot]?.destroy(true);
      this.tileRTs[slot] = rt;

      if (this.shader) {
        this.shader.resources[`uTex${slot}`] = rt.source;
        // Tile size in world units: natural texture pixels / 200 px-per-cell.
        const entry = getTextureEntry(id);
        const naturalW = entry?.naturalWidth ?? tex.width;
        const naturalH = entry?.naturalHeight ?? tex.height;
        const tile = this.shader.resources.terrainUniforms.uniforms[`uTile${slot}`] as Float32Array;
        tile[0] = naturalW / 200;
        tile[1] = naturalH / 200;
      }
    }
  }

  // ─── Painting ────────────────────────────────────────────

  private ensureStampObjects(): void {
    if (!this.brushTexture) this.brushTexture = createBrushTexture();
    if (!this.stampSprite) {
      this.stampSprite = new Sprite(this.brushTexture);
      this.stampSprite.anchor.set(0.5);
      this.stampContainer = new Container();
      this.stampContainer.addChild(this.stampSprite);
    }
  }

  private worldToTexel(wx: number, wy: number): { x: number; y: number } {
    return {
      x: (wx + TERRAIN_EXTENT_HALF) * TEXELS_PER_CELL,
      y: (wy + TERRAIN_EXTENT_HALF) * TEXELS_PER_CELL,
    };
  }

  /** Call before the first stamp of a stroke: snapshots both splat RTs for undo/cancel. */
  beginStroke(): void {
    this.copyToBackup();
    this.strokeDirty = null;
  }

  /**
   * Stamp the brush once. Painting a slot additively raises that channel while a
   * weaker normal-blend black stamp decays the others, so repainting replaces.
   * Erase stamps only the black (all channels decay).
   */
  paintStamp(wx: number, wy: number, radius: number, strength: number, slot: number, erase: boolean): void {
    if (Math.abs(wx) > TERRAIN_EXTENT_HALF + radius || Math.abs(wy) > TERRAIN_EXTENT_HALF + radius) return;
    this.ensureStampObjects();
    const sprite = this.stampSprite!;
    const holder = this.stampContainer!;

    const t = this.worldToTexel(wx, wy);
    const texelRadius = radius * TEXELS_PER_CELL;
    sprite.position.set(t.x, t.y);
    sprite.width = texelRadius * 2;
    sprite.height = texelRadius * 2;

    const rtIndex = (erase ? 0 : Math.floor(slot / 3)) as 0 | 1;

    if (erase) {
      // Decay all channels on both splatmaps.
      sprite.tint = 0x000000;
      sprite.alpha = Math.min(1, strength);
      sprite.blendMode = 'normal';
      this.engine.renderToTexture(holder, this.splatRTs[0], false);
      this.engine.renderToTexture(holder, this.splatRTs[1], false);
    } else {
      // Soft-erase everything under the brush (both maps), then add the target channel.
      sprite.tint = 0x000000;
      sprite.alpha = Math.min(1, strength * 0.5);
      sprite.blendMode = 'normal';
      this.engine.renderToTexture(holder, this.splatRTs[0], false);
      this.engine.renderToTexture(holder, this.splatRTs[1], false);

      sprite.tint = CHANNEL_TINTS[slot % 3];
      sprite.alpha = Math.min(1, strength);
      sprite.blendMode = 'add';
      this.engine.renderToTexture(holder, this.splatRTs[rtIndex], false);
    }

    // Track dirty texel bounds for the stroke snapshot
    const pad = texelRadius + 2;
    const d = this.strokeDirty ?? { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    d.minX = Math.min(d.minX, t.x - pad);
    d.minY = Math.min(d.minY, t.y - pad);
    d.maxX = Math.max(d.maxX, t.x + pad);
    d.maxY = Math.max(d.maxY, t.y + pad);
    this.strokeDirty = d;
  }

  /** Snapshot the stroke's dirty region from backup (before) and live (after) RTs. */
  endStroke(): StrokeRegionSnapshot[] {
    const d = this.strokeDirty;
    this.strokeDirty = null;
    if (!d) return [];

    const x = Math.max(0, Math.floor(d.minX));
    const y = Math.max(0, Math.floor(d.minY));
    const x2 = Math.min(SPLAT_SIZE, Math.ceil(d.maxX));
    const y2 = Math.min(SPLAT_SIZE, Math.ceil(d.maxY));
    const width = x2 - x;
    const height = y2 - y;
    if (width <= 0 || height <= 0) return [];

    const rect = { x, y, width, height };
    const frame = new Rectangle(x, y, width, height);
    const snapshots: StrokeRegionSnapshot[] = [];

    for (const rtIndex of [0, 1] as const) {
      // "before" pixels come from the backup copied at beginStroke —
      // the backup is double-height: rt0 at y=0, rt1 at y=SPLAT_SIZE.
      const backupFrame = new Rectangle(x, y + rtIndex * SPLAT_SIZE, width, height);
      const before = this.extractRegion(this.strokeBackup!, backupFrame);
      const after = this.extractRegion(this.splatRTs[rtIndex], frame);
      if (!this.regionsEqual(before, after)) {
        snapshots.push({ rtIndex, rect, before, after });
      }
    }

    // Update painted world bounds (for export)
    this.growPaintedBounds(x, y, x2, y2);
    this.schedulePersist();
    return snapshots;
  }

  /**
   * Backup handling: beginStroke() is called before any stamp, so we copy BOTH
   * splat RTs into a single double-height backup (top = rt0, bottom = rt1).
   */
  private backupValid = false;

  copyToBackup(): void {
    if (!this.strokeBackup) {
      this.strokeBackup = RenderTexture.create({ width: SPLAT_SIZE, height: SPLAT_SIZE * 2, resolution: 1 });
    }
    const holder = new Container();
    const s0 = new Sprite(this.splatRTs[0]);
    s0.blendMode = 'none';
    const s1 = new Sprite(this.splatRTs[1]);
    s1.position.set(0, SPLAT_SIZE);
    s1.blendMode = 'none';
    holder.addChild(s0, s1);
    this.engine.renderToTexture(holder, this.strokeBackup, true);
    holder.destroy({ children: true });
    this.backupValid = true;
  }

  /**
   * Read back an RT region. extract.pixels' `frame` option is unreliable for
   * RenderTextures, so blit the region into a small temp RT and extract that.
   */
  private extractRegion(rt: RenderTexture, frame: Rectangle): Uint8Array {
    const temp = RenderTexture.create({ width: frame.width, height: frame.height, resolution: 1 });
    const regionTex = new Texture({ source: rt.source, frame });
    const sprite = new Sprite(regionTex);
    sprite.blendMode = 'none';
    const holder = new Container();
    holder.addChild(sprite);
    this.engine.renderToTexture(holder, temp, true);
    holder.destroy({ children: true });
    regionTex.destroy();
    const { pixels, width, height } = this.engine.renderer().extract.pixels({ target: temp });
    temp.destroy(true);
    const out = new Uint8Array(width * height * 4);
    out.set(pixels.subarray(0, out.length));
    return out;
  }

  private regionsEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  /** Write raw RGBA pixels back into a splatmap region (undo/redo restore). */
  restoreRegion(rtIndex: 0 | 1, rect: { x: number; y: number; width: number; height: number }, pixels: Uint8Array): void {
    const source = new BufferImageSource({
      resource: pixels,
      width: rect.width,
      height: rect.height,
      alphaMode: 'premultiplied-alpha',
    });
    const texture = new Texture({ source });
    const sprite = new Sprite(texture);
    sprite.position.set(rect.x, rect.y);
    sprite.blendMode = 'none';
    const holder = new Container();
    holder.addChild(sprite);
    this.engine.renderToTexture(holder, this.splatRTs[rtIndex], false);
    holder.destroy({ children: true });
    texture.destroy(true);
    this.schedulePersist();
  }

  /** Cancel an in-flight stroke: restore both splat RTs from the backup. */
  cancelStroke(): void {
    if (!this.strokeBackup || !this.backupValid) return;
    for (const rtIndex of [0, 1] as const) {
      const frame = new Rectangle(0, rtIndex * SPLAT_SIZE, SPLAT_SIZE, SPLAT_SIZE);
      const tex = new Texture({ source: this.strokeBackup.source, frame });
      const sprite = new Sprite(tex);
      sprite.blendMode = 'none';
      const holder = new Container();
      holder.addChild(sprite);
      this.engine.renderToTexture(holder, this.splatRTs[rtIndex], true);
      holder.destroy({ children: true });
      tex.destroy();
    }
    this.strokeDirty = null;
  }

  private growPaintedBounds(tx: number, ty: number, tx2: number, ty2: number): void {
    const toWorld = (t: number) => t / TEXELS_PER_CELL - TERRAIN_EXTENT_HALF;
    const store = useStore.getState();
    const prev = store.mapSettings.terrain?.bounds ?? null;
    const next = {
      minX: Math.min(prev?.minX ?? Infinity, toWorld(tx)),
      minY: Math.min(prev?.minY ?? Infinity, toWorld(ty)),
      maxX: Math.max(prev?.maxX ?? -Infinity, toWorld(tx2)),
      maxY: Math.max(prev?.maxY ?? -Infinity, toWorld(ty2)),
    };
    store.setTerrainData({ bounds: next });
  }

  // ─── Persistence ─────────────────────────────────────────

  /** Debounced: encode splat RTs to PNG data URLs into assets.customImages. */
  schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.persistNow();
    }, 1200);
  }

  private async persistNow(): Promise<void> {
    if (this.destroyed) return;
    const store = useStore.getState();
    for (const rtIndex of [0, 1] as const) {
      try {
        const url = await this.engine.renderer().extract.base64({
          target: this.splatRTs[rtIndex],
          format: 'png',
        });
        if (this.destroyed) return;
        this.lastPersisted[rtIndex] = url;
        store.addCustomImage(SPLAT_IMAGE_KEYS[rtIndex], url);
      } catch (err) {
        console.error('[terrain] splatmap persist failed:', err);
      }
    }
    // Ensure palette metadata exists once terrain has been painted
    if (!store.mapSettings.terrain) {
      store.setTerrainData({});
    }
  }

  /** Blit a loaded splat image into a splat RT (map load / restore). */
  private async restoreFromDataUrl(rtIndex: 0 | 1, url: string | null): Promise<void> {
    if (!url) {
      const empty = new Container();
      this.engine.renderToTexture(empty, this.splatRTs[rtIndex], true);
      empty.destroy();
      return;
    }
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      if (this.destroyed) return;
      const tex = Texture.from(img);
      const sprite = new Sprite(tex);
      sprite.width = SPLAT_SIZE;
      sprite.height = SPLAT_SIZE;
      sprite.blendMode = 'none';
      const holder = new Container();
      holder.addChild(sprite);
      this.engine.renderToTexture(holder, this.splatRTs[rtIndex], true);
      holder.destroy({ children: true });
      tex.destroy(true);
    } catch (err) {
      console.error('[terrain] splatmap restore failed:', err);
    }
  }

  // ─── Store subscriptions ─────────────────────────────────

  private watchStore(): void {
    // Splat bitmap changes from outside (map load/switch/new map)
    for (const rtIndex of [0, 1] as const) {
      const unsub = useStore.subscribe(
        (s) => s.assets.customImages[SPLAT_IMAGE_KEYS[rtIndex]] ?? null,
        (url) => {
          if (url === this.lastPersisted[rtIndex]) return; // our own write
          this.lastPersisted[rtIndex] = url;
          void this.restoreFromDataUrl(rtIndex, url);
        },
        { fireImmediately: true },
      );
      this.unsubscribers.push(unsub);
    }

    // Palette changes → reload tile textures
    const unsubPalette = useStore.subscribe(
      (s) => s.mapSettings.terrain?.palette?.join('|') ?? DEFAULT_TERRAIN_PALETTE.join('|'),
      () => void this.loadPalette(),
      { fireImmediately: true },
    );
    this.unsubscribers.push(unsubPalette);
  }

  destroy(): void {
    this.destroyed = true;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];
    this.container.destroy({ children: true });
    this.splatRTs[0].destroy(true);
    this.splatRTs[1].destroy(true);
    this.strokeBackup?.destroy(true);
    for (const rt of this.tileRTs) rt?.destroy(true);
    this.brushTexture?.destroy(true);
  }
}

// ─── Module singleton (mirrors getLayerEntries pattern) ────
let _terrainRenderer: TerrainRenderer | null = null;

export function setTerrainRenderer(r: TerrainRenderer | null): void {
  _terrainRenderer = r;
}

export function getTerrainRenderer(): TerrainRenderer | null {
  return _terrainRenderer;
}
