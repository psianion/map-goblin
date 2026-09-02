import { Container, Graphics, Text } from 'pixi.js';
import { useStore } from '@/store/store';
import { isLayerEffectivelyVisible } from '@dnd/core/src/store/selectors';
import { getEngineSingleton } from '@/engine/engineSingleton';
import { dashedPolygon } from './zoneOverlay';
import type { ConnectorChild, DungeonLayer, RoomChild } from '@/store/types';

/**
 * Editor-only authored-room and connector ink — drawn here, not in the shared
 * `@dnd/core` scene graph, for exactly the reason zoneOverlay.ts states: that
 * graph is what the session/table client builds too, and a room boundary or a
 * connector blob is DM authoring, never player-facing. This file living in the
 * canvas package is the whole no-leak guarantee.
 *
 * Same zoom convention as zoneOverlay: world-unit constants are divided by
 * (zoom / REFERENCE_ZOOM) so every stroke keeps constant weight on screen.
 */
const REFERENCE_ZOOM = 20;

// White + ink only. The app accent is a theme and can vanish on same-hue map
// art — see zoneOverlay.ts for the full argument.
const WHITE = 0xffffff;
const INK = 0x191b16;

const DASH = 0.15;
const GAP = 0.1;
/** Outset of the second ring drawn around a selected item, world units. */
const SELECT_RING_WIDTH = 0.03;
/** Interior fill alphas — a room reads as an outline, a connector as a solid joint. */
const ROOM_FILL = { unselected: 0.04, selected: 0.08 };
const CONNECTOR_FILL = { arch: 0.14, door: 0.3 };

/** Label size in screen pixels, held constant by dividing out the camera zoom. */
const LABEL_PX = 12;

type Ring = [number, number][];

/**
 * The child's outer contour with its baked transform applied, or null when the
 * ring is degenerate. Rooms and connectors share `RingGeometry`, so one reader
 * serves both.
 */
export function overlayRing(child: RoomChild | ConnectorChild): Ring | null {
  const ring = child.contours[0];
  if (!ring || ring.length < 3) return null;
  const t = child.transform;
  if (!t) return ring;
  const cos = Math.cos(t.rotate);
  const sin = Math.sin(t.rotate);
  return ring.map(([x, y]): [number, number] => {
    const sx = x * t.scale[0];
    const sy = y * t.scale[1];
    return [sx * cos - sy * sin + t.translate[0], sx * sin + sy * cos + t.translate[1]];
  });
}

function centroid(ring: Ring): [number, number] {
  let x = 0;
  let y = 0;
  for (const [px, py] of ring) {
    x += px;
    y += py;
  }
  return [x / ring.length, y / ring.length];
}

function drawRoom(g: Graphics, ring: Ring, selected: boolean, scale: number): void {
  const flat = ring.flat();
  const strokeWidth = (selected ? 0.06 : 0.04) / scale;
  const inkWidth = strokeWidth + 0.03 / scale;

  g.poly(flat).fill({ color: INK, alpha: selected ? 0.12 : 0.07 });
  g.poly(flat).fill({ color: WHITE, alpha: selected ? ROOM_FILL.selected : ROOM_FILL.unselected });

  if (selected) {
    g.poly(flat).stroke({ color: INK, width: inkWidth, alpha: 0.7 });
    g.poly(flat).stroke({ color: WHITE, width: strokeWidth, alpha: 0.95 });
  } else {
    dashedPolygon(g, ring, INK, inkWidth, 0.5, DASH / scale, GAP / scale);
    dashedPolygon(g, ring, WHITE, strokeWidth, 0.65, DASH / scale, GAP / scale);
  }
}

function drawConnector(g: Graphics, c: ConnectorChild, ring: Ring, selected: boolean, scale: number): void {
  const flat = ring.flat();
  const strokeWidth = (selected ? 0.06 : 0.04) / scale;
  const inkWidth = strokeWidth + 0.03 / scale;

  // Kind is read off the fill weight and the outline: an arch is the light,
  // dashed opening; a door is the solid, heavier plug.
  g.poly(flat).fill({ color: INK, alpha: 0.18 });
  g.poly(flat).fill({ color: WHITE, alpha: c.kind === 'door' ? CONNECTOR_FILL.door : CONNECTOR_FILL.arch });

  g.poly(flat).stroke({ color: INK, width: inkWidth, alpha: 0.7 });
  if (c.kind === 'door') {
    g.poly(flat).stroke({ color: WHITE, width: strokeWidth, alpha: selected ? 0.95 : 0.8 });
  } else {
    dashedPolygon(g, ring, WHITE, strokeWidth, selected ? 0.95 : 0.75, DASH / scale, GAP / scale);
  }

  if (selected) {
    g.poly(flat).stroke({ color: WHITE, width: SELECT_RING_WIDTH / scale, alpha: 0.9 });
  }
}

type StoreState = ReturnType<typeof useStore.getState>;

interface Authored {
  rooms: { child: RoomChild; ring: Ring; selected: boolean }[];
  connectors: { child: ConnectorChild; ring: Ring; selected: boolean }[];
}

/**
 * Whether the ink is drawn at all right now.
 *
 * `ui.roomOverlayVisible` is the DM's own preference (RoomPanel's header switch,
 * the same affordance shape as the grid's), and it governs the idle canvas only:
 * while the room or connector tool is held the ink comes back regardless, because
 * the alternative is authoring a room you cannot see.
 */
export function overlayShows(state: StoreState): boolean {
  const tool = state.tools.activeTool;
  return state.ui.roomOverlayVisible || tool === 'room' || tool === 'connector';
}

function visibleAuthored(state: StoreState): Authored {
  const out: Authored = { rooms: [], connectors: [] };
  if (!overlayShows(state)) return out;
  for (const l of state.layers) {
    if (l.type !== 'dungeon' || !isLayerEffectivelyVisible(state, l as DungeonLayer)) continue;
    for (const c of (l as DungeonLayer).children) {
      if (c.childType !== 'room' && c.childType !== 'connector') continue;
      if (!c.visible) continue;
      const ring = overlayRing(c);
      if (!ring) continue;
      const selected = state.selection.selectedIds.includes(c.id);
      if (c.childType === 'room') out.rooms.push({ child: c, ring, selected });
      else out.connectors.push({ child: c, ring, selected });
    }
  }
  return out;
}

/** Current stage zoom, or REFERENCE_ZOOM (100%) with no engine mounted (tests). */
function currentZoom(): number {
  return getEngineSingleton()?.engine.stage().scale.x ?? REFERENCE_ZOOM;
}

/**
 * Wires the authored room/connector overlay into `worldContainer` and keeps it
 * in sync with the store. Call once from CanvasHost; call the returned cleanup
 * on teardown.
 */
export function mountRoomConnectorOverlay(worldContainer: Container): () => void {
  const root = new Container();
  root.label = 'roomConnectorOverlay';
  const graphics = new Graphics();
  root.addChild(graphics);
  const labels = new Container();
  root.addChild(labels);
  worldContainer.addChild(root);

  const clearLabels = () => {
    for (const child of labels.removeChildren()) child.destroy();
  };

  const redraw = (zoom: number) => {
    graphics.clear();
    clearLabels();
    const scale = zoom / REFERENCE_ZOOM;
    const { rooms, connectors } = visibleAuthored(useStore.getState());

    for (const { ring, selected } of rooms) drawRoom(graphics, ring, selected, scale);
    // Connectors last so a joint reads on top of the two rooms it straddles.
    for (const { child, ring, selected } of connectors) {
      drawConnector(graphics, child, ring, selected, scale);
    }

    for (const { child, ring } of rooms) {
      const [cx, cy] = centroid(ring);
      const label = new Text({
        text: child.name,
        style: { fontFamily: 'sans-serif', fontSize: LABEL_PX, fill: WHITE, stroke: { color: INK, width: 3 } },
      });
      label.anchor.set(0.5);
      label.position.set(cx, cy);
      label.scale.set(1 / zoom);
      labels.addChild(label);
    }
  };

  // Zoom lives outside the store (plain Pixi stage state), so a rAF poll notices
  // it moved; geometry/selection changes come from the store via a dirty flag.
  // ui.solo is its own key: toggleSoloLayer never touches `layers`. So are the two
  // terms `overlayShows` reads — the DM's toggle and the held tool.
  let dirty = true;
  const unsubscribe = useStore.subscribe(
    (state) =>
      [
        state.layers,
        state.selection.selectedIds,
        state.ui.solo,
        state.ui.roomOverlayVisible,
        state.tools.activeTool,
      ] as const,
    () => {
      dirty = true;
    },
    {
      equalityFn: (a, b) =>
        a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3] && a[4] === b[4],
    },
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
    clearLabels();
    root.destroy({ children: true });
  };
}
