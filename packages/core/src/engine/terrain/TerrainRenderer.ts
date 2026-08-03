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
import { readPixelsAsync, warmupReadback } from '../asyncReadback';
import {
  SPLAT_SIZE,
  TERRAIN_EXTENT_HALF,
  TERRAIN_SLOTS,
  TEXELS_PER_CELL,
  WORLD_SIZE,
  splatRegionsEqual,
} from './terrainShared';
import { SplatWorkerClient } from './splatWorkerClient';

export { SPLAT_IMAGE_KEYS, SPLAT_SIZE, TERRAIN_EXTENT_HALF, TERRAIN_SLOTS } from './terrainShared';
/** Max size for extracted palette tile textures (memory cap). */
const MAX_TILE_EXTRACT = 1024;
/** Channel tints for additive single-channel painting. */
const CHANNEL_TINTS = [0xff0000, 0x00ff00, 0x0000ff];

/**
 * Terrain bake resolution — 32 texels/cell over the 128-cell extent = 4096².
 * The splat-blend shader below is 8 samples + 6 pow() per pixel; on integrated
 * GPUs that is 60-250ms per full-screen frame. So it never runs per frame:
 * edits render it into this world-space cache (only the touched rect), and the
 * per-frame cost is one plain textured quad.
 * ponytail: fixed full-extent cache. If 32px/cell reads soft at deep zoom,
 * re-bake the visible window at higher density on zoom-settle.
 */
const BAKE_TEXELS_PER_CELL = 32;
const BAKE_SIZE = WORLD_SIZE * BAKE_TEXELS_PER_CELL;
/** Splat texel → bake texel scale. */
const BAKE_SCALE = BAKE_TEXELS_PER_CELL / TEXELS_PER_CELL;

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

/** What the meshes actually draw every frame: the baked cache, one sample per pixel. */
const DISPLAY_FRAGMENT_SRC = `
  in vec2 vUV;
  out vec4 finalColor;
  uniform sampler2D uBake;
  void main() {
    finalColor = texture(uBake, vUV);
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
  // Full weight out to ~0.8r, then a short fade. The old 0.6→0.55 ramp meant a
  // stamp only read as solid to ~0.7 of its radius, so every stroke landed
  // visibly smaller than the size the brush ring promised.
  g.addColorStop(0.8, 'rgba(255,255,255,0.9)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return Texture.from(canvas);
}

export class TerrainRenderer {
  readonly container: Container;
  private engine: RenderEngine;
  private geometry: MeshGeometry | null = null;
  private mesh: Mesh<MeshGeometry, Shader> | null = null;
  private shader: Shader | null = null;
  /**
   * Extra quads drawing the same paint over each layer's floor fill. A floor is
   * just ground with walls around it, so terrain reads across the boundary —
   * the quads are clipped to the floor union, and the base mesh below covers
   * everything else, so each painted texel still shows exactly once.
   */
  private floorMeshes: Mesh<MeshGeometry, Shader>[] = [];
  /** Allocated on first paint/restore — 32MB of VRAM maps that never paint don't need. */
  private splatRTs: [RenderTexture, RenderTexture] | null = null;
  /** World-space baked terrain (see BAKE_TEXELS_PER_CELL) — what the meshes sample per frame. */
  private bakeRT: RenderTexture | null = null;
  /** Cheap display shader on every mesh; `shader` (the heavy blend) only runs in bake passes. */
  private displayShader: Shader | null = null;
  /** Reusable scratch quad for region bakes — buffers updated in place per call. */
  private bakeGeometry: MeshGeometry | null = null;
  private bakeHolder: Container | null = null;
  private tileRTs: (RenderTexture | null)[] = new Array(TERRAIN_SLOTS).fill(null);
  private brushTexture: Texture | null = null;
  private stampSprite: Sprite | null = null;
  private stampContainer: Container | null = null;
  private strokeBackup: RenderTexture | null = null;
  private strokeDirty: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
  private loadedPaletteKey = '';
  /** Bumped per loadPalette() call so a slow load can tell it has been superseded. */
  private paletteToken = 0;
  /** Bumped per restoreFromStore() call so a slow decode can tell it has been superseded. */
  private restoreToken = 0;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  /** In-flight worker flush — save paths await it; a new flush queues behind it. */
  private flushChain: Promise<void> = Promise.resolve();
  /** True while we write terrainSplats ourselves — the store watcher skips those. */
  private ownSplatsWrite = false;
  /** Lazy — a map that never paints terrain never spawns the worker. */
  private splatWorker: SplatWorkerClient | null = null;
  private unsubscribers: (() => void)[] = [];
  private destroyed = false;

  constructor(engine: RenderEngine) {
    this.engine = engine;
    this.container = new Container();
    this.container.label = 'terrainLayer';

    this.buildMesh();
    this.watchStore();
    // Probe readback orientation now so endStroke() can issue its GPU reads
    // synchronously before the stroke backup is reused.
    try {
      warmupReadback(this.engine.renderer());
    } catch {
      // Renderer not ready — the first endStroke calibrates instead.
    }
  }

  private worker(): SplatWorkerClient {
    if (!this.splatWorker) this.splatWorker = new SplatWorkerClient();
    return this.splatWorker;
  }

  /** Allocate the splatmaps on first use and bind them to the shader. */
  private splats(): [RenderTexture, RenderTexture] {
    if (!this.splatRTs) {
      this.splatRTs = [
        RenderTexture.create({ width: SPLAT_SIZE, height: SPLAT_SIZE, resolution: 1 }),
        RenderTexture.create({ width: SPLAT_SIZE, height: SPLAT_SIZE, resolution: 1 }),
      ];
      if (this.shader) {
        this.shader.resources.uSplat0 = this.splatRTs[0].source;
        this.shader.resources.uSplat1 = this.splatRTs[1].source;
      }
    }
    return this.splatRTs;
  }

  private buildMesh(): void {
    const min = -TERRAIN_EXTENT_HALF;
    const max = TERRAIN_EXTENT_HALF;
    // One geometry and one shader for every quad — they cover the same extent
    // and read the same splatmaps; only their place in the scene differs.
    const geometry = new MeshGeometry({
      positions: new Float32Array([min, min, max, min, max, max, min, max]),
      uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    });
    this.geometry = geometry;

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
        // Empty until the first paint/restore allocates the real splatmaps —
        // sampling it yields 0 weight, so the mesh renders nothing.
        uSplat0: Texture.EMPTY.source,
        uSplat1: Texture.EMPTY.source,
        uTex0: white,
        uTex1: white,
        uTex2: white,
        uTex3: white,
        uTex4: white,
        uTex5: white,
      },
    });

    this.displayShader = Shader.from({
      gl: { vertex: VERTEX_SRC, fragment: DISPLAY_FRAGMENT_SRC },
      resources: {
        // Empty until the bake RT exists — samples to 0 alpha, renders nothing.
        uBake: Texture.EMPTY.source,
      },
    });

    this.mesh = new Mesh({ geometry, shader: this.displayShader });
    this.mesh.label = 'terrainMesh';
    this.container.addChild(this.mesh);
  }

  // ─── Bake cache ──────────────────────────────────────────

  /** Allocate the bake RT + scratch quad on first use and bind to the display shader. */
  private ensureBake(): RenderTexture {
    if (!this.bakeRT) {
      this.bakeRT = RenderTexture.create({ width: BAKE_SIZE, height: BAKE_SIZE, resolution: 1 });
      const empty = new Container();
      this.engine.renderToTexture(empty, this.bakeRT, true);
      empty.destroy();
      if (this.displayShader) this.displayShader.resources.uBake = this.bakeRT.source;

      this.bakeGeometry = new MeshGeometry({
        positions: new Float32Array(8),
        uvs: new Float32Array(8),
        indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
      });
      const bakeMesh = new Mesh({ geometry: this.bakeGeometry, shader: this.shader! });
      bakeMesh.blendMode = 'none';
      this.bakeHolder = new Container();
      this.bakeHolder.addChild(bakeMesh);
    }
    return this.bakeRT;
  }

  /**
   * Re-render the heavy splat blend into the bake cache, restricted to a splat
   * texel rect. Brush stamps pass their own small rect, so a stroke costs
   * brush-area pixels — not the screen, not the extent.
   */
  private bakeRegion(minX: number, minY: number, maxX: number, maxY: number): void {
    const x = Math.max(0, Math.floor(minX));
    const y = Math.max(0, Math.floor(minY));
    const x2 = Math.min(SPLAT_SIZE, Math.ceil(maxX));
    const y2 = Math.min(SPLAT_SIZE, Math.ceil(maxY));
    if (x2 <= x || y2 <= y) return;
    const rt = this.ensureBake();

    const positions = this.bakeGeometry!.getBuffer('aPosition');
    const uvs = this.bakeGeometry!.getBuffer('aUV');
    const p = positions.data as Float32Array;
    const u = uvs.data as Float32Array;
    const bx = x * BAKE_SCALE;
    const by = y * BAKE_SCALE;
    const bx2 = x2 * BAKE_SCALE;
    const by2 = y2 * BAKE_SCALE;
    p.set([bx, by, bx2, by, bx2, by2, bx, by2]);
    const ux = x / SPLAT_SIZE;
    const uy = y / SPLAT_SIZE;
    const ux2 = x2 / SPLAT_SIZE;
    const uy2 = y2 / SPLAT_SIZE;
    u.set([ux, uy, ux2, uy, ux2, uy2, ux, uy2]);
    positions.update();
    uvs.update();

    this.engine.renderToTexture(this.bakeHolder!, rt, false);
  }

  /** Bake the painted bounds (world units) — or clear the cache when there are none. */
  private bakeBounds(bounds: { minX: number; minY: number; maxX: number; maxY: number } | null): void {
    if (!bounds) {
      if (!this.bakeRT) return;
      const empty = new Container();
      this.engine.renderToTexture(empty, this.bakeRT, true);
      empty.destroy();
      return;
    }
    const pad = TEXELS_PER_CELL;
    this.bakeRegion(
      (bounds.minX + TERRAIN_EXTENT_HALF) * TEXELS_PER_CELL - pad,
      (bounds.minY + TERRAIN_EXTENT_HALF) * TEXELS_PER_CELL - pad,
      (bounds.maxX + TERRAIN_EXTENT_HALF) * TEXELS_PER_CELL + pad,
      (bounds.maxY + TERRAIN_EXTENT_HALF) * TEXELS_PER_CELL + pad,
    );
  }

  /**
   * A terrain quad for a layer's floor sublayer. The caller adds it above the
   * floor fill and clips it to that layer's floor union.
   *
   * A fresh Mesh per call: layer rebuilds destroy their children, and
   * Mesh.destroy() leaves the shared geometry and shader alone.
   */
  createFloorMesh(): Mesh<MeshGeometry, Shader> | null {
    if (this.destroyed || !this.geometry || !this.displayShader) return null;
    this.floorMeshes = this.floorMeshes.filter((m) => !m.destroyed);
    const mesh = new Mesh({ geometry: this.geometry, shader: this.displayShader });
    mesh.label = 'terrainFloorMesh';
    mesh.visible = this.container.visible;
    this.floorMeshes.push(mesh);
    return mesh;
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
    // Staleness is tracked by token, not by the key — the key is only recorded
    // once every slot has landed, so a failed slot is retried on the next call.
    const token = ++this.paletteToken;
    let complete = true;

    for (let slot = 0; slot < TERRAIN_SLOTS; slot++) {
      const id = palette[slot];
      if (!id) {
        // Cleared slot: drop the old tile so it stops being painted. Rebind BEFORE
        // destroying — pixi nulls a BindGroup's whole resource map when a resource it
        // still holds is destroyed, and setResource unhooks the old one first.
        if (this.shader) this.shader.resources[`uTex${slot}`] = Texture.WHITE.source;
        this.tileRTs[slot]?.destroy(true);
        this.tileRTs[slot] = null;
        continue;
      }
      try {
        if (!id.includes(':') && !textureLoader.getSync(id)) {
          await textureLoader.load(id);
        }
      } catch {
        complete = false;
        continue;
      }
      if (this.destroyed || this.paletteToken !== token) return;

      const tex = textureLoader.resolveTexture(id);
      if (tex.width <= 1) {
        complete = false;
        continue;
      }

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

      // Same order as the cleared slot above: rebind first, then release the old tile.
      const previous = this.tileRTs[slot];
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
      previous?.destroy(true);
    }

    if (complete) this.loadedPaletteKey = key;

    // New tile textures change what every painted texel looks like — refresh
    // the cache. No-ops for a map that never allocated one.
    if (this.bakeRT) {
      this.bakeBounds(useStore.getState().mapSettings.terrain?.bounds ?? null);
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
    const splats = this.splats();

    if (erase) {
      // Decay all channels on both splatmaps.
      sprite.tint = 0x000000;
      sprite.alpha = Math.min(1, strength);
      sprite.blendMode = 'normal';
      this.engine.renderToTexture(holder, splats[0], false);
      this.engine.renderToTexture(holder, splats[1], false);
    } else {
      // Soft-erase everything under the brush (both maps), then add the target channel.
      sprite.tint = 0x000000;
      sprite.alpha = Math.min(1, strength * 0.5);
      sprite.blendMode = 'normal';
      this.engine.renderToTexture(holder, splats[0], false);
      this.engine.renderToTexture(holder, splats[1], false);

      sprite.tint = CHANNEL_TINTS[slot % 3];
      sprite.alpha = Math.min(1, strength);
      sprite.blendMode = 'add';
      this.engine.renderToTexture(holder, splats[rtIndex], false);
    }

    // Track dirty texel bounds for the stroke snapshot
    const pad = texelRadius + 2;
    const d = this.strokeDirty ?? { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    d.minX = Math.min(d.minX, t.x - pad);
    d.minY = Math.min(d.minY, t.y - pad);
    d.maxX = Math.max(d.maxX, t.x + pad);
    d.maxY = Math.max(d.maxY, t.y + pad);
    this.strokeDirty = d;

    // Live feedback: refresh the bake cache under the stamp only.
    this.bakeRegion(t.x - pad, t.y - pad, t.x + pad, t.y + pad);
  }

  /**
   * Snapshot the stroke's dirty region from backup (before) and live (after)
   * RTs. All four GPU reads are *issued* synchronously here (so the backup RT
   * can be safely reused by the next stroke); only the copy-back is awaited.
   */
  async endStroke(): Promise<StrokeRegionSnapshot[]> {
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

    // Issue every read before awaiting any of them.
    const reads: Promise<Uint8Array>[] = [];
    for (const rtIndex of [0, 1] as const) {
      // "before" pixels come from the backup copied at beginStroke —
      // the backup is double-height: rt0 at y=0, rt1 at y=SPLAT_SIZE.
      const backupFrame = new Rectangle(x, y + rtIndex * SPLAT_SIZE, width, height);
      reads.push(this.extractRegion(this.strokeBackup!, backupFrame));
      reads.push(this.extractRegion(this.splats()[rtIndex], frame));
    }
    const [before0, after0, before1, after1] = await Promise.all(reads);
    if (this.destroyed) return [];

    const snapshots: StrokeRegionSnapshot[] = [];
    const pairs: [0 | 1, Uint8Array, Uint8Array][] = [
      [0, before0, after0],
      [1, before1, after1],
    ];
    for (const [rtIndex, before, after] of pairs) {
      if (!splatRegionsEqual(before, after)) {
        snapshots.push({ rtIndex, rect, before, after });
        this.worker().patch(rtIndex, rect, after);
      }
    }

    // Scheduled only after the patches are posted — the worker's message queue
    // then guarantees the flush sees them.
    if (snapshots.length > 0) this.schedulePersist();
    return snapshots;
  }

  /**
   * Backup handling: beginStroke() is called before any stamp, so we copy BOTH
   * splat RTs into a single double-height backup (top = rt0, bottom = rt1).
   */
  copyToBackup(): void {
    if (!this.strokeBackup) {
      this.strokeBackup = RenderTexture.create({ width: SPLAT_SIZE, height: SPLAT_SIZE * 2, resolution: 1 });
    }
    const splats = this.splats();
    const holder = new Container();
    const s0 = new Sprite(splats[0]);
    s0.blendMode = 'none';
    const s1 = new Sprite(splats[1]);
    s1.position.set(0, SPLAT_SIZE);
    s1.blendMode = 'none';
    holder.addChild(s0, s1);
    this.engine.renderToTexture(holder, this.strokeBackup, true);
    holder.destroy({ children: true });
  }

  /**
   * Read back an RT region without stalling the GPU pipeline. extract.pixels'
   * `frame` option is unreliable for RenderTextures, so blit the region into
   * a small temp RT first; the blit and the readback *issue* are synchronous,
   * the wait for the bytes is not.
   */
  private async extractRegion(rt: RenderTexture, frame: Rectangle): Promise<Uint8Array> {
    const temp = RenderTexture.create({ width: frame.width, height: frame.height, resolution: 1 });
    const regionTex = new Texture({ source: rt.source, frame });
    const sprite = new Sprite(regionTex);
    sprite.blendMode = 'none';
    const holder = new Container();
    holder.addChild(sprite);
    this.engine.renderToTexture(holder, temp, true);
    holder.destroy({ children: true });
    regionTex.destroy();
    try {
      return await readPixelsAsync(this.engine.renderer(), temp, frame.width, frame.height);
    } finally {
      temp.destroy(true);
    }
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
    this.engine.renderToTexture(holder, this.splats()[rtIndex], false);
    holder.destroy({ children: true });
    texture.destroy(true);
    this.bakeRegion(rect.x, rect.y, rect.x + rect.width, rect.y + rect.height);
    // Undo/redo already has the pixels — mirror them into the worker copy.
    this.worker().patch(rtIndex, rect, pixels);
    this.schedulePersist();
  }

  /** Cancel an in-flight stroke: restore both splat RTs from the backup. */
  cancelStroke(): void {
    if (!this.strokeBackup) return;
    const d = this.strokeDirty;
    for (const rtIndex of [0, 1] as const) {
      const frame = new Rectangle(0, rtIndex * SPLAT_SIZE, SPLAT_SIZE, SPLAT_SIZE);
      const tex = new Texture({ source: this.strokeBackup.source, frame });
      const sprite = new Sprite(tex);
      sprite.blendMode = 'none';
      const holder = new Container();
      holder.addChild(sprite);
      this.engine.renderToTexture(holder, this.splats()[rtIndex], true);
      holder.destroy({ children: true });
      tex.destroy();
    }
    // Un-paint the cancelled stamps from the bake cache too.
    if (d) this.bakeRegion(d.minX, d.minY, d.maxX, d.maxY);
    this.strokeDirty = null;
  }

  // ─── Persistence ─────────────────────────────────────────

  /**
   * Debounced: flush the worker's splat copy — bounds scan and PNG encode
   * both happen in the worker; the main thread only posts a message and
   * stores the resulting Blobs.
   */
  schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.flushChain = this.flushChain.then(() => this.flushPersist());
    }, 1200);
  }

  /**
   * Save paths call this to get an up-to-date store before serializing:
   * cancels the pending debounce and awaits any in-flight flush.
   */
  flushPersistNow(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
      this.flushChain = this.flushChain.then(() => this.flushPersist());
    }
    return this.flushChain;
  }

  private async flushPersist(): Promise<void> {
    if (this.destroyed || !this.splatWorker) return;
    try {
      const { bounds, pngs } = await this.splatWorker.flush();
      if (this.destroyed) return;
      const store = useStore.getState();
      store.setTerrainData({ bounds });
      if (pngs.length > 0) {
        const next = [...store.terrainSplats.pngs] as [Blob | null, Blob | null];
        for (const { rtIndex, png } of pngs) {
          next[rtIndex] = new Blob([png], { type: 'image/png' });
        }
        this.ownSplatsWrite = true;
        try {
          store.setTerrainSplats(next);
        } finally {
          this.ownSplatsWrite = false;
        }
      }
    } catch (err) {
      console.error('[terrain] splatmap persist failed:', err);
    }
  }

  /** Blit loaded splat PNGs into the splat RTs and seed the worker (map load / switch). */
  private async restoreFromStore(pngs: [Blob | null, Blob | null]): Promise<void> {
    // An incoming bitmap supersedes anything we were about to write back, and
    // any earlier restore still waiting on decode.
    const token = ++this.restoreToken;
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }

    // Seed the worker's canonical copy (it decodes the PNG itself, off-thread).
    // Skipped entirely for a blank map that never spawned the worker.
    if (this.splatWorker || pngs.some(Boolean)) {
      const w = this.worker();
      for (const rtIndex of [0, 1] as const) {
        const blob = pngs[rtIndex];
        void (blob ? blob.arrayBuffer().then((buf) => w.seed(rtIndex, buf)) : w.seed(rtIndex, null));
      }
    }

    for (const rtIndex of [0, 1] as const) {
      const blob = pngs[rtIndex];
      if (!blob) {
        if (!this.splatRTs) continue; // nothing allocated = already blank
        const empty = new Container();
        this.engine.renderToTexture(empty, this.splatRTs[rtIndex], true);
        empty.destroy();
        continue;
      }
      try {
        // createImageBitmap decodes off the main thread.
        const bitmap = await createImageBitmap(blob);
        if (this.destroyed || this.restoreToken !== token) {
          bitmap.close();
          return;
        }
        const tex = Texture.from(bitmap);
        const sprite = new Sprite(tex);
        sprite.width = SPLAT_SIZE;
        sprite.height = SPLAT_SIZE;
        sprite.blendMode = 'none';
        const holder = new Container();
        holder.addChild(sprite);
        this.engine.renderToTexture(holder, this.splats()[rtIndex], true);
        holder.destroy({ children: true });
        tex.destroy(true);
      } catch (err) {
        this.fail('splatmap restore', err);
      }
    }

    // Loaded splats → bake cache. Bounds landed in the same store pass as the
    // blobs, so this covers exactly the painted area (or clears a blank map).
    if (pngs.some(Boolean)) {
      const bounds = useStore.getState().mapSettings.terrain?.bounds;
      // Pre-bounds save: no recorded bounds but real paint — bake everything once.
      if (bounds) this.bakeBounds(bounds);
      else this.bakeRegion(0, 0, SPLAT_SIZE, SPLAT_SIZE);
    } else {
      this.bakeBounds(null);
    }
  }

  /**
   * Terrain is the one layer with a hand-written shader, so it is the one that can leave a
   * dead resource bound and take every later frame down with it. Failing costs the ground
   * layer and one log line instead of the whole canvas — pixi skips a hidden subtree.
   */
  private fail(what: string, err: unknown): void {
    this.container.visible = false;
    // The floor quads sit in layer containers, outside this subtree.
    for (const mesh of this.floorMeshes) if (!mesh.destroyed) mesh.visible = false;
    console.error(`[terrain] ${what} failed — terrain layer hidden:`, err);
  }

  // ─── Store subscriptions ─────────────────────────────────

  private watchStore(): void {
    // Splat bitmap changes from outside (map load/switch/new map)
    const unsubSplats = useStore.subscribe(
      (s) => s.terrainSplats.rev,
      () => {
        if (this.ownSplatsWrite) return; // our own persist write
        const pngs = useStore.getState().terrainSplats.pngs;
        // Fire-and-forget: an unhandled rejection here reaches no boundary (the hosts'
        // try/catch around loadFromFile is long gone by the time it settles).
        this.restoreFromStore(pngs).catch((err) => this.fail('splatmap restore', err));
      },
      { fireImmediately: true },
    );
    this.unsubscribers.push(unsubSplats);

    // Palette changes → reload tile textures
    const unsubPalette = useStore.subscribe(
      (s) => s.mapSettings.terrain?.palette?.join('|') ?? DEFAULT_TERRAIN_PALETTE.join('|'),
      () => void this.loadPalette().catch((err) => this.fail('palette load', err)),
      { fireImmediately: true },
    );
    this.unsubscribers.push(unsubPalette);
  }

  destroy(): void {
    this.destroyed = true;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.splatWorker?.destroy();
    this.splatWorker = null;
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];
    // Floor quads live in layer containers, which can outlive this renderer —
    // drop them before their shader goes, or the next frame renders a dead one.
    for (const mesh of this.floorMeshes) {
      if (mesh.destroyed) continue;
      mesh.parent?.removeChild(mesh);
      mesh.destroy();
    }
    this.floorMeshes = [];
    // Mesh.destroy() only nulls its geometry/shader refs — the GPU buffers and
    // the compiled shader survive unless they're destroyed explicitly.
    this.container.destroy({ children: true });
    this.bakeHolder?.destroy({ children: true });
    this.bakeHolder = null;
    // Mesh.destroy() leaves its geometry alone — free the scratch quad explicitly.
    this.bakeGeometry?.destroy();
    this.bakeGeometry = null;
    this.geometry?.destroy();
    this.shader?.destroy();
    this.displayShader?.destroy();
    this.displayShader = null;
    this.geometry = null;
    this.mesh = null;
    this.shader = null;
    this.splatRTs?.[0].destroy(true);
    this.splatRTs?.[1].destroy(true);
    this.splatRTs = null;
    this.bakeRT?.destroy(true);
    this.bakeRT = null;
    this.strokeBackup?.destroy(true);
    this.strokeBackup = null;
    for (const rt of this.tileRTs) rt?.destroy(true);
    this.tileRTs.fill(null);
    this.brushTexture?.destroy(true);
    this.brushTexture = null;
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
