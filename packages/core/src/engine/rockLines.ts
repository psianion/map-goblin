// The editor's half of the rock line (`DungeonLayer.rockLines`): what a pack-measured kit laid,
// written to the layer for light, sight and movement to block along (raycaster.ts) wherever the
// map is read, the table server included, which has no catalog and lays nothing itself.

import type { DungeonLayer, RockLine } from '../store/types';
import type { Polygon } from '../types/geometry';
import { useStore } from '../store/store';
import { caveEdges } from '../shared/caveFloor';
import { laidFor } from '../shared/rockLines';
import { seatLine } from './caveBandRenderer';
import { ledgeRuns } from './plateauRenderer';
import type { WalkPlacement } from './caveWalk';

const round = ([x, y]: [number, number]): [number, number] => [Math.round(x * 100) / 100, Math.round(y * 100) / 100];

/**
 * The line one ring's rock was laid on: `edge` the ring as the walk took it, and the rock's
 * seat line (`seatLine`) split into its runs wherever the rock stops. A ring laid whole is one
 * run that ends where it starts. Null when the walk laid nothing.
 */
export function rockLineOf(edge: Polygon, placed: WalkPlacement[]): RockLine | null {
  const runs = ledgeRuns(placed, true)
    .map(({ run, open }) => {
      const line = seatLine(run).map(round);
      return open || line.length === 0 ? line : [...line, line[0]];
    })
    .filter((run) => run.length >= 2);
  return runs.length === 0 ? null : { edge: edge.map(round), closed: true, runs };
}

/** What each half of the renderer last laid on a layer: the floor rings, and the painted caves. */
const laid = new Map<string, { floor?: RockLine[]; cave?: RockLine[] }>();

/**
 * Writes what `part` laid on layer `layerId` (`lines`) to the store with what the other part
 * last laid, without an undo step and only when the list changes; a layer with none has the
 * field removed. A ring of `missing` (its kit is not installed, so nothing was laid round it)
 * keeps the entry stored for it, so a map opened without its pack keeps the lines it was saved
 * with. Until the other part has laid anything here, its share is read off the store: the
 * entries laid for a painted cave's ring are the caves', the rest the floor's.
 */
export function storeRockLines(layerId: string, part: 'floor' | 'cave', lines: RockLine[], missing: Polygon[]): void {
  const layer = useStore.getState().layers.find((l): l is DungeonLayer => l.id === layerId && l.type === 'dungeon');
  if (!layer) return;
  const stored = layer.rockLines ?? [];
  const record = laid.get(layerId) ?? {};
  record[part] = [...lines, ...stored.filter((e) => missing.some((ring) => laidFor(e, ring)))];
  laid.set(layerId, record);
  const caveRings = (record.floor && record.cave) || stored.length === 0 ? [] : caveEdges(layer).flatMap((c) => c.rings);
  const ofCave = (e: RockLine): boolean => caveRings.some((ring) => laidFor(e, ring));
  const next = [...(record.floor ?? stored.filter((e) => !ofCave(e))), ...(record.cave ?? stored.filter(ofCave))];
  if (JSON.stringify(next) === JSON.stringify(stored)) return;
  useStore.setState((s) => {
    const l = s.layers.find((la) => la.id === layerId);
    if (!l || l.type !== 'dungeon') return;
    if (next.length > 0) l.rockLines = next;
    else delete l.rockLines;
  });
}
