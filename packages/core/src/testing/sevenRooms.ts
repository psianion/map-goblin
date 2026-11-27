// src/testing/sevenRooms.ts
//
// Test-only: the owner's seven-room cave as a dungeon layer. Seven walled rectangles in their
// drawing order (four chambers, three passages between them), a short wall with a freestanding
// door inside each end of every passage, and seven rooms pinned one per chamber and passage.
// The second rectangle is the passage that carries its own edge band and wall set; every other
// one carries the cave set. Room faces come from `syncRooms`, which needs Clipper loaded.

import type { DungeonLayer, DungeonStyle } from '../store/types';
import type { DoorChild, Room, ShapeChild, WallSegment } from '../shared/types';

type Ring = [number, number][];

export const SEVEN_RECTS: Ring[] = [
  [[2, 3], [11, 3], [11, 12], [2, 12]],
  [[10, 6], [16, 6], [16, 8], [10, 8]],
  [[15, 2], [27, 2], [27, 13], [15, 13]],
  [[5, 11], [7, 11], [7, 19], [5, 19]],
  [[3, 18], [13, 18], [13, 27], [3, 27]],
  [[12, 21], [18, 21], [18, 23], [12, 23]],
  [[17, 17], [26, 17], [26, 26], [17, 26]],
];

export const SEVEN_WALLS: Ring[] = [
  [[5.12, 17.54], [6.5, 17.54]],
  [[13.28, 21.56], [13.28, 22.45]],
  [[16.91, 22.5], [16.91, 21.49]],
  [[5.52, 12.38], [6.46, 12.38]],
  [[11.16, 7.48], [11.16, 6.53]],
  [[14.66, 7.45], [14.66, 6.53]],
];

/** Each wall's door: centre x, y, angle, width. */
const SEVEN_DOORS: [number, number, number, number][] = [
  [5.81, 17.54, 0, 1.38],
  [13.28, 22.01, 1.57, 0.88],
  [16.91, 22, -1.57, 1.01],
  [5.99, 12.38, 0, 0.94],
  [11.16, 7.005, -Math.PI / 2, 0.95],
  [14.66, 6.99, -Math.PI / 2, 0.92],
];

export const SEVEN_ANCHORS: [number, number][] = [
  [6.49, 7.52],
  [12.91, 7],
  [20.99, 7.5],
  [6, 14.96],
  [21.52, 21.5],
  [7.99, 22.48],
  [15.1, 22],
];

/** The ids the fixture's sets and floor go by. */
export const SEVEN_IDS = {
  floor: 'pack:floor_cave',
  other: 'pack:floor_stone',
  cave: 'Cave_Set',
  band: 'Band_A',
  stone: 'Stone_B',
} as const;

export interface SevenRoomOptions {
  /** The floor texture of rectangle i (default: the cave floor on all). */
  textures?: (string | undefined)[];
  /** Blend (true, the layer default) or Sharp. */
  blend?: boolean;
  /** Layer style keys on top. */
  style?: Partial<DungeonStyle>;
  /** Per-room patches, by room index. */
  rooms?: Partial<Room>[];
}

const rectShape = (i: number, ring: Ring, textureId: string | undefined, extra: Partial<ShapeChild>): ShapeChild =>
  ({
    id: `floor-${i + 1}`,
    name: `Floor ${i + 1}`,
    childType: 'shape',
    shapeType: 'rectangle',
    visible: true,
    locked: false,
    contours: [ring],
    roughnessEnabled: false,
    textureId,
    textureScale: 1,
    textureOffsetX: 0,
    textureOffsetY: 0,
    textureFillRotation: 0,
    textureTint: '#ffffff',
    ...extra,
  }) as unknown as ShapeChild;

const wall = (i: number, points: Ring): WallSegment => ({
  id: `wall-${i + 1}`,
  points,
  wallType: 'normal',
  direction: 'both',
  color: '#000000',
  width: 0.5,
  roughness: 0,
});

/** The seven-room layer, rooms pinned and not yet synced (no faces). */
export function sevenRoomLayer(opts: SevenRoomOptions = {}): DungeonLayer {
  const shapes = SEVEN_RECTS.map((ring, i) =>
    rectShape(
      i,
      ring,
      opts.textures?.[i] ?? SEVEN_IDS.floor,
      i === 1
        ? { edgeBand: SEVEN_IDS.band, styleOverrides: { wallTextureSetId: SEVEN_IDS.stone } }
        : { styleOverrides: { wallTextureSetId: SEVEN_IDS.cave } },
    ),
  );
  const doors = SEVEN_DOORS.map(
    ([x, y, angle, width], i) =>
      ({
        id: `door-${i + 1}`,
        name: `Door ${i + 1}`,
        childType: 'door',
        visible: true,
        wallId: `wall-${i + 1}`,
        position: [x, y],
        angle,
        width,
        style: 'single',
        state: 'closed',
        isSecret: false,
        freestanding: true,
      }) as DoorChild,
  );
  const rooms: Room[] = SEVEN_ANCHORS.map((anchor, i) => ({ id: `room-${i + 1}`, name: `Room ${i + 1}`, number: i + 1, anchor, ...opts.rooms?.[i] }));
  return {
    id: 'seven',
    name: 'Seven rooms',
    type: 'dungeon',
    levelId: 'lvl',
    visible: true,
    locked: false,
    opacity: 1,
    children: [...shapes, ...doors],
    standaloneWalls: SEVEN_WALLS.map((points, i) => wall(i, points)),
    thresholds: [],
    rooms,
    mergedFloor: null,
    style: {
      floorColor: '#7a6a58',
      wallColor: '#1a1410',
      wallWidth: 0.5,
      lineWidth: 0.04,
      edgeTransitionWidth: 0.5,
      showEdgeTransitions: opts.blend ?? true,
      wallTextureTint: '#ffffff',
      wallTextureSetId: SEVEN_IDS.cave,
      ...opts.style,
    } as DungeonStyle,
    sublayerVisibility: { floor: true, grid: true, walls: true },
  } as DungeonLayer;
}
