import { Container, Graphics } from 'pixi.js';
import type { DrawingTool, PreviewShape } from './DrawingTool';
import type { Point } from '../../types/geometry';
import type { RenderEngine } from '../RenderEngine';
import type { DungeonLayer } from '../../store/types';
import { useStore } from '../../store/store';
import { undoManager } from '../../store/undoManager';
import { PropertyCommand } from '../../store/commands';
import { MATERIAL_BRUSH_RANGES } from '../../store/slices/tools';
import { erasePatches, paintPatch, strokeArea } from '../../shared/materialPatch';

/** The stroke drawn while painting: the brush's sweep, before it closes into a patch. */
const SWEEP_PAINT = 0x8f877b;
const SWEEP_ERASE = 0xb3261e;
/** Points closer than this to the last, in cells, are not kept. */
const MIN_STEP = 0.1;

/**
 * The Material brush: a freehand stroke as wide as the brush that closes into one solid
 * patch on release, merging with the patches of the same material it touches; Erase (the
 * mode, or Alt held) cuts the stroke out of every patch on the layer. One undo step a stroke.
 */
export class MaterialTool implements DrawingTool {
  readonly type = 'material' as const;
  readonly cursor = 'crosshair';
  readonly editsActiveLayer = true;

  private engine: RenderEngine;
  private sweep: Graphics;
  private ring: Graphics;
  private stroke: { layerId: string; points: [number, number][]; radius: number; erase: boolean } | null = null;

  constructor(engine: RenderEngine, previewContainer: Container) {
    this.engine = engine;
    this.sweep = new Graphics();
    this.ring = new Graphics();
    previewContainer.addChild(this.sweep, this.ring);
  }

  private settings() {
    return useStore.getState().tools.settings.material;
  }

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
    this.stroke = { layerId: layer.id, points: [[p.x, p.y]], radius: this.settings().radius, erase: state.tools.eraseMode || !!event?.altKey };
    this.drawSweep();
  }

  onPointerMove(point: Point, event?: PointerEvent): void {
    const p = this.rawWorld(point, event);
    this.drawRing(p, event?.altKey);
    const s = this.stroke;
    if (!s) return;
    const [lx, ly] = s.points[s.points.length - 1];
    if (Math.hypot(p.x - lx, p.y - ly) < MIN_STEP) return;
    s.points.push([p.x, p.y]);
    this.drawSweep();
  }

  onPointerUp(): void {
    const s = this.stroke;
    if (!s) return;
    this.stroke = null;
    this.sweep.clear();
    const layer = useStore.getState().layers.find((l): l is DungeonLayer => l.id === s.layerId && l.type === 'dungeon');
    if (!layer) return;
    const area = strokeArea(s.points, s.radius);
    const before = layer.materials ?? [];
    const look = this.settings();
    const after = s.erase ? erasePatches(before, area) : paintPatch(before, area, look.material, look, crypto.randomUUID());
    if (JSON.stringify(after) === JSON.stringify(before)) return;
    undoManager.execute(
      new PropertyCommand(
        s.erase ? 'Erase material' : 'Paint material',
        { type: 'layer', layerId: s.layerId },
        { materials: layer.materials },
        { materials: after.length > 0 ? after : undefined },
      ),
    );
  }

  /** The sweep so far: the brush's width along the stroke, released to close into a patch. */
  private drawSweep(): void {
    const s = this.stroke;
    this.sweep.clear();
    if (!s) return;
    const color = s.erase ? SWEEP_ERASE : SWEEP_PAINT;
    const [x0, y0] = s.points[0];
    if (s.points.length === 1) {
      this.sweep.circle(x0, y0, s.radius).fill({ color, alpha: 0.45 });
      return;
    }
    this.sweep.moveTo(x0, y0);
    for (const [x, y] of s.points.slice(1)) this.sweep.lineTo(x, y);
    this.sweep.stroke({ width: s.radius * 2, color, alpha: 0.45, cap: 'round', join: 'round' });
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') this.cancel();
    else if (event.key === '[' || event.key === ']') this.resize(event.key === ']' ? 1 : -1);
  }

  onWheel(e: WheelEvent, world: Point): boolean {
    const delta = e.deltaY || e.deltaX;
    if (delta !== 0) this.resize(delta < 0 ? 1 : -1);
    this.drawRing(world, e.altKey);
    return true;
  }

  private resize(dir: 1 | -1): void {
    const { radius } = MATERIAL_BRUSH_RANGES;
    const next = Math.min(radius.max, Math.max(radius.min, this.settings().radius + dir * radius.step));
    useStore.setState((s) => {
      s.tools.settings.material.radius = next;
    });
  }

  private drawRing(p: Point, alt = false): void {
    const erase = this.stroke ? this.stroke.erase : useStore.getState().tools.eraseMode || alt;
    const zoom = this.engine.stage().scale.x;
    this.ring.clear();
    this.ring.circle(p.x, p.y, this.settings().radius).stroke({ width: 1.5 / zoom, color: erase ? SWEEP_ERASE : SWEEP_PAINT, alpha: 0.9 });
  }

  getPreview(): PreviewShape | null {
    return null;
  }

  cancel(): void {
    this.stroke = null;
    this.sweep.clear();
    this.ring.clear();
  }

  isActive(): boolean {
    return this.stroke !== null;
  }

  getHoverCursor(): string | null {
    return 'crosshair';
  }
}
