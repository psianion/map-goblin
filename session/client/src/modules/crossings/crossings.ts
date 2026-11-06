// Crossing a raised edge at the table (plan §7): which cliffs and slopes a token's
// move goes over, what the table plays each of them as, and whether the move stands. Pure —
// the drag reads it per hop, the tests read it directly. The geometry is core's
// (`shared/plateaus.ts`), the same the server refuses a forged move with.

import { crossingIdOf, crossingsAlongLayers, layerPlateaus, type Crossing } from '@dnd/core/src/shared/plateaus';
import { defaultCrossingKinds } from '@dnd/core/src/shared/crossingKinds';
import { firstLevelId, layersOnLevel } from '@dnd/core/src/shared/visionGate';
import type { CrossingKind, Level } from '@dnd/core/src/shared/types';
import type { Layer } from '@dnd/core/src/store/types';
import type { Role } from '@dnd/core/src/shared/protocol';
import type { SceneCrossings } from '@dnd/mechanics/crossings';

/** The parts of the loaded map a crossing is judged against. */
export interface CrossingMap {
  layers: readonly Layer[];
  levels?: readonly Pick<Level, 'id'>[];
  mapSettings: { crossingKinds?: CrossingKind[] };
}

export interface HopVerdict {
  /** The crossings worth a chip, in order along the hop (up to the refusal, if any). */
  chips: Crossing[];
  /** The first crossing that refuses this seat's move, or null when the move stands. */
  refused: Crossing | null;
}

/**
 * Judge one hop of a drag. Every crossing is resolved; the chips are the ones the plan says
 * to show (cliffs always, slopes and bare edges only when not Free), and a crossing
 * whose kind blocks refuses the move for a player. The DM's own drags are never refused.
 */
export function judgeHop(
  map: CrossingMap,
  levelId: string | undefined,
  from: readonly [number, number],
  to: readonly [number, number],
  live: SceneCrossings,
  role: Role | undefined,
): HopVerdict {
  const layers = layersOnLevel(map, map.layers as Layer[], levelId || firstLevelId(map));
  const kinds = map.mapSettings.crossingKinds ?? defaultCrossingKinds();
  const all = crossingsAlongLayers(layers, [from[0], from[1]], [to[0], to[1]], kinds, live);
  const refused = role === 'dm' ? null : (all.find((c) => c.blocks) ?? null);
  const upTo = refused ? all.slice(0, all.indexOf(refused) + 1) : all;
  return { chips: upTo.filter((c) => c.chip || c === refused), refused };
}

/** What a chip says: the kind's name (and that it stopped the move), and the DM's note. */
export function chipWords(c: Crossing, refused: boolean): { title: string; note: string | null } {
  const name = c.kind?.name ?? c.kindId;
  return { title: refused ? `${name} — you can't cross here` : name, note: c.kind?.note ?? null };
}

/** A raised edge the DM pointed at, and what it is played as. */
export interface CrossingTarget {
  /** The plateau's id (its whole raised edge). */
  targetId: string;
  what: 'cliff' | 'slope' | 'none';
  /** Where the menu opens, world cells. */
  x: number;
  y: number;
  /** The kind the map gives it when the DM has not picked one live. */
  mapKindId: string;
}

const PICK_REACH = 0.45;

function segDistance(px: number, py: number, a: readonly number[], b: readonly number[]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy;
  const u = L2 > 0 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / L2)) : 0;
  return Math.hypot(px - (a[0] + dx * u), py - (a[1] + dy * u));
}

/**
 * The raised edge under (x, y) on the given level, nearest first; null on open ground.
 */
export function crossingTargetAt(map: CrossingMap, levelId: string | undefined, x: number, y: number): CrossingTarget | null {
  const layers = layersOnLevel(map, map.layers as Layer[], levelId || firstLevelId(map));
  let best: (CrossingTarget & { d: number }) | null = null;
  for (const layer of layers) {
    for (const band of layerPlateaus(layer).bands) {
      band.rings.forEach((ring, ri) => {
        band.edges[ri].forEach((e, i) => {
          if (!e.owner || e.drop === 0) return;
          const d = segDistance(x, y, ring[i], ring[(i + 1) % ring.length]);
          if (d > PICK_REACH || (best && best.d <= d)) return;
          best = { targetId: e.owner.id, what: e.edge as 'cliff' | 'slope' | 'none', x, y, mapKindId: crossingIdOf(e.owner), d };
        });
      });
    }
  }
  if (!best) return null;
  const found = best as CrossingTarget & { d: number };
  return { targetId: found.targetId, what: found.what, x: found.x, y: found.y, mapKindId: found.mapKindId };
}
