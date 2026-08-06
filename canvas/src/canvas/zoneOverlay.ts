import { Container, Graphics } from 'pixi.js';
import { useStore } from '@/store/store';
import { isLayerEffectivelyVisible } from '@dnd/core/src/store/selectors';
import type { DungeonLayer, ZoneChild } from '@/store/types';
import type { ZoneShape } from '@dnd/core/src/shared/types';

/**
 * Editor-only zone markers — drawn here, not in the shared `@dnd/core`
 * scene graph, because that graph is also what the session/table client
 * builds (see GameRenderer.tsx). Zones are DM prep, never player- or
 * table-facing, so this file living in the canvas package rather than core
 * is the whole guarantee: it is never imported by session/client.
 *
 * Subscribes on a string digest of the visible zones (+ their selection
 * state) rather than joining `subscribeToStore`'s digest cache — that cache
 * is shared with the table client and deliberately excludes zones. The
 * digest matters: an equality-less subscribe fires on every store write, and
 * an unconditional `graphics.clear()` dirties the render group on every
 * pointermove of every other tool.
 */

// Canvas overlays are theme-free white + ink: the app accent is a theme (and
// will be user-customizable), and an accent-colored marker can vanish on
// same-hue map art (green on grass). White strokes over a near-black
// under-stroke read on every biome; selected zones get a second white ring.
const WHITE = 0xffffff;
const INK = 0x191b16;
/** Outset of the second ring drawn around a selected zone, world units. */
const SELECT_RING = 0.1;

function drawZone(g: Graphics, shape: ZoneShape, selected: boolean): void {
  const fillAlpha = selected ? 0.15 : 0.08;
  const strokeAlpha = selected ? 0.95 : 0.65;
  const strokeWidth = selected ? 0.06 : 0.04;
  const inkWidth = strokeWidth + 0.03;

  switch (shape.kind) {
    case 'point': {
      const { x, y } = shape.position;
      const r = selected ? 0.16 : 0.13;
      const crosshair = () => {
        g.moveTo(x - r * 1.8, y).lineTo(x + r * 1.8, y);
        g.moveTo(x, y - r * 1.8).lineTo(x, y + r * 1.8);
      };
      crosshair();
      g.stroke({ color: INK, width: inkWidth, alpha: 0.7 });
      crosshair();
      g.stroke({ color: WHITE, width: strokeWidth, alpha: strokeAlpha });
      g.circle(x, y, r).fill({ color: WHITE, alpha: selected ? 0.95 : 0.7 });
      g.circle(x, y, r).stroke({ color: INK, width: 0.03, alpha: 0.85 });
      if (selected) {
        g.circle(x, y, r + SELECT_RING).stroke({ color: WHITE, width: 0.03, alpha: 0.9 });
      }
      break;
    }
    case 'circle': {
      const { x, y } = shape.position;
      const r = shape.radius;
      g.circle(x, y, r).fill({ color: INK, alpha: fillAlpha });
      if (selected) {
        g.circle(x, y, r).stroke({ color: INK, width: inkWidth, alpha: 0.7 });
        g.circle(x, y, r).stroke({ color: WHITE, width: strokeWidth, alpha: strokeAlpha });
        g.circle(x, y, r + SELECT_RING).stroke({ color: WHITE, width: 0.03, alpha: 0.9 });
      } else {
        dashedCircle(g, x, y, r, INK, inkWidth, 0.5);
        dashedCircle(g, x, y, r, WHITE, strokeWidth, strokeAlpha);
      }
      break;
    }
    case 'rect':
      g.rect(shape.x, shape.y, shape.width, shape.height).fill({ color: INK, alpha: fillAlpha });
      if (selected) {
        g.rect(shape.x, shape.y, shape.width, shape.height).stroke({ color: INK, width: inkWidth, alpha: 0.7 });
        g.rect(shape.x, shape.y, shape.width, shape.height).stroke({
          color: WHITE,
          width: strokeWidth,
          alpha: strokeAlpha,
        });
        g.rect(
          shape.x - SELECT_RING,
          shape.y - SELECT_RING,
          shape.width + SELECT_RING * 2,
          shape.height + SELECT_RING * 2,
        ).stroke({ color: WHITE, width: 0.03, alpha: 0.9 });
      } else {
        dashedRect(g, shape.x, shape.y, shape.width, shape.height, INK, inkWidth, 0.5);
        dashedRect(g, shape.x, shape.y, shape.width, shape.height, WHITE, strokeWidth, strokeAlpha);
      }
      break;
  }
}

/** World-unit dash/gap length — Pixi has no native dashed stroke. */
const DASH = 0.15;
const GAP = 0.1;
const CIRCLE_SEGMENTS = 32;

function dashSegment(
  g: Graphics,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len === 0) return;
  const ux = dx / len;
  const uy = dy / len;
  let pos = 0;
  while (pos < len) {
    const end = Math.min(pos + DASH, len);
    g.moveTo(x1 + ux * pos, y1 + uy * pos);
    g.lineTo(x1 + ux * end, y1 + uy * end);
    pos += DASH + GAP;
  }
}

function dashedPolygon(g: Graphics, points: [number, number][], color: number, width: number, alpha: number): void {
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    dashSegment(g, x1, y1, x2, y2);
  }
  g.stroke({ color, width, alpha });
}

function dashedCircle(g: Graphics, cx: number, cy: number, r: number, color: number, width: number, alpha: number): void {
  const points: [number, number][] = [];
  for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
    const a = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
    points.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  dashedPolygon(g, points, color, width, alpha);
}

function dashedRect(g: Graphics, x: number, y: number, w: number, h: number, color: number, width: number, alpha: number): void {
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

/** Primitive digest so zustand's default Object.is skips redraws on unrelated writes. */
function zoneDigest(state: StoreState): string {
  let key = '';
  for (const { zone, selected } of visibleZones(state)) {
    const s = zone.shape;
    key += zone.id + (selected ? '!' : '.');
    key +=
      s.kind === 'rect'
        ? `r${s.x},${s.y},${s.width},${s.height};`
        : `${s.kind === 'circle' ? `c` : 'p'}${s.position.x},${s.position.y}${s.kind === 'circle' ? `,${s.radius}` : ''};`;
  }
  return key;
}

/**
 * Wires the zone overlay into `worldContainer` and keeps it in sync with the
 * store. Call once from CanvasHost; call the returned cleanup on teardown.
 */
export function mountZoneOverlay(worldContainer: Container): () => void {
  const graphics = new Graphics();
  graphics.label = 'zoneOverlay';
  worldContainer.addChild(graphics);

  const redraw = () => {
    graphics.clear();
    for (const { zone, selected } of visibleZones(useStore.getState())) {
      drawZone(graphics, zone.shape, selected);
    }
  };

  const unsubscribe = useStore.subscribe(zoneDigest, redraw, { fireImmediately: true });

  return () => {
    unsubscribe();
    graphics.destroy();
  };
}
