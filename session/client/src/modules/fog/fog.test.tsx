import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup } from '@testing-library/react';
import type { Layer } from '@dnd/core/src/store/types';
import { useStore } from '@dnd/core/src/store/store';
import { refreshRooms } from '@dnd/core/src/store/roomRefresh';
import { fogOn, type FogState } from '@dnd/mechanics/fog';
import { useSessionStore } from '../../session/store';
import { useToasts } from '../../session/toasts';
import { useActiveTool } from '../../session/tools';
import { cellAt, fogFrame, roomsOfLayers, sceneFog, type TableRoom } from './fog';

/** A fixture room as the table holds one: its face in `boundary`, its centroid kept for the
 *  rows that aim at the middle of a room. */
type Room = TableRoom & { centroid: [number, number] };

const room = (id: string, x: number, name = id): Room => ({
  id,
  name,
  boundary: [
    [x, 0],
    [x + 4, 0],
    [x + 4, 4],
    [x, 4],
  ],
  anchor: [x + 2, 2],
  centroid: [x + 2, 2],
  area: 16,
  isPathway: false,
});

const CRYPT = room('r-crypt', 0, 'Crypt');
const HALL = room('r-hall', 10, 'Hall');

const dungeonLayer = (rooms: Room[]): Layer =>
  ({ id: 'l1', type: 'dungeon', children: [], standaloneWalls: [], rooms }) as unknown as Layer;

/**
 * The two fixture rooms sit at x 0..4 and 10..14, y 0..4 — one shape covers both. A plain
 * rectangle to count cells against, not the frame that shape measures (see `fogFrame` below,
 * which snaps out and then clears a whole cell all round).
 */
const FRAME = { minX: -1, minY: -1, maxX: 15, maxY: 5 };

const shapeChild = (x0: number, y0: number, x1: number, y1: number) => ({
  id: 'floor',
  childType: 'shape',
  visible: true,
  contours: [
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ],
  ],
});

const layerWith = (children: unknown[], rooms: Room[] = [CRYPT, HALL]): Layer =>
  ({ id: 'l1', type: 'dungeon', children, standaloneWalls: [], rooms }) as unknown as Layer;

beforeEach(() => {
  cleanup();
  // FogTool lists the server document's rooms, never core's re-detected ones.
  useSessionStore.setState({
    session: null,
    you: null,
    client: null,
    lastError: null,
    mapData: { layers: [dungeonLayer([CRYPT, HALL])] },
  });
  useActiveTool.getState().setActiveTool(null);
  useToasts.setState({ toast: null });
  useStore.setState({ layers: [dungeonLayer([CRYPT, HALL])] });
});

describe('fog geometry and vocabulary', () => {
  it('reads rooms off the dungeon layer', () => {
    const rooms = roomsOfLayers(useStore.getState().layers);
    expect(rooms.map((r) => r.id)).toEqual(['r-crypt', 'r-hall']);
  });

  it('defaults an absent slice to a scene with fog off', () => {
    const state = { byScene: { 'scene-1': { on: true } } } as unknown as FogState;
    expect(fogOn(sceneFog(undefined, 'scene-1'))).toBe(false);
    expect(fogOn(sceneFog(state, null))).toBe(false);
    expect(fogOn(sceneFog(state, 'scene-2'))).toBe(false);
    expect(fogOn(sceneFog(state, 'scene-1'))).toBe(true);
  });
});

describe('the frame a brushed cell is counted against', () => {
  it('measures the DM’s own document with the function the server measured it with', () => {
    // The 14×4 floor snapped out to whole cells, then the guaranteed cell of clear ground.
    expect(fogFrame({ layers: [layerWith([shapeChild(0, 0, 14, 4)])] })).toEqual({
      minX: -2,
      minY: -2,
      maxX: 16,
      maxY: 6,
    });
  });

  it('prefers the referee’s stamped frame when there is one (the player’s copy)', () => {
    const stamped = { minX: 100, minY: 100, maxX: 110, maxY: 110 };
    expect(fogFrame({ frame: stamped, layers: [layerWith([shapeChild(0, 0, 14, 4)])] })).toEqual(
      stamped,
    );
    expect(fogFrame(null)).toBeNull();
  });

  it('converts a world point to the cell the region record means by it', () => {
    expect(cellAt(FRAME, 0.5, 0.5)).toEqual([1, 1]);
    expect(cellAt(FRAME, -0.5, -0.5)).toEqual([0, 0]);
    expect(cellAt(FRAME, 13.9, 4.9)).toEqual([14, 5]);
    expect(cellAt(FRAME, -1.5, 0)).toBeNull();
    expect(cellAt(FRAME, 0, -1.5)).toBeNull();
    expect(cellAt(FRAME, 15.5, 0)).toBeNull();
    expect(cellAt(FRAME, 0, 5.5)).toBeNull();
  });
});

// ── Registration ─────────────────────────────────────────────────────────────

// ── FogHeaderActions — mode, and the settings menu ──────────────────────────

// ── FogTool — the tool row, hint, and room grid ↔ brush swap ────────────────

// ── The room grid — status as shape, direction-aware chip clicks ───────────

// ── The room grid ceiling (25+ rooms) ───────────────────────────────────────

// ── FogFooter — bulk ops with undo, and the conceal line ────────────────────

// ── rooms are authored: the document and the store name the same rooms ─────────
// The table used to read rooms off the server's document *instead of* core's store because
// core re-detected rooms from geometry on load and invented ones the referee did not have
// (demo-dungeon: 0 rooms on disk, 4 in the store). Core's sync now only places the rooms a
// map already has, so the two agree by construction; the document stays the fog lane's source
// because its faces are the referee's own.

describe('rooms on the table are the map’s own', () => {
  it('lets core’s room sync add nothing to a map nobody zoned', () => {
    const floor = {
      id: 'floor-1',
      name: 'Floor',
      childType: 'shape',
      visible: true,
      shapeType: 'rectangle',
      contours: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ],
      ],
    };
    useStore.setState({
      layers: [{ id: 'l1', type: 'dungeon', children: [floor], standaloneWalls: [], rooms: [] } as unknown as Layer],
    });
    refreshRooms();
    expect(roomsOfLayers(useStore.getState().layers)).toEqual([]);
  });

  it('reads a face from whichever field holds it, and finds the room under a point by its face', () => {
    const synced = {
      id: 'r-synced',
      name: 'Synced',
      anchor: [25, 2],
      face: [
        [23, 0],
        [27, 0],
        [27, 4],
        [23, 4],
      ],
    };
    const layers = [dungeonLayer([CRYPT]), { ...dungeonLayer([]), rooms: [synced] } as unknown as Layer];
    const rooms = roomsOfLayers(layers);
    expect(rooms.map((r) => r.id)).toEqual(['r-crypt', 'r-synced']);
    expect(rooms[1]!.boundary).toEqual(synced.face);
  });
});
