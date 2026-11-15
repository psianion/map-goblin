// Daylight through an open edge. Where a dark room meets brighter ground across a threshold,
// the brighter side's light fades a short way into the room. A threshold is the only open
// edge this reads; the room's face already stops at its walls, so a wall ends the light.
//
// Pure geometry, for the grade mask (`LightingRenderer`) and the sight test (`visionGate`), so
// what is drawn lit at a mouth is what counts as lit for player sight.

import type { DungeonLayer, MapSettings } from '../store/types';
import type { Polygon } from '../types/geometry';
import type { Level, Room } from './types';
import type { Environment } from './world';
import { clipper2Engine, isClipperReady } from '../geometry/Clipper2Engine';
import { SKY_SHARE, levelPlace } from './regionGrade';
import { buildRoomIndex } from './roomIndex';
import { roomFace, signedArea } from './roomUtils';

/** How far daylight reaches into a dark room, in cells. */
export const SPILL_CELLS = 2;
/** The nested steps the reach is cut into; the grade mask blurs them into one fade. */
export const SPILL_STEPS = 4;
/** How far off a threshold's midpoint each side is sampled, in cells. */
const SAMPLE_CELLS = 0.3;

/** The light one dark room takes in through its open edges from one brighter place. */
export interface Spill {
  roomId: string;
  /** The brighter side's place: the light that comes in. */
  from: Environment;
  /** `bands[k]`: the room's ground within `(k + 1) / SPILL_STEPS` of the reach, nested. */
  bands: [number, number][][][];
}

/**
 * Every spill on one level. `roomPlaces` holds the place each room resolves to (the look chain
 * with the table's live places on top); ground outside every room takes the level's.
 * Needs Clipper2; without it nothing spills.
 */
export function daylightSpill(
  map: { mapSettings: Pick<MapSettings, 'ambientLight' | 'environment'>; levels?: readonly Level[] },
  layers: readonly DungeonLayer[],
  levelId: string,
  roomPlaces: Readonly<Record<string, Environment>>,
): Spill[] {
  if (!isClipperReady()) return [];
  const thresholds = layers.flatMap((l) => l.thresholds ?? []);
  if (thresholds.length === 0) return [];
  const rooms = layers.flatMap((l) => l.rooms ?? []);
  const index = buildRoomIndex(rooms);
  const ground = levelPlace(map.mapSettings, map.levels?.find((l) => l.id === levelId));
  const side = (x: number, y: number): { room: Room | null; place: Environment } => {
    const room = index.roomAt(x, y);
    return { room, place: room ? (roomPlaces[room.id] ?? ground) : ground };
  };

  const sweeps = new Map<string, { room: Room; from: Environment; steps: Polygon[][] }>();
  for (const t of thresholds) {
    for (let i = 0; i + 1 < t.points.length; i++) {
      const [x0, y0] = t.points[i]!;
      const [x1, y1] = t.points[i + 1]!;
      const len = Math.hypot(x1 - x0, y1 - y0);
      if (len < 1e-6) continue;
      const nx = -(y1 - y0) / len;
      const ny = (x1 - x0) / len;
      const mx = (x0 + x1) / 2;
      const my = (y0 + y1) / 2;
      const a = side(mx + nx * SAMPLE_CELLS, my + ny * SAMPLE_CELLS);
      const b = side(mx - nx * SAMPLE_CELLS, my - ny * SAMPLE_CELLS);
      if (a.place === b.place) continue;
      const aDarker = SKY_SHARE[a.place] < SKY_SHARE[b.place];
      const dark = aDarker ? a : b;
      const bright = aDarker ? b : a;
      if (!dark.room) continue;
      const sign = aDarker ? 1 : -1;
      const key = `${dark.room.id}|${bright.place}`;
      let sweep = sweeps.get(key);
      if (!sweep) {
        sweep = { room: dark.room, from: bright.place, steps: Array.from({ length: SPILL_STEPS }, () => []) };
        sweeps.set(key, sweep);
      }
      for (let k = 0; k < SPILL_STEPS; k++) {
        const d = (SPILL_CELLS * (k + 1)) / SPILL_STEPS;
        const ox = nx * sign * d;
        const oy = ny * sign * d;
        const quad: Polygon = [[x0, y0], [x1, y1], [x1 + ox, y1 + oy], [x0 + ox, y0 + oy]];
        // One winding for every quad: Clipper fills non-zero, so two overlapping quads of
        // opposite winding would cancel into a hole.
        sweep.steps[k]!.push(signedArea(quad) < 0 ? quad.reverse() : quad);
      }
    }
  }

  const out: Spill[] = [];
  for (const { room, from, steps } of sweeps.values()) {
    const face = roomFace(room);
    if (face.length < 3) continue;
    const bands = steps.map((quads) => clipper2Engine.intersection(quads, [face]));
    if (bands.every((b) => b.length === 0)) continue;
    out.push({ roomId: room.id, from, bands });
  }
  return out;
}

/** The part of a spill that counts as lit for sight: its first cell. */
export function spillLitArea(spill: Spill): [number, number][][] {
  const k = Math.min(spill.bands.length, Math.max(1, Math.round(SPILL_STEPS / SPILL_CELLS))) - 1;
  return spill.bands[k] ?? [];
}
