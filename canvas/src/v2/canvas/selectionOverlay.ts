import { Container, Graphics } from 'pixi.js';
import { useStore } from '@/store/store';
import type { MapBuilderStore } from '@/store/types';
import type { RenderEngine } from '@/engine/RenderEngine';
import { getEditorDesk } from '@dnd/core/src/engine/editorDesk';
import { getChildFootprint, getWallBounds, wallReach } from '@dnd/core/src/engine/hitTest';
import { dashSpine } from '@dnd/core/src/engine/wallNodeRenderer';
import { isLockedObject, resolveSelection } from '@dnd/core/src/store/selectionResolve';

/*
 * The v2 editor's selection overlay: what the gizmo cannot say about a selection. A locked
 * member stays selectable but is left out of the box, so it gets a dashed outline of its
 * own and a padlock at its top-left corner instead of handles.
 *
 * Built like the prop overlay (propOverlay.ts): one root in the engine's screen-space
 * overlay, the world camera copied onto it every frame, drawn in world units, redrawn
 * only when the selection, its locked members or the settled zoom change. Nothing here
 * runs per pointermove; `stats()` counts the redraws for the tests.
 */

const OUTLINE_PX = 1.5;
const HALO_PX = 1;
const DASH_PX = 5;
const GAP_PX = 4;
const PAD_PX = 3;
const GLYPH_HALF = 8;
const ZOOM_SETTLE_MS = 140;

type Box = { x: number; y: number; width: number; height: number };

export interface SelectionOverlayModel {
  /** The world box of each locked selected member, with its id. */
  locked: { id: string; box: Box }[];
}

/** What the overlay draws for `state`. Pure. */
export function selectionOverlayModel(state: MapBuilderStore): SelectionOverlayModel {
  const sel = resolveSelection(state, state.selection.selectedIds);
  const locked: SelectionOverlayModel['locked'] = [];
  for (const { child } of sel.children) {
    // A light by its marker: the padlock sits on the lamp, not out at its radius.
    if (isLockedObject(child) && child.visible) locked.push({ id: child.id, box: getChildFootprint(child) });
  }
  for (const { wall, layer } of sel.walls) {
    if (isLockedObject(wall) && wall.visible !== false) locked.push({ id: wall.id, box: getWallBounds(wall, wallReach(wall, layer)) });
  }
  return { locked };
}

/** A redraw's inputs by identity: the selection and its locked members, never `layers`. */
function overlayKeys(s: MapBuilderStore): unknown[] {
  const ids = new Set(s.selection.selectedIds);
  const out: unknown[] = [s.selection.selectedIds];
  if (ids.size === 0) return out;
  for (const l of s.layers) {
    if (l.type !== 'dungeon') continue;
    for (const c of l.children) if (ids.has(c.id) && isLockedObject(c)) out.push(c);
    for (const w of l.standaloneWalls ?? []) if (ids.has(w.id) && isLockedObject(w)) out.push(w);
  }
  return out;
}

function hexToNum(hex: string | undefined, fallback: number): number {
  if (!hex) return fallback;
  const n = parseInt(hex.replace('#', ''), 16);
  return Number.isNaN(n) ? fallback : n;
}

function palette(): { ink: number; paper: number; key: string } {
  const desk = getEditorDesk();
  const ink = desk?.ink ?? '#1b1b1b';
  const paper = desk?.sheet ?? '#fbfbfb';
  return { ink: hexToNum(ink, 0x1b1b1b), paper: hexToNum(paper, 0xfbfbfb), key: `${ink}${paper}` };
}

function drawLockGlyph(g: Graphics, ink: number, paper: number): void {
  const h = GLYPH_HALF;
  g.clear()
    .roundRect(-h, -h, 2 * h, 2 * h, 3)
    .fill({ color: paper, alpha: 0.95 })
    .roundRect(-h, -h, 2 * h, 2 * h, 3)
    .stroke({ color: ink, width: 1, alpha: 0.6 })
    .roundRect(-3.5, -0.5, 7, 5, 1)
    .fill({ color: ink, alpha: 1 })
    .moveTo(-2.2, -0.5)
    .lineTo(-2.2, -2.5)
    .arc(0, -2.5, 2.2, Math.PI, 0)
    .lineTo(2.2, -0.5)
    .stroke({ color: ink, width: 1.3, alpha: 1 });
}

export interface SelectionOverlayStats {
  redraws: number;
}

export interface SelectionOverlayHandle {
  destroy(): void;
  stats(): SelectionOverlayStats;
}

export function mountSelectionOverlay(engine: RenderEngine): SelectionOverlayHandle {
  const root = new Container();
  root.label = 'selectionOverlay';
  root.eventMode = 'none';
  const lines = new Graphics();
  const glyphs = new Container();
  root.addChild(lines, glyphs);
  engine.overlay().addChild(root);
  const stats: SelectionOverlayStats = { redraws: 0 };

  const follow = (): void => {
    const world = engine.stage();
    if (root.position.x !== world.position.x || root.position.y !== world.position.y) root.position.copyFrom(world.position);
    if (root.scale.x !== world.scale.x || root.scale.y !== world.scale.y) root.scale.copyFrom(world.scale);
  };
  follow();
  const ticker = engine.ticker?.();
  ticker?.add(follow);

  const pool = new Map<string, Graphics>();
  const zoomNow = (): number => engine.stage().scale.x || 20;
  let settledZoom = zoomNow();
  let lastZoom = settledZoom;
  let zoomMovedAt = 0;
  let dirty = true;
  let pal = palette();

  const redraw = (): void => {
    stats.redraws++;
    const zoom = settledZoom;
    const next = palette();
    if (next.key !== pal.key) {
      for (const g of pool.values()) g.destroy();
      pool.clear();
    }
    pal = next;
    const model = selectionOverlayModel(useStore.getState());
    lines.clear();
    const live = new Set<string>();
    for (const { id, box } of model.locked) {
      const p = PAD_PX / zoom;
      const [x0, y0, x1, y1] = [box.x - p, box.y - p, box.x + box.width + p, box.y + box.height + p];
      const path: [number, number][] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
      dashSpine(lines, path, DASH_PX / zoom, GAP_PX / zoom);
      lines.stroke({ color: pal.paper, width: (OUTLINE_PX + 2 * HALO_PX) / zoom, alpha: 0.6 });
      dashSpine(lines, path, DASH_PX / zoom, GAP_PX / zoom);
      lines.stroke({ color: pal.ink, width: OUTLINE_PX / zoom, alpha: 1 });
      live.add(id);
      let g = pool.get(id);
      if (!g) {
        g = new Graphics();
        g.label = 'selectionLock';
        drawLockGlyph(g, pal.ink, pal.paper);
        glyphs.addChild(g);
        pool.set(id, g);
      }
      g.position.set(x0, y0);
    }
    for (const [id, g] of pool) {
      if (live.has(id)) continue;
      g.destroy();
      pool.delete(id);
    }
    for (const g of pool.values()) g.scale.set(1 / zoomNow());
  };

  const unsubscribe = useStore.subscribe(overlayKeys, () => {
    dirty = true;
  }, {
    equalityFn: (a, b) => a.length === b.length && a.every((v, i) => v === b[i]),
  });

  let rafId = 0;
  const tick = (): void => {
    rafId = requestAnimationFrame(tick);
    if (!ticker) follow();
    const zoom = zoomNow();
    const now = performance.now();
    if (zoom !== lastZoom) {
      lastZoom = zoom;
      zoomMovedAt = now;
      for (const g of pool.values()) g.scale.set(1 / zoom);
    } else if (zoom !== settledZoom && now - zoomMovedAt >= ZOOM_SETTLE_MS) {
      settledZoom = zoom;
      dirty = true;
    }
    if (palette().key !== pal.key) dirty = true;
    if (dirty) {
      dirty = false;
      redraw();
    }
  };
  tick();

  return {
    stats: () => ({ ...stats }),
    destroy() {
      ticker?.remove(follow);
      cancelAnimationFrame(rafId);
      unsubscribe();
      pool.clear();
      root.destroy({ children: true });
    },
  };
}
