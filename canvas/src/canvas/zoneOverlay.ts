import { Container, Graphics } from 'pixi.js';
import { useStore } from '@/store/store';
import { isLayerEffectivelyVisible } from '@dnd/core/src/store/selectors';
import { getEngineSingleton } from '@/engine/engineSingleton';
import type { DungeonLayer, ZoneChild } from '@/store/types';
import type { ZoneShape } from '@dnd/core/src/shared/types';

/**
 * Editor-only zone markers — drawn here, not in the shared `@dnd/core`
 * scene graph, because that graph is also what the session/table client
 * builds (see GameRenderer.tsx). Zones are DM prep, never player- or
 * table-facing, so this file living in the canvas package rather than core
 * is the whole guarantee: it is never imported by session/client.
 *
 * Every world-unit constant below (stroke widths, the point radius, the
 * dash pattern) is divided by (zoom / REFERENCE_ZOOM) before drawing, so the
 * marker keeps constant weight on screen at any zoom — the same guarantee
 * the light icons get from being drawn in screen space. `zoom` here is
 * `stage().scale.x`, i.e. pixels-per-world-unit (20 at 100%, set in
 * PixiRenderEngine's initial camera), not a 1.0-based multiplier — dividing
 * world constants by the raw zoom cancels the container's own scale exactly
 * and pins every marker to a fixed sub-pixel size, so REFERENCE_ZOOM is what
 * makes the authored constants read as their intended on-screen weight at
 * 100% and hold it as the camera moves.
 *
 * Zone geometry and selection live in the store, but the camera zoom does
 * not (it's plain Pixi stage state, like the zoom slider's own
 * `stage().scale.x` poll), so there's nothing in the store to subscribe to
 * for "zoom changed" — a frame poll compares the zoom to the last-seen
 * value. Geometry/selection changes still come from the store, via a
 * `subscribeWithSelector` dirty flag, so the poll doesn't have to re-walk
 * every dungeon child 60 times a second to know whether zones changed.
 */
const REFERENCE_ZOOM = 20;

// Canvas overlays are theme-free white + ink: the app accent is a theme (and
// will be user-customizable), and an accent-colored marker can vanish on
// same-hue map art (green on grass). White strokes over a near-black
// under-stroke read on every biome; selected zones get a second white ring.
const WHITE = 0xffffff;
const INK = 0x191b16;
/** Outset of the second ring drawn around a selected zone, world units. */
const SELECT_RING = 0.1;
/** Width of the thin outline rings (the point marker's own outline, the select ring). */
const RING_WIDTH = 0.03;
/** Interior fill on top of the ink fill so zones read on black-surround (unlit) maps too. */
const WHITE_FILL = { unselected: 0.05, selected: 0.09 };

function drawZone(g: Graphics, shape: ZoneShape, selected: boolean, zoom: number): void {
  const fillAlpha = selected ? 0.15 : 0.08;
  const whiteFillAlpha = selected ? WHITE_FILL.selected : WHITE_FILL.unselected;
  const strokeAlpha = selected ? 0.95 : 0.65;
  const scale = zoom / REFERENCE_ZOOM;
  const strokeWidth = (selected ? 0.06 : 0.04) / scale;
  const inkWidth = strokeWidth + 0.03 / scale;
  const ringWidth = RING_WIDTH / scale;
  const selectRing = SELECT_RING / scale;
  const dash = DASH / scale;
  const gap = GAP / scale;

  switch (shape.kind) {
    case 'point': {
      const { x, y } = shape.position;
      const r = (selected ? 0.16 : 0.13) / scale;
      const crosshair = () => {
        g.moveTo(x - r * 1.8, y).lineTo(x + r * 1.8, y);
        g.moveTo(x, y - r * 1.8).lineTo(x, y + r * 1.8);
      };
      crosshair();
      g.stroke({ color: INK, width: inkWidth, alpha: 0.7 });
      crosshair();
      g.stroke({ color: WHITE, width: strokeWidth, alpha: strokeAlpha });
      g.circle(x, y, r).fill({ color: WHITE, alpha: selected ? 0.95 : 0.7 });
      g.circle(x, y, r).stroke({ color: INK, width: ringWidth, alpha: 0.85 });
      if (selected) {
        g.circle(x, y, r + selectRing).stroke({ color: WHITE, width: ringWidth, alpha: 0.9 });
      }
      break;
    }
    case 'circle': {
      const { x, y } = shape.position;
      const r = shape.radius;
      g.circle(x, y, r).fill({ color: INK, alpha: fillAlpha });
      g.circle(x, y, r).fill({ color: WHITE, alpha: whiteFillAlpha });
      if (selected) {
        g.circle(x, y, r).stroke({ color: INK, width: inkWidth, alpha: 0.7 });
        g.circle(x, y, r).stroke({ color: WHITE, width: strokeWidth, alpha: strokeAlpha });
        g.circle(x, y, r + selectRing).stroke({ color: WHITE, width: ringWidth, alpha: 0.9 });
      } else {
        dashedCircle(g, x, y, r, INK, inkWidth, 0.5, dash, gap);
        dashedCircle(g, x, y, r, WHITE, strokeWidth, strokeAlpha, dash, gap);
      }
      break;
    }
    case 'rect':
      g.rect(shape.x, shape.y, shape.width, shape.height).fill({ color: INK, alpha: fillAlpha });
      g.rect(shape.x, shape.y, shape.width, shape.height).fill({ color: WHITE, alpha: whiteFillAlpha });
      if (selected) {
        g.rect(shape.x, shape.y, shape.width, shape.height).stroke({ color: INK, width: inkWidth, alpha: 0.7 });
        g.rect(shape.x, shape.y, shape.width, shape.height).stroke({
          color: WHITE,
          width: strokeWidth,
          alpha: strokeAlpha,
        });
        g.rect(
          shape.x - selectRing,
          shape.y - selectRing,
          shape.width + selectRing * 2,
          shape.height + selectRing * 2,
        ).stroke({ color: WHITE, width: ringWidth, alpha: 0.9 });
      } else {
        dashedRect(g, shape.x, shape.y, shape.width, shape.height, INK, inkWidth, 0.5, dash, gap);
        dashedRect(g, shape.x, shape.y, shape.width, shape.height, WHITE, strokeWidth, strokeAlpha, dash, gap);
      }
      break;
  }
}

/** World-unit dash/gap length (pre-zoom) — Pixi has no native dashed stroke. */
const DASH = 0.15;
const GAP = 0.1;
const CIRCLE_SEGMENTS = 32;

function dashSegment(g: Graphics, x1: number, y1: number, x2: number, y2: number, dash: number, gap: number): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len === 0) return;
  const ux = dx / len;
  const uy = dy / len;
  let pos = 0;
  while (pos < len) {
    const end = Math.min(pos + dash, len);
    g.moveTo(x1 + ux * pos, y1 + uy * pos);
    g.lineTo(x1 + ux * end, y1 + uy * end);
    pos += dash + gap;
  }
}

function dashedPolygon(
  g: Graphics,
  points: [number, number][],
  color: number,
  width: number,
  alpha: number,
  dash: number,
  gap: number,
): void {
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    dashSegment(g, x1, y1, x2, y2, dash, gap);
  }
  g.stroke({ color, width, alpha });
}

function dashedCircle(
  g: Graphics,
  cx: number,
  cy: number,
  r: number,
  color: number,
  width: number,
  alpha: number,
  dash: number,
  gap: number,
): void {
  const points: [number, number][] = [];
  for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
    const a = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
    points.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  dashedPolygon(g, points, color, width, alpha, dash, gap);
}

function dashedRect(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
  width: number,
  alpha: number,
  dash: number,
  gap: number,
): void {
  dashedPolygon(
    g,
    [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ],
    color,
    width,
    alpha,
    dash,
    gap,
  );
}

type StoreState = ReturnType<typeof useStore.getState>;

function visibleZones(state: StoreState): { zone: ZoneChild; selected: boolean }[] {
  const out: { zone: ZoneChild; selected: boolean }[] = [];
  for (const l of state.layers) {
    if (l.type !== 'dungeon' || !isLayerEffectivelyVisible(state, l as DungeonLayer)) continue;
    for (const c of (l as DungeonLayer).children) {
      if (c.childType !== 'zone' || !c.visible) continue;
      out.push({ zone: c, selected: state.selection.selectedIds.includes(c.id) });
    }
  }
  return out;
}

/** Current stage zoom, or REFERENCE_ZOOM (100%) with no engine mounted (tests, or before CanvasHost wires one). */
function currentZoom(): number {
  return getEngineSingleton()?.engine.stage().scale.x ?? REFERENCE_ZOOM;
}

/**
 * Wires the zone overlay into `worldContainer` and keeps it in sync with the
 * store. Call once from CanvasHost; call the returned cleanup on teardown.
 */
export function mountZoneOverlay(worldContainer: Container): () => void {
  const graphics = new Graphics();
  graphics.label = 'zoneOverlay';
  worldContainer.addChild(graphics);

  const redraw = (zoom: number) => {
    graphics.clear();
    for (const { zone, selected } of visibleZones(useStore.getState())) {
      drawZone(graphics, zone.shape, selected, zoom);
    }
  };

  // Zoom lives outside the store (plain Pixi stage state), so a rAF poll is still needed to
  // notice it moved — same idiom as the zoom slider's own poll. Zone geometry/selection do
  // live in the store, so those are store-write-driven: a dirty flag, not a per-frame walk
  // of every dungeon child.
  let dirty = true;
  // ui.solo is a key of its own: toggleSoloLayer never touches `layers`, but
  // isLayerEffectivelyVisible reads it — same trap renderLoop.ts documents.
  const unsubscribe = useStore.subscribe(
    (state) => [state.layers, state.selection.selectedIds, state.ui.solo] as const,
    () => {
      dirty = true;
    },
    { equalityFn: (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] },
  );

  let lastZoom = NaN;
  let rafId = 0;
  const tick = () => {
    // Scheduled first so a throw below costs this one frame, not the whole loop.
    rafId = requestAnimationFrame(tick);
    const zoom = currentZoom();
    if (dirty || zoom !== lastZoom) {
      dirty = false;
      lastZoom = zoom;
      redraw(zoom);
    }
  };
  tick();

  return () => {
    cancelAnimationFrame(rafId);
    unsubscribe();
    graphics.destroy();
  };
}
