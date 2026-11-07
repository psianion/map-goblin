import { Container, Graphics } from 'pixi.js';
import type { DrawingTool, PreviewShape } from './DrawingTool';
import type { Point } from '../../types/geometry';
import type { RenderEngine } from '../RenderEngine';
import type { DungeonLayer } from '../../store/types';
import { useStore } from '../../store/store';
import { isLayerShown } from '../../store/selectors';
import { undoManager } from '../../store/undoManager';
import { getTerrainRenderer, TERRAIN_EXTENT_HALF } from '../terrain/TerrainRenderer';
import { TerrainStrokeCommand } from '../terrain/terrainCommands';
import { drawTerrainBrushDisc } from '../terrain/terrainBrushPreview';
import { depositForTick, floorRegionAt } from '../terrain/terrainShared';
import { notify } from '../../shared/notify';
import { TERRAIN_BRUSH_RANGES } from '../../store/slices/tools';

/** Stamp spacing along a drag, as a fraction of brush radius. */
const STAMP_SPACING = 0.35;
/** The longest tick counted, in seconds: a stalled frame never dumps a burst of paint. */
const MAX_TICK = 0.25;

type Renderer = NonNullable<ReturnType<typeof getTerrainRenderer>>;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const nextFrame = (fn: () => void): number =>
  typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : (setTimeout(fn, 16) as unknown as number);
const cancelFrame = (id: number): void => {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
  else clearTimeout(id);
};

/** The layer floors under `p` are looked for on: the active layer first, then the shown layers top down. */
function fillLayers(): DungeonLayer[] {
  const state = useStore.getState();
  const shown = state.layers.filter((l): l is DungeonLayer => l.type === 'dungeon' && isLayerShown(state, l)).reverse();
  const active = shown.find((l) => l.id === state.ui.activeLayerId);
  return active ? [active, ...shown.filter((l) => l !== active)] : shown;
}

export class TerrainTool implements DrawingTool {
  readonly type = 'terrain' as const;
  readonly cursor = 'crosshair';

  private engine: RenderEngine;
  private brushCircle: Graphics;
  private painting = false;
  /** Where the last stamp landed, and where the pointer is now. */
  private lastStamp: Point | null = null;
  private pointer: Point | null = null;
  /**
   * Settings captured at stroke start, so a whole stroke paints with one
   * radius/slot/tint even if the popover changes mid-drag — and the stroke
   * keeps the tint it began with, the way a placed light keeps its colour.
   */
  private stroke: { radius: number; intensity: number; slot: number; tint: number; tintOpacity: number; erase: boolean } | null = null;
  /** The held brush's clock: paint not laid yet, the last tick's time, the next tick. */
  private pending = 0;
  private tickAt = 0;
  private frame: number | null = null;

  constructor(engine: RenderEngine, previewContainer: Container) {
    this.engine = engine;
    this.brushCircle = new Graphics();
    previewContainer.addChild(this.brushCircle);
  }

  private settings() {
    return useStore.getState().tools.settings.terrainBrush;
  }

  /** Erase mode, or Alt held: the brush paints back to the floor's own texture. */
  private isErase(alt = false): boolean {
    return useStore.getState().tools.eraseMode || alt;
  }

  /**
   * Grid-snap middleware quantizes the point before it reaches the tool —
   * terrible for painting. Recompute the raw world position from the event.
   */
  private rawWorld(point: Point, event?: PointerEvent): Point {
    if (!event) return point;
    const rect = this.engine.canvas().getBoundingClientRect();
    return this.engine.screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
  }

  private tintOf(hex: string): number {
    const n = parseInt(hex.replace('#', ''), 16);
    return Number.isNaN(n) ? 0xffffff : n;
  }

  onPointerDown(point: Point, event?: PointerEvent): void {
    if (event && event.button !== 0) return;
    // Terrain is global, not layer-scoped — it gets its own visibility check
    // rather than editsActiveLayer.
    if (useStore.getState().mapSettings.terrain?.visible === false) {
      notify.warning('Terrain is hidden');
      return;
    }
    const renderer = getTerrainRenderer();
    if (!renderer) return;
    const p = this.rawWorld(point, event);
    if (useStore.getState().tools.terrainFill !== 'off') {
      this.fill(renderer, p);
      return;
    }
    this.painting = true;
    this.lastStamp = p;
    this.pointer = p;
    renderer.beginStroke();
    const s = this.settings();
    this.stroke = {
      radius: s.radius,
      intensity: s.strength,
      slot: s.slot,
      tint: this.tintOf(s.tintColor),
      tintOpacity: s.tintOpacity,
      erase: this.isErase(event?.altKey),
    };
    this.pending = 0;
    this.tickAt = now();
    this.frame = nextFrame(this.tick);
  }

  /**
   * One tick of the held brush: the paint for the time since the last tick, laid along
   * the path the pointer took, or where it rests when it has not moved a stamp's width.
   */
  private tick = (): void => {
    this.frame = null;
    if (!this.painting || !this.stroke || !this.lastStamp || !this.pointer) return;
    const renderer = getTerrainRenderer();
    if (!renderer) return;
    const t = now();
    const seconds = Math.min(MAX_TICK, (t - this.tickAt) / 1000);
    this.tickAt = t;

    const s = this.stroke;
    const spacing = Math.max(0.05, s.radius * STAMP_SPACING);
    const path: Point[] = [];
    let at = this.lastStamp;
    let dx = this.pointer.x - at.x;
    let dy = this.pointer.y - at.y;
    let dist = Math.hypot(dx, dy);
    while (dist >= spacing) {
      at = { x: at.x + (dx * spacing) / dist, y: at.y + (dy * spacing) / dist };
      path.push(at);
      dx = this.pointer.x - at.x;
      dy = this.pointer.y - at.y;
      dist = Math.hypot(dx, dy);
    }
    const lay = depositForTick(this.pending, s.intensity, seconds, path.length);
    this.pending = lay.pending;
    const spots = path.length > 0 ? path : lay.count > 0 ? [this.pointer] : [];
    for (const spot of spots) {
      renderer.paintStamp(spot.x, spot.y, s.radius, lay.each, s.slot, s.erase, s.tint, s.tintOpacity);
    }
    if (spots.length > 0) this.lastStamp = spots[spots.length - 1];
    this.frame = nextFrame(this.tick);
  };

  /** Fill enclosed floor: flood the floor under `p` with the slot in hand, as one undo step. */
  private fill(renderer: Renderer, p: Point): void {
    let region: ReturnType<typeof floorRegionAt> = null;
    for (const layer of fillLayers()) {
      region = floorRegionAt(layer.mergedFloor ?? [], p.x, p.y);
      if (region) break;
    }
    const store = useStore.getState();
    if (!region) {
      // Stays armed: the next click may find the floor.
      store.setTerrainFill('miss');
      return;
    }
    const s = this.settings();
    renderer.beginStroke();
    renderer.fillRegion(region.outer, region.holes, s.slot, this.tintOf(s.tintColor), s.tintOpacity);
    store.setTerrainFill('off');
    void renderer
      .endStroke()
      .then((snapshots) => {
        if (snapshots.length > 0) undoManager.execute(new TerrainStrokeCommand(snapshots, 'Fill terrain'));
      })
      .catch((err) => console.error('[terrain] fill snapshot failed:', err));
  }

  onPointerMove(point: Point, event?: PointerEvent): void {
    const p = this.rawWorld(point, event);
    this.drawBrushPreview(p, event?.altKey);
    if (this.painting) this.pointer = p;
  }

  onPointerUp(): void {
    if (!this.painting) return;
    // The time since the last tick still counts.
    this.tick();
    if (this.frame !== null) cancelFrame(this.frame);
    this.frame = null;
    this.painting = false;
    this.lastStamp = null;
    this.pointer = null;
    this.stroke = null;
    const renderer = getTerrainRenderer();
    if (!renderer) return;
    // The GPU reads are issued synchronously inside endStroke; only the
    // copy-back is awaited, so the undo entry lands a frame or two after
    // mouse-up — well before any human-scale next action.
    void renderer
      .endStroke()
      .then((snapshots) => {
        if (snapshots.length > 0) {
          undoManager.execute(new TerrainStrokeCommand(snapshots));
        }
      })
      .catch((err) => console.error('[terrain] stroke snapshot failed:', err));
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.cancel();
    } else if (event.key === '[' || event.key === ']') {
      this.resize(event.key === ']' ? 1 : -1);
    }
  }

  /** The wheel sizes the brush, a step a notch, up grows, as [ and ] do. */
  onWheel(e: WheelEvent, world: Point): boolean {
    const delta = e.deltaY || e.deltaX;
    if (delta !== 0) this.resize(delta < 0 ? 1 : -1);
    this.drawBrushPreview(world, e.altKey);
    return true;
  }

  /** One size step up or down; the store clamps it to the brush's range. */
  private resize(dir: 1 | -1): void {
    const s = this.settings();
    useStore.getState().updateTerrainBrushSettings({ radius: s.radius + dir * TERRAIN_BRUSH_RANGES.radius.step });
  }

  private drawBrushPreview(p: Point, alt = false): void {
    const s = this.settings();
    const zoom = this.engine.stage().scale.x;
    const erase = this.painting && this.stroke ? this.stroke.erase : this.isErase(alt);
    const outOfBounds =
      Math.abs(p.x) > TERRAIN_EXTENT_HALF || Math.abs(p.y) > TERRAIN_EXTENT_HALF;

    this.brushCircle.clear();
    // Ghosted so the map still reads through it, but solid enough that the size
    // is legible — a 6% flat disc was invisible on anything but white.
    drawTerrainBrushDisc(
      this.brushCircle,
      p.x,
      p.y,
      s.radius,
      s.slot,
      erase,
      0.5,
      1.5 / zoom,
      outOfBounds ? 0x888888 : undefined,
    );
  }

  getPreview(): PreviewShape | null {
    return null; // brush circle managed directly
  }

  cancel(): void {
    if (this.frame !== null) cancelFrame(this.frame);
    this.frame = null;
    if (this.painting) {
      getTerrainRenderer()?.cancelStroke();
      this.painting = false;
      this.lastStamp = null;
      this.pointer = null;
      this.stroke = null;
    }
    // Escape puts an armed Fill down too.
    if (useStore.getState().tools.terrainFill !== 'off') useStore.getState().setTerrainFill('off');
    this.brushCircle.clear();
  }

  isActive(): boolean {
    return this.painting;
  }

  getHoverCursor(): string | null {
    return 'crosshair';
  }

  destroy(): void {
    if (this.frame !== null) cancelFrame(this.frame);
    this.frame = null;
    this.brushCircle.destroy();
  }
}
