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
 * Redraws on any store change (see subscribeToAssets.ts for the same
 * subscribe shape) rather than joining `subscribeToStore`'s digest cache —
 * that cache is shared with the table client and deliberately excludes
 * zones.
 */

const MUTED_COLOR = 0x94a3b8;
const ACCENT_COLOR = 0x6c63ff;

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

interface ZoneSnapshot {
  layerId: string;
  zones: ZoneChild[];
}

function snapshot(): { layers: ZoneSnapshot[]; selectedIds: string[] } {
  const state = useStore.getState();
  return {
    layers: state.layers
      .filter((l): l is DungeonLayer => l.type === 'dungeon' && isLayerEffectivelyVisible(state, l))
      .map((l) => ({
        layerId: l.id,
        zones: l.children.filter((c): c is ZoneChild => c.childType === 'zone' && c.visible),
      })),
    selectedIds: state.selection.selectedIds,
  };
}

/**
 * Wires the zone overlay into `worldContainer` and keeps it in sync with the
 * store. Call once from CanvasHost; call the returned cleanup on teardown.
 */
export function mountZoneOverlay(worldContainer: Container): () => void {
  const graphics = new Graphics();
  graphics.label = 'zoneOverlay';
  worldContainer.addChild(graphics);

  const redraw = ({ layers, selectedIds }: ReturnType<typeof snapshot>) => {
    graphics.clear();
    for (const { zones } of layers) {
      for (const zone of zones) {
        drawZone(graphics, zone.shape, selectedIds.includes(zone.id));
      }
    }
  };

  const unsubscribe = useStore.subscribe(snapshot, redraw, { fireImmediately: true });

  return () => {
    unsubscribe();
    graphics.destroy();
  };
}
