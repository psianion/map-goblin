import { Container, Sprite, Graphics, Texture } from 'pixi.js';
import type { DrawingTool, PreviewShape } from './DrawingTool';
import type { Point } from '../../types/geometry';
import type { AssetChild, DungeonLayer, ScatterBrushSettings } from '../../store/types';
import { useStore } from '../../store/store';
import { familyMembers, nextAssetName, siblingOf } from '../../assets/packCatalog';
import { resolveTexture } from '../../assets/textureLoader';
import { mulberry32 } from '../../geometry/seededRng';
import { CompositeCommand, createChildRemovalCommand } from '../../store/commands';
import { createPlacePropsCommand } from '../../store/propEdits';
import { undoManager } from '../../store/undoManager';
import { setAssetChildrenAlpha } from '../subscribeToAssets';
import { getEditorDesk } from '../editorDesk';
import { dashSpine } from '../wallNodeRenderer';
import { eraseHits, footprintSnap, naturalSizeOf } from './propPlacement';
import { beginStroke, scatterDab, MAX_DAB, type Placement, type ScatterCtx, type StrokeStats } from './scatter';

export { MAX_DAB };

/** One wheel notch turns the stamp this far (15°). */
export const STAMP_ROTATE_STEP = Math.PI / 12;
/** One Alt+wheel notch scales the stamp by this. */
export const STAMP_SCALE_STEP = 1.1;

const GHOST_ALPHA = 0.6;
const STROKE_ALPHA = 0.85;
/** Props an erase stroke has caught, until pointerup removes them. */
const ERASE_FADE = 0.3;
/** Stamp mode erases one prop at a time: a brush this small. */
const STAMP_ERASE_RADIUS = 0.5;
const TAU = Math.PI * 2;
/** The brush ring, screen px: an ink line on a paper halo, like the prop overlay's outlines. */
const RING_INK_PX = 1.5;
const RING_HALO_PX = 3;
const RING_HALO_ALPHA = 0.85;
const RING_FILL_ALPHA = 0.04;
/** The erase ring's dashes, screen px. */
const RING_DASH_PX = 5;
const RING_GAP_PX = 4;
/** Sides of the polygon the dashed ring is laid along. */
const RING_SIDES = 96;

function deskColor(hex: string | undefined, fallback: number): number {
  const n = hex ? parseInt(hex.replace('#', ''), 16) : NaN;
  return Number.isNaN(n) ? fallback : n;
}

/** What the running scatter stroke has done, for the status bar. */
export type StrokeStatus = StrokeStats;

let status: StrokeStatus | null = null;
let estimate: number | null = null;
const listeners = new Set<() => void>();

/** The running scatter stroke's counts, or null when no stroke runs. */
export function strokeStatus(): StrokeStatus | null {
  return status;
}

/** How many props a dab under the hovering scatter brush would place, or null when not hovering one. */
export function brushEstimate(): number | null {
  return estimate;
}

/** Called whenever `strokeStatus()` or `brushEstimate()` changes. Returns the unsubscribe. */
export function subscribeStrokeStatus(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setStatus(next: StrokeStatus | null): void {
  status = next ? { ...next } : null;
  for (const fn of listeners) fn();
}

function setEstimate(next: number | null): void {
  if (next === estimate) return;
  estimate = next;
  for (const fn of listeners) fn();
}

const normalizeAngle = (a: number): number => ((a % TAU) + TAU) % TAU;

/** A placement the stamp would make for the cursor: exactly what the ghost shows. */
interface StampPlacement {
  assetId: string;
  position: Point;
  rotation: number;
  width: number;
  height: number;
  flipX: boolean;
}

type Stroke =
  | { kind: 'scatter'; layerId: string; ctx: ScatterCtx; placements: Placement[]; dabNo: number; last: Point }
  | { kind: 'erase'; layerId: string; radius: number; ids: Set<string> };

/**
 * The Props tool. Stamp mode places one prop at a time under a ghost the wheel,
 * right-click and F shape; Scatter mode paints a pool of props with a brush, one
 * undo per stroke; erase mode removes props under a brush, one undo per stroke.
 */
export class StampScatterTool implements DrawingTool {
  readonly type = 'scatterBrush' as const;
  readonly cursor = 'crosshair';
  readonly editsActiveLayer = true;

  private previewContainer: Container;
  /** The stamp ghost: one sprite and its footprint, moved in place, never rebuilt. */
  private ghost: Sprite;
  private footprint: Graphics;
  /** Last size and zoom the footprint was drawn at; it is redrawn only when these change. */
  private footprintKey = '';
  private brushCircle: Graphics;
  /** Sprites showing the running scatter stroke, reused from stroke to stroke. */
  private strokeSprites: Sprite[] = [];
  private strokeSpritesUsed = 0;
  private lastCursorWorld: Point | null = null;
  /** Ctrl on the last pointer event: it inverts the stamp's grid snap. */
  private ctrlHeld = false;
  private stroke: Stroke | null = null;
  private strokeNo = 0;
  private stampCount = 0;
  private textureCache = new Map<string, Texture>();
  private unsubSettings: (() => void) | null = null;
  private unsubErase: (() => void) | null = null;
  private unsubTool: (() => void) | null = null;

  constructor(previewContainer: Container) {
    this.previewContainer = previewContainer;
    this.brushCircle = new Graphics();
    this.footprint = new Graphics();
    this.footprint.visible = false;
    // Its texture is set when there is a prop to show.
    this.ghost = new Sprite();
    this.ghost.anchor.set(0.5);
    this.ghost.alpha = GHOST_ALPHA;
    this.ghost.visible = false;
    this.previewContainer.addChild(this.brushCircle);
    this.previewContainer.addChild(this.ghost);
    this.previewContainer.addChild(this.footprint);

    // The dock, the wheel and the keys all write settings; the ghost follows.
    this.unsubSettings = useStore.subscribe(
      (state) => state.tools.settings.scatterBrush,
      () => this.refreshPreview(),
    );
    this.unsubErase = useStore.subscribe(
      (state) => state.tools.eraseMode,
      () => this.refreshPreview(),
    );
    // Erase is a moment inside the Props tool, not a mode it keeps: putting the tool down
    // leaves it, so B brings the tool back placing, in Stamp or Scatter as it was.
    this.unsubTool = useStore.subscribe(
      (state) => state.tools.activeTool,
      (tool, prev) => {
        if (prev === 'scatterBrush' && tool !== 'scatterBrush' && useStore.getState().tools.eraseMode) {
          useStore.getState().setEraseMode(false);
        }
      },
    );
  }

  private getSettings(): ScatterBrushSettings {
    return useStore.getState().tools.settings.scatterBrush;
  }

  private isEraseMode(): boolean {
    return useStore.getState().tools.eraseMode;
  }

  private activeLayer(): DungeonLayer | null {
    const state = useStore.getState();
    const layer = state.layers.find((l) => l.id === state.ui.activeLayerId);
    return layer && layer.type === 'dungeon' ? (layer as DungeonLayer) : null;
  }

  private layerById(id: string): DungeonLayer | null {
    const layer = useStore.getState().layers.find((l) => l.id === id);
    return layer && layer.type === 'dungeon' ? (layer as DungeonLayer) : null;
  }

  private zoom(): number {
    return this.previewContainer.parent?.scale.x ?? 1;
  }

  // ─── Preview ───

  /** Called on every pointer move and when settings change. Allocates no sprites. */
  updatePreview(worldPoint: Point): void {
    this.lastCursorWorld = worldPoint;
    const settings = this.getSettings();
    this.brushCircle.clear();

    if (this.isEraseMode()) {
      this.ghost.visible = false;
      this.footprint.visible = false;
      setEstimate(null);
      const radius = settings.stampMode ? STAMP_ERASE_RADIUS : settings.brushRadius;
      this.drawRing(worldPoint, radius, true);
      return;
    }

    if (settings.stampMode) {
      setEstimate(null);
      this.showGhost(worldPoint, settings);
      return;
    }

    this.ghost.visible = false;
    this.footprint.visible = false;
    if (settings.assetIds.length === 0) {
      setEstimate(null);
      return;
    }
    // Scatter: the brush only. Samples appear once a stroke places them.
    this.drawRing(worldPoint, settings.brushRadius, false);
    setEstimate(this.stroke ? null : this.estimateAt(worldPoint, settings));
  }

  /**
   * The brush: a faint ink disc ringed by an ink line on a paper halo, so it reads on a light
   * floor and a dark one alike. Erasing draws the same ring dashed. Colours are the desk's.
   */
  private drawRing(at: Point, radius: number, dashed: boolean): void {
    const g = this.brushCircle;
    const desk = getEditorDesk();
    const ink = deskColor(desk?.ink, 0x1b1b1b);
    const paper = deskColor(desk?.sheet, 0xfbfbfb);
    const zoom = this.zoom();
    // Fill first, then stroke (PixiJS v8 flushes path on each operation)
    g.circle(at.x, at.y, radius).fill({ color: ink, alpha: RING_FILL_ALPHA });
    const path = (): void => {
      if (!dashed) {
        g.circle(at.x, at.y, radius);
        return;
      }
      const pts: [number, number][] = [];
      for (let i = 0; i <= RING_SIDES; i++) {
        const a = (i / RING_SIDES) * TAU;
        pts.push([at.x + Math.cos(a) * radius, at.y + Math.sin(a) * radius]);
      }
      dashSpine(g, pts, RING_DASH_PX / zoom, RING_GAP_PX / zoom);
    };
    path();
    g.stroke({ width: RING_HALO_PX / zoom, color: paper, alpha: RING_HALO_ALPHA });
    path();
    g.stroke({ width: RING_INK_PX / zoom, color: ink, alpha: 1 });
  }

  /** The props a dab here would want, before overlap and floor rejections. */
  private estimateAt(center: Point, s: ScatterBrushSettings): number | null {
    const layer = this.activeLayer();
    if (!layer) return null;
    const r2 = s.brushRadius * s.brushRadius;
    let existing = 0;
    for (const c of layer.children) {
      if (c.childType !== 'asset' || !c.visible) continue;
      const p = (c as AssetChild).position;
      if ((p.x - center.x) ** 2 + (p.y - center.y) ** 2 <= r2) existing++;
    }
    const want = Math.round(s.density * Math.PI * r2) - existing;
    return Math.max(0, Math.min(MAX_DAB, want));
  }

  /** Where a stamp lands for the cursor, at the ghost's angle, size and mirror. */
  private stampAt(cursor: Point, s: ScatterBrushSettings): StampPlacement | null {
    const assetId = s.assetIds[0];
    if (!assetId) return null;
    const size = naturalSizeOf(assetId);
    if (!size) return null;
    const width = size.w * s.stampScale;
    const height = size.h * s.stampScale;
    const grid = useStore.getState().grid;
    const position = footprintSnap(
      cursor,
      width,
      height,
      s.stampRotation,
      grid.snapEnabled !== this.ctrlHeld,
      grid.snapDivision,
    );
    return { assetId, position, rotation: s.stampRotation, width, height, flipX: s.stampFlipX };
  }

  private showGhost(cursor: Point, s: ScatterBrushSettings): void {
    const at = this.stampAt(cursor, s);
    if (!at) {
      this.ghost.visible = false;
      this.footprint.visible = false;
      return;
    }
    const ghost = this.ghost;
    const tex = this.textureFor(at.assetId);
    if (ghost.texture !== tex) ghost.texture = tex;
    ghost.position.set(at.position.x, at.position.y);
    ghost.rotation = at.rotation;
    ghost.scale.set(((at.flipX ? -1 : 1) * at.width) / tex.width, at.height / tex.height);
    ghost.visible = true;

    const zoom = this.zoom();
    const key = `${at.width}|${at.height}|${zoom}`;
    if (key !== this.footprintKey) {
      this.footprintKey = key;
      const f = this.footprint;
      f.clear();
      // A light halo under a 1 px ink line, both constant on screen.
      f.rect(-at.width / 2, -at.height / 2, at.width, at.height);
      f.stroke({ width: 3 / zoom, color: 0xffffff, alpha: 0.7 });
      f.rect(-at.width / 2, -at.height / 2, at.width, at.height);
      f.stroke({ width: 1 / zoom, color: 0x1a1a1a, alpha: 0.9 });
    }
    this.footprint.position.set(at.position.x, at.position.y);
    this.footprint.rotation = at.rotation;
    this.footprint.visible = true;
  }

  private textureFor(assetId: string): Texture {
    const cached = this.textureCache.get(assetId);
    if (cached) return cached;
    // The unified resolver covers pack art and imported images synchronously.
    const resolved = resolveTexture(assetId);
    if (resolved.width > 1) {
      this.textureCache.set(assetId, resolved);
      return resolved;
    }
    // Not loaded yet (the 1×1 fallback) — placeholder; the next update tries again
    return Texture.WHITE;
  }

  /** Show one placement of the running stroke on the next free pooled sprite. */
  private showStrokeSprite(p: Placement): void {
    let sprite = this.strokeSprites[this.strokeSpritesUsed];
    if (!sprite) {
      sprite = new Sprite(Texture.WHITE);
      sprite.anchor.set(0.5);
      sprite.alpha = STROKE_ALPHA;
      this.strokeSprites.push(sprite);
      this.previewContainer.addChild(sprite);
    }
    this.strokeSpritesUsed++;
    const tex = this.textureFor(p.assetId);
    sprite.texture = tex;
    sprite.position.set(p.position.x, p.position.y);
    sprite.rotation = p.rotation;
    sprite.scale.set(p.width / tex.width, p.height / tex.height);
    sprite.tint = p.tint;
    sprite.visible = true;
  }

  private hideStrokeSprites(): void {
    for (let i = 0; i < this.strokeSpritesUsed; i++) this.strokeSprites[i].visible = false;
    this.strokeSpritesUsed = 0;
  }

  // ─── Stamp ───

  private placeStamp(cursor: Point, layer: DungeonLayer): void {
    const settings = this.getSettings();
    const at = this.stampAt(cursor, settings);
    if (!at) return;
    const name = nextAssetName(at.assetId, layer.children.map((c) => c.name));
    const child = makeChild(name, at.assetId, at.position, at.rotation, at.width, at.height, '#ffffff', at.flipX);
    undoManager.execute(
      createPlacePropsCommand(layer.id, [child], { under: settings.placeUnder, label: 'Place prop' }),
    );

    const store = useStore.getState();
    store.trackRecentUse(at.assetId);
    this.stampCount++;
    if (settings.stampVary) {
      const members = familyMembers(at.assetId);
      if (members.length > 1) {
        const rng = mulberry32(settings.seed + this.stampCount);
        const next = members[Math.floor(rng() * members.length)].id;
        store.updateScatterBrushSettings({ assetIds: [next, ...settings.assetIds.slice(1)] });
      }
    }
    if (!store.tools.settings.continuousPlacement) store.setActiveTool('select');
  }

  // ─── Scatter ───

  private beginScatter(point: Point, layer: DungeonLayer, settings: ScatterBrushSettings): void {
    this.strokeNo++;
    const ctx = beginStroke(layer, settings, this.strokeNo);
    this.stroke = { kind: 'scatter', layerId: layer.id, ctx, placements: [], dabNo: 0, last: point };
    setEstimate(null);
    this.dab(point);
  }

  private dab(at: Point): void {
    const stroke = this.stroke;
    if (stroke?.kind !== 'scatter') return;
    const got = scatterDab(stroke.ctx, at, stroke.dabNo++);
    for (const p of got) {
      stroke.placements.push(p);
      this.showStrokeSprite(p);
    }
    setStatus(stroke.ctx.stats);
  }

  /** One dab every `max(0.5, 0.6·r)` of pointer travel, laid along the path. */
  private continueScatter(point: Point): void {
    const stroke = this.stroke;
    if (stroke?.kind !== 'scatter') return;
    const spacing = Math.max(0.5, 0.6 * stroke.ctx.settings.brushRadius);
    let dx = point.x - stroke.last.x;
    let dy = point.y - stroke.last.y;
    let d = Math.hypot(dx, dy);
    while (d >= spacing) {
      stroke.last = { x: stroke.last.x + (dx / d) * spacing, y: stroke.last.y + (dy / d) * spacing };
      this.dab(stroke.last);
      dx = point.x - stroke.last.x;
      dy = point.y - stroke.last.y;
      d = Math.hypot(dx, dy);
    }
  }

  private commitScatter(stroke: Extract<Stroke, { kind: 'scatter' }>): void {
    const layer = this.layerById(stroke.layerId);
    if (!layer || stroke.placements.length === 0) return;
    // Names come from the catalog label with a max-suffix counter; the
    // accumulator keeps one stroke from reusing a name.
    const taken = layer.children.map((c) => c.name);
    const children = stroke.placements.map((p) => {
      const name = nextAssetName(p.assetId, taken);
      taken.push(name);
      return makeChild(name, p.assetId, p.position, p.rotation, p.width, p.height, p.tint, false);
    });
    undoManager.execute(
      createPlacePropsCommand(layer.id, children, {
        under: stroke.ctx.settings.placeUnder,
        label: 'Scatter props',
      }),
    );
    const store = useStore.getState();
    for (const id of new Set(stroke.placements.map((p) => p.assetId))) store.trackRecentUse(id);
  }

  // ─── Erase ───

  private eraseAt(point: Point): void {
    const stroke = this.stroke;
    if (stroke?.kind !== 'erase') return;
    const layer = this.layerById(stroke.layerId);
    if (!layer) return;
    const fresh = eraseHits(layer, point, stroke.radius).filter((id) => !stroke.ids.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) stroke.ids.add(id);
    setAssetChildrenAlpha(stroke.layerId, fresh, ERASE_FADE);
  }

  private commitErase(stroke: Extract<Stroke, { kind: 'erase' }>): void {
    const ids = [...stroke.ids];
    if (ids.length === 0) return;
    // Put the fade back first: an undo brings these children back on the same ids.
    setAssetChildrenAlpha(stroke.layerId, ids, 1);
    undoManager.execute(
      new CompositeCommand(
        'Erase props',
        ids.map((id) => createChildRemovalCommand(stroke.layerId, id, 'Erase prop')),
      ),
    );
  }

  /** Abandon the running stroke: nothing is placed or erased. */
  private dropStroke(): void {
    const stroke = this.stroke;
    this.stroke = null;
    if (stroke?.kind === 'erase' && stroke.ids.size > 0) {
      setAssetChildrenAlpha(stroke.layerId, [...stroke.ids], 1);
    }
    this.hideStrokeSprites();
    if (stroke?.kind === 'scatter') setStatus(null);
  }

  // ─── DrawingTool Interface ───

  onPointerDown(point: Point, event?: PointerEvent): void {
    // A middle-button press pans; it must not stamp or start a stroke.
    if (event && event.button !== 0) return;
    this.ctrlHeld = !!event?.ctrlKey;
    this.dropStroke();
    const layer = this.activeLayer();
    // The manager's editsActiveLayer guard already fired before onPointerDown
    // reached this — dead by construction, but the type still needs narrowing.
    if (!layer) return;
    const settings = this.getSettings();

    if (this.isEraseMode()) {
      const radius = settings.stampMode ? STAMP_ERASE_RADIUS : settings.brushRadius;
      this.stroke = { kind: 'erase', layerId: layer.id, radius, ids: new Set() };
      this.eraseAt(point);
      return;
    }
    if (settings.assetIds.length === 0) return;
    if (settings.stampMode) {
      this.placeStamp(point, layer);
      return;
    }
    this.beginScatter(point, layer, settings);
  }

  onPointerMove(point: Point, event?: PointerEvent): void {
    this.ctrlHeld = !!event?.ctrlKey;
    if (this.stroke?.kind === 'scatter') this.continueScatter(point);
    else if (this.stroke?.kind === 'erase') this.eraseAt(point);
    this.updatePreview(point);
  }

  onPointerUp(): void {
    const stroke = this.stroke;
    if (!stroke) return;
    this.stroke = null;
    this.hideStrokeSprites();
    if (stroke.kind === 'scatter') {
      setStatus(null);
      this.commitScatter(stroke);
    } else {
      this.commitErase(stroke);
    }
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      // Mid-stroke, Escape drops the stroke and keeps the tool; otherwise back to Select.
      if (this.stroke) {
        this.dropStroke();
        return;
      }
      this.cancel();
      useStore.getState().setActiveTool('select');
      return;
    }
    if (event.key.toLowerCase() === 'f' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      const s = this.getSettings();
      if (s.stampMode && !this.isEraseMode()) {
        useStore.getState().updateScatterBrushSettings({ stampFlipX: !s.stampFlipX });
      }
    }
  }

  /** Stamp mode: wheel turns 15°, Alt+wheel scales, Shift+wheel steps the variant. */
  onWheel(e: WheelEvent, world: Point): boolean {
    const s = this.getSettings();
    if (!s.stampMode || this.isEraseMode() || s.assetIds.length === 0) return false;
    const delta = e.deltaY || e.deltaX;
    if (delta === 0) return true;
    const dir = delta > 0 ? 1 : -1;
    this.lastCursorWorld ??= world;
    const store = useStore.getState();
    if (e.altKey) {
      store.updateScatterBrushSettings({ stampScale: s.stampScale * STAMP_SCALE_STEP ** -dir });
    } else if (e.shiftKey) {
      store.updateScatterBrushSettings({ assetIds: [siblingOf(s.assetIds[0], dir), ...s.assetIds.slice(1)] });
    } else {
      store.updateScatterBrushSettings({ stampRotation: normalizeAngle(s.stampRotation + dir * STAMP_ROTATE_STEP) });
    }
    return true;
  }

  /** Stamp mode: right-click turns the stamp 90° instead of opening the menu. */
  onContextMenu(world: Point): boolean {
    const s = this.getSettings();
    if (!s.stampMode || this.isEraseMode() || s.assetIds.length === 0) return false;
    this.lastCursorWorld ??= world;
    useStore.getState().updateScatterBrushSettings({ stampRotation: normalizeAngle(s.stampRotation + Math.PI / 2) });
    return true;
  }

  getPreview(): PreviewShape | null {
    return null; // Preview managed via direct Sprites
  }

  cancel(): void {
    this.dropStroke();
    this.ghost.visible = false;
    this.footprint.visible = false;
    this.brushCircle.clear();
    this.lastCursorWorld = null;
    setEstimate(null);
  }

  isActive(): boolean {
    return this.stroke !== null || this.lastCursorWorld !== null;
  }

  getHoverCursor(_sx: number, _sy: number): string | null {
    return 'crosshair';
  }

  refreshPreview(): void {
    if (this.lastCursorWorld) this.updatePreview(this.lastCursorWorld);
  }

  destroy(): void {
    // Unsubscribe BEFORE destroying PixiJS objects to prevent race conditions
    this.unsubSettings?.();
    this.unsubErase?.();
    this.unsubTool?.();
    this.cancel();
    for (const sprite of this.strokeSprites) sprite.destroy();
    this.strokeSprites = [];
    this.ghost.destroy();
    this.footprint.destroy();
    this.brushCircle.destroy();
  }
}

/** A new prop child: size in width/height, `scale` 1. */
function makeChild(
  name: string,
  assetId: string,
  position: Point,
  rotation: number,
  width: number,
  height: number,
  tint: string,
  flipX: boolean,
): AssetChild {
  return {
    id: crypto.randomUUID(),
    name,
    childType: 'asset',
    visible: true,
    objectType: 'asset',
    assetId,
    position: { x: position.x, y: position.y },
    rotation,
    scale: 1,
    width,
    height,
    tint,
    flipX,
    flipY: false,
  };
}
