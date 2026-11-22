import { Container, Graphics } from 'pixi.js';
import { seedDoor } from '@dnd/mechanics/doors';
import { sceneCrossings } from '@dnd/mechanics/crossings';
import { BY_CROSSING, BY_WALL, STANDABLE, type WalkGrid } from '@dnd/mechanics/tokens';
import { levelWalkGrid, mapHasHiddenGround } from '@dnd/mechanics/levelGrid';
import { useStore } from '@/store/store';
import type { DoorChild, MapBuilderStore } from '@/store/types';
import type { RenderEngine } from '@/engine/RenderEngine';
import { computeMapFrame } from '@dnd/core/src/shared/mapBounds';
import { firstLevelId, layersOnLevel } from '@dnd/core/src/shared/visionGate';
import { useShell } from '@/editor/shell/shellStore';
import { deskPalette, type DeskPalette } from '@/canvas/heightOverlay';

/*
 * The View group's Walkable cells: the table's walk grid for the level being edited, read by
 * the same function the table's server runs (`@dnd/mechanics/levelGrid`), with the doors as
 * saved and the crossings as the map sets them. A cell no token can stand on is washed toward
 * the sheet; a stopped step between two standable cells is a short bar on the edge they share,
 * solid ink for a wall (or a refusing raised edge), an ink outline round the sheet for a shut
 * door, which opens at the table. A view only: nothing here is saved or picked.
 *
 * Built like the height highlight: one root in the engine's screen-space overlay with the
 * world camera copied onto it, drawn in world units. The grid is read again only when the
 * level's map changes while the view is on, and redrawn at a new zoom or desk colour.
 */

const WASH_ALPHA = 0.6;
/** A bar's length along its cell edge, in cells. */
const BAR_LENGTH = 0.6;
const WALL_PX = 3;
const DOOR_PX = 5;
const DOOR_INNER_PX = 2;
const HALO_PX = 1;
const HALO_ALPHA = 0.45;

/** One stopped step: the cell edge two standable neighbours share. */
export interface WalkBar {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Stopped by a shut door alone. */
  door: boolean;
}

/** A door as the map saves it: shut unless saved open, a secret door shut. */
function savedDoor(door: DoorChild): DoorChild {
  return { ...door, state: !door.isSecret && seedDoor(door).open ? 'open' : 'closed' };
}

/** The walk grid of the level being edited, or null on a map with no frame yet. */
export function editorWalkGrid(state: MapBuilderStore): WalkGrid | null {
  const { mapSettings, levels, layers } = state;
  const frame = computeMapFrame(layers, mapSettings.terrain?.bounds ?? null, mapSettings.fixedSize ?? null);
  if (!frame) return null;
  const levelId = state.ui.activeLevelId || firstLevelId(state);
  return levelWalkGrid({
    frame,
    settings: mapSettings,
    level: levels.find((l) => l.id === levelId) ?? null,
    layers: layersOnLevel(state, layers, levelId).map((layer) => ({
      ...layer,
      children: layer.children.map((c) => (c.childType === 'door' ? savedDoor(c) : c)),
    })),
    hasRooms: layers.some((l) => l.type === 'dungeon' && (l.rooms?.length ?? 0) > 0),
    hiddenGround: mapHasHiddenGround(state),
    crossings: sceneCrossings(undefined, null),
  });
}

/** What the view draws for a grid: the cells it washes (by index) and the stopped steps. */
export function walkMarks(grid: WalkGrid): { washed: number[]; bars: WalkBar[] } {
  const { minX, minY, cols, rows, cell, edge } = grid;
  const washed: number[] = [];
  const bars: WalkBar[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;
      if (cell[i] !== STANDABLE) {
        washed.push(i);
        continue;
      }
      const x = minX + col;
      const y = minY + row;
      // The two forward steps that cross a cell edge: east (k = 0) and south (k = 2).
      const east = edge[i * 4];
      if (col + 1 < cols && east !== 0 && cell[i + 1] === STANDABLE) {
        bars.push({ x1: x + 1, y1: y, x2: x + 1, y2: y + 1, door: (east & (BY_WALL | BY_CROSSING)) === 0 });
      }
      const south = edge[i * 4 + 2];
      if (row + 1 < rows && south !== 0 && cell[i + cols] === STANDABLE) {
        bars.push({ x1: x, y1: y + 1, x2: x + 1, y2: y + 1, door: (south & (BY_WALL | BY_CROSSING)) === 0 });
      }
    }
  }
  return { washed, bars };
}

/** Washes the cells, one rect per run of them along a row. */
function drawWash(g: Graphics, grid: WalkGrid, washed: readonly number[], pal: DeskPalette): void {
  for (let n = 0; n < washed.length; ) {
    const start = washed[n];
    let end = start;
    while (n + 1 < washed.length && washed[n + 1] === end + 1 && (end + 1) % grid.cols !== 0) end = washed[++n];
    n++;
    const col = start % grid.cols;
    const row = (start - col) / grid.cols;
    g.rect(grid.minX + col, grid.minY + row, end - start + 1, 1);
  }
  if (washed.length > 0) g.fill({ color: pal.paper, alpha: WASH_ALPHA });
}

/** The bars, `unit` world units to a screen px: walls solid over a faint halo, doors hollow. */
function drawBars(g: Graphics, bars: readonly WalkBar[], pal: DeskPalette, unit: number): void {
  const trace = (door: boolean) => {
    for (const b of bars) {
      if (b.door !== door) continue;
      const mx = (b.x1 + b.x2) / 2;
      const my = (b.y1 + b.y2) / 2;
      const hx = ((b.x2 - b.x1) * BAR_LENGTH) / 2;
      const hy = ((b.y2 - b.y1) * BAR_LENGTH) / 2;
      g.moveTo(mx - hx, my - hy).lineTo(mx + hx, my + hy);
    }
  };
  const stroke = (door: boolean, px: number, color: number, alpha = 1) => {
    trace(door);
    g.stroke({ color, width: px * unit, alpha, cap: 'butt' });
  };
  stroke(false, WALL_PX + 2 * HALO_PX, pal.paper, HALO_ALPHA);
  stroke(false, WALL_PX, pal.ink);
  stroke(true, DOOR_PX, pal.ink);
  stroke(true, DOOR_INNER_PX, pal.paper);
}

export interface WalkOverlayHandle {
  /** How many times the grid has been read, for the tests. */
  reads(): number;
  /** What is drawn now; null while the view is off. */
  marks(): { washed: number[]; bars: WalkBar[] } | null;
  destroy(): void;
}

/** Mount the Walkable cells view over the engine's world. Call once from the canvas host; `destroy` on teardown. */
export function mountWalkOverlay(engine: RenderEngine): WalkOverlayHandle {
  const root = new Container();
  root.label = 'walkOverlay';
  root.eventMode = 'none';
  const g = new Graphics();
  root.addChild(g);
  engine.overlay().addChild(root);

  const follow = (): void => {
    const world = engine.stage();
    if (root.position.x !== world.position.x || root.position.y !== world.position.y) root.position.copyFrom(world.position);
    if (root.scale.x !== world.scale.x || root.scale.y !== world.scale.y) root.scale.copyFrom(world.scale);
  };
  follow();
  const ticker = engine.ticker?.();
  ticker?.add(follow);

  const zoomNow = (): number => engine.stage().scale.x || 20;
  let reads = 0;
  let grid: WalkGrid | null = null;
  let marks: { washed: number[]; bars: WalkBar[] } | null = null;
  let stale = true;
  let dirty = true;
  let drawnZoom = 0;
  let pal = deskPalette();

  const redraw = (): void => {
    g.clear();
    if (!useShell.getState().walkView) {
      marks = null;
      return;
    }
    if (stale) {
      stale = false;
      reads++;
      grid = editorWalkGrid(useStore.getState());
      marks = grid ? walkMarks(grid) : null;
    }
    if (!grid || !marks) return;
    pal = deskPalette();
    const zoom = (drawnZoom = zoomNow());
    drawWash(g, grid, marks.washed, pal);
    drawBars(g, marks.bars, pal, 1 / zoom);
  };

  const unsubStore = useStore.subscribe((s, p) => {
    if (s.layers !== p.layers || s.levels !== p.levels || s.mapSettings !== p.mapSettings || s.ui.activeLevelId !== p.ui.activeLevelId) {
      stale = true;
      dirty = true;
    }
  });
  const unsubShell = useShell.subscribe((s, p) => {
    if (s.walkView !== p.walkView) dirty = true;
  });

  let rafId = 0;
  const tick = (): void => {
    rafId = requestAnimationFrame(tick);
    if (!ticker) follow();
    // The bars keep their screen width: redrawn at a new zoom, only while the view is on.
    if (marks && (zoomNow() !== drawnZoom || deskPalette().key !== pal.key)) dirty = true;
    if (dirty) {
      dirty = false;
      redraw();
    }
  };
  tick();

  return {
    reads: () => reads,
    marks: () => marks,
    destroy() {
      ticker?.remove(follow);
      cancelAnimationFrame(rafId);
      unsubStore();
      unsubShell();
      root.destroy({ children: true });
    },
  };
}
