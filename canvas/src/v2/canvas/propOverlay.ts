import { Container, Graphics } from 'pixi.js';
import { useStore } from '@/store/store';
import type { AssetChild, MapBuilderStore } from '@/store/types';
import type { RenderEngine } from '@/engine/RenderEngine';
import { groupMembers } from '@/store/selectors';
import { getEditorDesk } from '@dnd/core/src/engine/editorDesk';
import { getChildBounds, unionChildBounds } from '@dnd/core/src/engine/hitTest';
import { dashSpine } from '@dnd/core/src/engine/wallNodeRenderer';
import { overlayLayers } from './roomOverlay';

/*
 * The v2 editor's prop overlay: what a DM sees of the prop states the art itself does not
 * show. Editor only (this file lives in the canvas package; the table never draws it).
 *
 *  - A lock glyph on each locked prop while the Props tool is in hand, and on a locked
 *    prop under the pointer. A locked prop lets clicks pass through it, so this is how it
 *    is found again.
 *  - A dashed outline around the hovered prop when it is locked. An unlocked one is the
 *    Select tool's to outline (solid); a locked one says "you cannot take this" instead.
 *  - A dashed outline around each group selected whole, just outside the gizmo's box.
 *
 * Built like the room overlay (roomOverlay.ts): one root in the engine's screen-space
 * overlay with the world camera copied onto it every frame, drawn in world units, and
 * redrawn only when its own keys move — the locked props, the hovered prop, the
 * selected groups' members, the selection, the tool, the look-under switch, the zoom
 * once it settles. A prop drag that touches none of those costs nothing, and nothing
 * here runs per pointermove: `stats()` counts the redraws for the tests.
 */

const OUTLINE_PX = 1.5;
const HALO_PX = 1;
const HALO_COLOR = 0xffffff;
const HALO_ALPHA = 0.45;
const DASH_PX = 5;
const GAP_PX = 4;
/** The group outline sits this far outside the selection box, clear of the gizmo's line. */
const GROUP_PAD_PX = 6;
/** Half the lock glyph's tile, px. */
const GLYPH_HALF = 8;
/** Zoom must hold this long before the outlines are redrawn at it. */
const ZOOM_SETTLE_MS = 140;

type Box = { x: number; y: number; width: number; height: number };

// ─── Model (pure) ──────────────────────────────────────────────────────────

export interface PropOverlayModel {
  /** Locked props that show their lock. */
  locks: AssetChild[];
  /** The prop under the pointer, when it is locked. */
  hover: AssetChild | null;
  /** Union boxes of the groups whose every member is selected, world units. */
  groups: Box[];
}

const isLocked = (c: { childType: string; locked?: boolean }): boolean => c.childType === 'asset' && !!c.locked;

/** What the overlay draws for `state`. Pure: no Pixi, no engine. */
export function propOverlayModel(state: MapBuilderStore): PropOverlayModel {
  const propsTool = state.tools.activeTool === 'scatterBrush';
  const hoveredId = state.selection.hoveredId;
  const selected = new Set(state.selection.selectedIds);
  const locks: AssetChild[] = [];
  let hover: AssetChild | null = null;
  const groups: Box[] = [];
  for (const layer of overlayLayers(state)) {
    for (const c of layer.children) {
      if (c.childType !== 'asset' || !c.locked || !c.visible) continue;
      if (c.id === hoveredId) hover = c;
      if (propsTool || c.id === hoveredId) locks.push(c);
    }
    for (const g of layer.groups ?? []) {
      const members = groupMembers(layer, g.id);
      if (members.length === 0 || !members.every((m) => selected.has(m.id))) continue;
      const box = unionChildBounds(members);
      if (box) groups.push(box);
    }
  }
  return { locks, hover, groups };
}

/**
 * What a redraw depends on, by identity: the locked props, the hovered prop, the members
 * of selected groups, and the state switches. Never `layers` itself, which a drag
 * rewrites on every move.
 */
function overlayKeys(s: MapBuilderStore): unknown[] {
  const selected = new Set(s.selection.selectedIds);
  const out: unknown[] = [
    s.selection.selectedIds,
    s.selection.hoveredId,
    s.tools.activeTool,
    s.ui.seeUnderOverhead,
    s.ui.activeLevelId,
    s.ui.solo,
  ];
  for (const l of s.layers) {
    if (l.type !== 'dungeon') continue;
    out.push(l.id, l.visible, l.levelId, l.groups);
    for (const c of l.children) {
      if (isLocked(c) || c.id === s.selection.hoveredId || (c.groupId && selected.has(c.id))) out.push(c);
      // A selected prop moved from outside the canvas (card fields, Align, a nudge): its
      // geometry, not its identity, so a tint or a rename redraws nothing.
      else if (c.childType === 'asset' && selected.has(c.id)) out.push(c.position, c.rotation, c.width, c.height, c.scale);
    }
  }
  return out;
}

// ─── Drawing ───────────────────────────────────────────────────────────────

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

/** The four corners of a prop's turned footprint, closed. */
function footprint(c: AssetChild): [number, number][] {
  const hw = (c.width * c.scale) / 2;
  const hh = (c.height * c.scale) / 2;
  const cos = Math.cos(c.rotation);
  const sin = Math.sin(c.rotation);
  const pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh], [-hw, -hh]] as const;
  return pts.map(([x, y]): [number, number] => [c.position.x + x * cos - y * sin, c.position.y + x * sin + y * cos]);
}

/** A padlock on a paper tile, px about its centre. */
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

/** What the overlay has cost so far. */
export interface PropOverlayStats {
  redraws: number;
  /** Wall-clock ms spent in redraws, summed. */
  ms: number;
}

export interface PropOverlayHandle {
  destroy(): void;
  /** Counters for the performance contract (tests, the dev console). */
  stats(): PropOverlayStats;
}

/**
 * Mount the prop overlay over the engine's world and keep it in step with the store.
 * Call once from the canvas host in the v2 editor; `destroy` on teardown.
 */
export function mountPropOverlay(engine: RenderEngine): PropOverlayHandle {
  const root = new Container();
  root.label = 'propOverlay';
  root.eventMode = 'none';
  const lines = new Graphics();
  const glyphs = new Container();
  root.addChild(lines, glyphs);
  const screen = engine.overlay();
  screen.addChild(root);
  const stats: PropOverlayStats = { redraws: 0, ms: 0 };

  const follow = (): void => {
    const world = engine.stage();
    if (root.position.x !== world.position.x || root.position.y !== world.position.y) root.position.copyFrom(world.position);
    if (root.scale.x !== world.scale.x || root.scale.y !== world.scale.y) root.scale.copyFrom(world.scale);
  };
  follow();
  const ticker = engine.ticker?.();
  ticker?.add(follow);

  // One glyph per locked prop shown, kept across redraws by id.
  const pool = new Map<string, Graphics>();
  const zoomNow = (): number => engine.stage().scale.x || 20;
  let settledZoom = zoomNow();
  let lastZoom = settledZoom;
  let zoomMovedAt = 0;
  let dirty = true;
  let pal = palette();

  const scaleGlyphs = (zoom: number): void => {
    for (const g of pool.values()) g.scale.set(1 / zoom);
  };

  const strokeDashed = (path: [number, number][], zoom: number): void => {
    dashSpine(lines, path, DASH_PX / zoom, GAP_PX / zoom);
    lines.stroke({ color: HALO_COLOR, width: (OUTLINE_PX + 2 * HALO_PX) / zoom, alpha: HALO_ALPHA });
    dashSpine(lines, path, DASH_PX / zoom, GAP_PX / zoom);
    lines.stroke({ color: pal.ink, width: OUTLINE_PX / zoom, alpha: 1 });
  };

  const redraw = (): void => {
    const started = performance.now();
    stats.redraws++;
    const zoom = settledZoom;
    const next = palette();
    if (next.key !== pal.key) {
      // New desk colours: every glyph is drawn again below.
      for (const g of pool.values()) g.destroy();
      pool.clear();
    }
    pal = next;
    const model = propOverlayModel(useStore.getState());

    lines.clear();
    if (model.hover) strokeDashed(footprint(model.hover), zoom);
    for (const b of model.groups) {
      const p = GROUP_PAD_PX / zoom;
      const [x0, y0, x1, y1] = [b.x - p, b.y - p, b.x + b.width + p, b.y + b.height + p];
      strokeDashed([[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]], zoom);
    }

    // Glyphs at the top-right of each locked prop's box, screen-sized.
    const live = new Set<string>();
    for (const c of model.locks) {
      live.add(c.id);
      let g = pool.get(c.id);
      if (!g) {
        g = new Graphics();
        drawLockGlyph(g, pal.ink, pal.paper);
        glyphs.addChild(g);
        pool.set(c.id, g);
      }
      const b = getChildBounds(c);
      g.position.set(b.x + b.width, b.y);
    }
    for (const [id, g] of pool) {
      if (live.has(id)) continue;
      g.destroy();
      pool.delete(id);
    }
    scaleGlyphs(zoomNow());
    stats.ms += performance.now() - started;
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
      // Mid-zoom the glyphs stay screen-sized (a scale, not a redraw).
      lastZoom = zoom;
      zoomMovedAt = now;
      scaleGlyphs(zoom);
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
