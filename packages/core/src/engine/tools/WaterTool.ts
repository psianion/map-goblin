import { Container, Graphics } from 'pixi.js';
import type { DrawingTool, PreviewShape } from './DrawingTool';
import type { Point } from '../../types/geometry';
import type { RenderEngine } from '../RenderEngine';
import type { DungeonLayer } from '../../store/types';
import { useStore } from '../../store/store';
import { undoManager } from '../../store/undoManager';
import { PropertyCommand } from '../../store/commands';
import { WATER_BRUSH_RANGES } from '../../store/slices/tools';
import { decodeWater, encodeWater, lookOf, paintWaterDisc, type WaterGrid, type WaterLook } from '../../shared/waterMask';
import { previewLayerWater } from '../water/waterRenderer';

/** Dab spacing along a drag, as a fraction of the brush radius. */
const DAB_SPACING = 0.3;

/** The ring drawn round the brush: ink for paint, the erase red for erase. */
const RING_PAINT = 0x5f8a93;
const RING_ERASE = 0xb3261e;

/**
 * The Water brush: paints the active layer's water mask with a round brush, or dries it
 * (Erase mode, or Alt held). A stroke is one undo step; the layer's first water takes the
 * look the panel holds, later strokes keep the layer's own.
 */
export class WaterTool implements DrawingTool {
  readonly type = 'water' as const;
  readonly cursor = 'crosshair';
  readonly editsActiveLayer = true;

  private engine: RenderEngine;
  private ring: Graphics;
  private stroke: { layerId: string; before: DungeonLayer['water']; grid: WaterGrid; look: WaterLook; radius: number; erase: boolean; last: Point } | null = null;
  private frame: number | null = null;

  constructor(engine: RenderEngine, previewContainer: Container) {
    this.engine = engine;
    this.ring = new Graphics();
    previewContainer.addChild(this.ring);
  }

  private settings() {
    return useStore.getState().tools.settings.water;
  }

  /** Snap would quantize a brush; the raw world position comes from the event. */
  private rawWorld(point: Point, event?: PointerEvent): Point {
    if (!event) return point;
    const rect = this.engine.canvas().getBoundingClientRect();
    return this.engine.screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
  }

  onPointerDown(point: Point, event?: PointerEvent): void {
    if (event && event.button !== 0) return;
    const state = useStore.getState();
    const layer = state.layers.find((l): l is DungeonLayer => l.id === state.ui.activeLayerId && l.type === 'dungeon');
    if (!layer) return;
    const p = this.rawWorld(point, event);
    const s = this.settings();
    this.stroke = {
      layerId: layer.id,
      before: layer.water,
      grid: decodeWater(layer.water),
      look: layer.water ? lookOf(layer.water) : lookOf(s),
      radius: s.radius,
      erase: state.tools.eraseMode || !!event?.altKey,
      last: p,
    };
    this.dab(p);
  }

  /** Dabs from the last dab to `p`, a dab every spacing, and draws the stroke on the next frame. */
  private dab(p: Point): void {
    const s = this.stroke;
    if (!s) return;
    const step = Math.max(0.05, s.radius * DAB_SPACING);
    const dist = Math.hypot(p.x - s.last.x, p.y - s.last.y);
    const n = Math.max(1, Math.ceil(dist / step));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      s.grid = paintWaterDisc(s.grid, s.last.x + (p.x - s.last.x) * t, s.last.y + (p.y - s.last.y) * t, s.radius, s.erase);
    }
    s.last = p;
    if (this.frame === null) {
      const draw = () => {
        this.frame = null;
        if (this.stroke) previewLayerWater(this.stroke.layerId, this.stroke.grid, this.stroke.look);
      };
      this.frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(draw) : (draw(), null);
    }
  }

  onPointerMove(point: Point, event?: PointerEvent): void {
    const p = this.rawWorld(point, event);
    this.drawRing(p, event?.altKey);
    if (this.stroke) this.dab(p);
  }

  onPointerUp(): void {
    const s = this.stroke;
    if (!s) return;
    this.endFrame();
    this.stroke = null;
    const after = encodeWater(s.grid, s.look) ?? undefined;
    if (JSON.stringify(after) === JSON.stringify(s.before)) return;
    undoManager.execute(
      new PropertyCommand(s.erase ? 'Erase water' : 'Paint water', { type: 'layer', layerId: s.layerId }, { water: s.before }, { water: after }),
    );
  }

  private endFrame(): void {
    if (this.frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') this.cancel();
    else if (event.key === '[' || event.key === ']') this.resize(event.key === ']' ? 1 : -1);
  }

  /** The wheel sizes the brush, as [ and ] do. */
  onWheel(e: WheelEvent, world: Point): boolean {
    const delta = e.deltaY || e.deltaX;
    if (delta !== 0) this.resize(delta < 0 ? 1 : -1);
    this.drawRing(world, e.altKey);
    return true;
  }

  private resize(dir: 1 | -1): void {
    const { radius } = WATER_BRUSH_RANGES;
    const next = Math.min(radius.max, Math.max(radius.min, this.settings().radius + dir * radius.step));
    useStore.setState((s) => {
      s.tools.settings.water.radius = next;
    });
  }

  private drawRing(p: Point, alt = false): void {
    const erase = this.stroke ? this.stroke.erase : useStore.getState().tools.eraseMode || alt;
    const zoom = this.engine.stage().scale.x;
    this.ring.clear();
    this.ring.circle(p.x, p.y, this.settings().radius).stroke({ width: 1.5 / zoom, color: erase ? RING_ERASE : RING_PAINT, alpha: 0.9 });
  }

  getPreview(): PreviewShape | null {
    return null;
  }

  cancel(): void {
    this.endFrame();
    const s = this.stroke;
    this.stroke = null;
    // The stroke never reached the store: draw the layer's water back as it was.
    if (s) previewLayerWater(s.layerId, decodeWater(s.before), s.before ?? s.look);
    this.ring.clear();
  }

  isActive(): boolean {
    return this.stroke !== null;
  }

  getHoverCursor(): string | null {
    return 'crosshair';
  }
}
