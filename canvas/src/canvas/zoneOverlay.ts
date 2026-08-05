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

// Mirrors index.css's night-theme --text-muted/--accent-active — Pixi can't
// read CSS vars, so siblings (e.g. the selection outline) hardcode the same way.
const MUTED_COLOR = 0x979e94;
const ACCENT_COLOR = 0x91c464;

function drawZone(g: Graphics, shape: ZoneShape, selected: boolean): void {
  const color = selected ? ACCENT_COLOR : MUTED_COLOR;
  const fillAlpha = selected ? 0.2 : 0.08;
  const strokeAlpha = selected ? 0.95 : 0.6;
  const strokeWidth = selected ? 0.06 : 0.04;

  switch (shape.kind) {
    case 'point': {
      const { x, y } = shape.position;
      const r = selected ? 0.16 : 0.13;
      g.moveTo(x - r * 1.8, y).lineTo(x + r * 1.8, y);
      g.moveTo(x, y - r * 1.8).lineTo(x, y + r * 1.8);
      g.stroke({ color, width: strokeWidth, alpha: strokeAlpha });
      g.circle(x, y, r).fill({ color, alpha: selected ? 0.55 : 0.35 });
      break;
    }
    case 'circle':
      g.circle(shape.position.x, shape.position.y, shape.radius).fill({ color, alpha: fillAlpha });
      if (selected) {
        g.circle(shape.position.x, shape.position.y, shape.radius).stroke({
          color,
          width: strokeWidth,
          alpha: strokeAlpha,
        });
      } else {
        dashedCircle(g, shape.position.x, shape.position.y, shape.radius, color, strokeWidth, strokeAlpha);
      }
      break;
    case 'rect':
      g.rect(shape.x, shape.y, shape.width, shape.height).fill({ color, alpha: fillAlpha });
      if (selected) {
        g.rect(shape.x, shape.y, shape.width, shape.height).stroke({
          color,
          width: strokeWidth,
          alpha: strokeAlpha,
        });
      } else {
        dashedRect(g, shape.x, shape.y, shape.width, shape.height, color, strokeWidth, strokeAlpha);
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
