// src/testing/caveCases.ts
//
// Test-only: the maps a measured cave kit is held to, drawn with whichever kits a test names, so
// the same drawings can be laid with a seeded kit in the suite and with a real pack outside it.

import { computeMergedFloor } from '../engine/mergedFloor';
import type { DungeonLayer, PlateauChild } from '../store/types';
import type { Polygon } from '../types/geometry';

/** The sets a case is drawn with: the caves' rock, the plateaus' cliffs, and the stone rooms'. */
export interface CaseKits {
  cave: string;
  cliff: string;
  stone: string;
}

type Pt = [number, number];

const floorShape = (id: string, setId: string, contour: Polygon) => ({
  id,
  name: id,
  childType: 'shape',
  visible: true,
  shapeType: 'polygon',
  contours: [contour],
  styleOverrides: { wallTextureSetId: setId },
});

const door = (id: string, position: Pt, angle: number) => ({ id, name: id, childType: 'door', visible: true, wallId: '', position, angle, width: 1, style: 'single', state: 'closed', isSecret: false, roomA: null, roomB: null });

/** A plateau of `ring` with a cliff of `kits.cliff`, or a slope. */
export function plateau(id: string, ring: Pt[], kits: CaseKits, edge: 'cliff' | 'slope' = 'cliff', height = 1): PlateauChild {
  return { id, name: id, childType: 'plateau', visible: true, contours: [ring], height, edge, ...(edge === 'cliff' ? { edgeArt: kits.cliff } : {}) } as PlateauChild;
}

let seq = 0;
/** A dungeon layer of `children`, its union worked out. */
export function caseLayer(children: unknown[], kits: CaseKits, openings: Polygon[] = []): DungeonLayer {
  const layer = {
    id: `case-${seq++}`,
    name: 'Dungeon',
    type: 'dungeon',
    visible: true,
    children,
    standaloneWalls: [],
    style: { floorColor: '#F1ECDF', wallColor: '#000000', wallWidth: 0.5, lineWidth: 0.04, wallTextureSetId: kits.stone, wallTextureTint: '#b09878' },
    caveOpenings: openings,
    mergedFloor: null,
  } as unknown as DungeonLayer;
  layer.mergedFloor = computeMergedFloor(layer);
  return layer;
}

/** The brush-painted cave of "FA cave test 1". */
export const BRUSH_CAVE: Pt[] = [[8.799, 13.963], [9.943, 14.317], [10.402, 14.576], [10.698, 14.824], [11.156, 15.35], [12.126, 16.769], [13.175, 17.88], [13.61, 18.451], [14.023, 19.338], [14.209, 20.279], [14.151, 21.223], [13.779, 22.195], [13.053, 23.209], [12.102, 24.092], [11.572, 24.445], [10.728, 24.865], [9.485, 25.255], [8.439, 25.306], [6.64, 25.07], [5.256, 25.154], [4.525, 25.109], [3.535, 24.901], [2.547, 24.498], [1.848, 23.94], [1.266, 23.169], [0.935, 22.467], [0.741, 21.552], [0.757, 20.81], [0.933, 20.047], [1.376, 19.037], [2.088, 17.768], [2.751, 16.757], [3.315, 16.104], [4.108, 15.45], [5.192, 14.729], [6.031, 14.314], [6.851, 14.052], [7.882, 13.91]];

const brushCave = (kits: CaseKits) => ({ ...floorShape('cave', '', BRUSH_CAVE), edgeMaterial: kits.cave });

/**
 * "FA cave test 1" as drawn: a six-sided cave and a rectangular one joined by a two-cell
 * corridor, a mouth erased into the six-sided one, a stone room, a door on the rectangle and
 * one on the stone room, and a brush-painted cave.
 */
export function joinedCaves(kits: CaseKits): DungeonLayer {
  return caseLayer(
    [
      floorShape('six', kits.cave, [[14.945, 6.984], [12.961, 11.969], [6.961, 12.992], [2.992, 9.023], [3.258, 7.648], [4.719, 7.648], [4.719, 6.016], [3.57, 6.016], [3.953, 4.031], [11.945, 3.016]]),
      floorShape('rect', kits.cave, [[17.952, 4.033], [25.992, 4.033], [25.992, 11.005], [17.952, 11.005]]),
      floorShape('corridor', kits.cave, [[13.931, 6.018], [19.02, 6.018], [19.02, 8.003], [13.931, 8.003]]),
      floorShape('stone', kits.stone, [[16.982, 15.014], [24.973, 15.014], [26.999, 16.964], [26.999, 22.967], [16.982, 22.967]]),
      brushCave(kits),
      door('d1', [16.984375, 18.99491094147583], -Math.PI / 2),
      door('d2', [19.987277353689567, 11.0078125], Math.PI),
    ],
    kits,
    [[[4.719, 7.648], [2.383, 7.648], [2.383, 6.016], [4.719, 6.016]]],
  );
}

/** A 10 by 8 cave room. With `mouth`, a mouth two cells wide erased half a cell into its left wall. */
export const ROOM: Pt[] = [[0, 0], [10, 0], [10, 8], [0, 8]];
const NOTCHED: Pt[] = [[0, 0], [10, 0], [10, 8], [0, 8], [0, 5], [0.5, 5], [0.5, 3], [0, 3]];
export const MOUTH: Polygon = [[-1, 3], [0.5, 3], [0.5, 5], [-1, 5]];

function room(kits: CaseKits, children: unknown[], mouth: boolean): DungeonLayer {
  return caseLayer([floorShape('room', kits.cave, mouth ? NOTCHED : ROOM), ...children], kits, mouth ? [MOUTH] : []);
}

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

/** The cases the checker had not seen, by name: each a drawing and what it holds. */
export const CAVE_CASES: { name: string; layer: (kits: CaseKits) => DungeonLayer }[] = [
  // 1: a plateau half inside a brush cave, its edge crossing the cave's rock twice.
  { name: 'a cliff meeting a brush cave', layer: (k) => caseLayer([brushCave(k), plateau('p1', rect(9, 18, 15.5, 21), k)], k) },
  // 2: a plateau whose left side lies on a cave wall with a mouth erased in it.
  { name: 'a cliff along a wall with a mouth in it', layer: (k) => room(k, [plateau('p2', rect(0, 1, 4, 7), k)], true) },
  // 3: a plateau half in the room and half out through its mouth.
  { name: 'a plateau straddling a mouth', layer: (k) => room(k, [plateau('p3', rect(-3, 2, 3, 6), k)], true) },
  // 4: 1×1, 2×2 and 1×3 plateaus, free-standing and in the room's corners.
  {
    name: 'small plateaus',
    layer: (k) =>
      room(
        k,
        [
          plateau('s11', rect(2, 2, 3, 3), k),
          plateau('s22', rect(5, 2, 7, 4), k),
          plateau('s13', rect(3, 4.5, 4, 7.5), k),
          plateau('c11', rect(9, 0, 10, 1), k),
          plateau('c22', rect(0, 6, 2, 8), k),
          plateau('c13', rect(9, 5, 10, 8), k),
        ],
        false,
      ),
  },
  // 5: a slope inside the room, its left side along the wall.
  { name: 'a slope along a cave wall', layer: (k) => room(k, [plateau('sl', rect(0, 1, 4, 5), k, 'slope')], false) },
];
