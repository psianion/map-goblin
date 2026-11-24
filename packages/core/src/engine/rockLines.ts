// The editor's half of the rock line (`DungeonLayer.rockLines`): what a pack-measured kit laid,
// written to the layer for light, sight and movement to block along (raycaster.ts) wherever the
// map is read, the table server included, which has no catalog and lays nothing itself.

import type { DungeonLayer, RockLine } from '../store/types';
import type { Polygon } from '../types/geometry';
import { useStore } from '../store/store';
import { caveEdges } from '../shared/caveFloor';
import { laidFor } from '../shared/rockLines';
import { seatLine } from './caveBandRenderer';
import { cliffKey, laidRuns, ledgeRuns, walkCliff, type CliffWalks } from './plateauRenderer';
import { cliffChoice } from './plateauKit';
import { isBandSet, isMeasuredBandSet } from '../assets/packCatalog';
import { hasPlateaus, layerPlateaus, type EdgeRun } from '../shared/plateaus';
import type { WalkPlacement } from './caveWalk';

const round = ([x, y]: [number, number]): [number, number] => [Math.round(x * 100) / 100, Math.round(y * 100) / 100];

/**
 * The line one ring's rock was laid on: `edge` the ring as the walk took it, and the rock's
 * seat line (`seatLine`) split into its runs wherever the rock stops. A ring laid whole is one
 * run that ends where it starts. Null when the walk laid nothing. `closed` false: an open run
 * walked as a chain.
 */
export function rockLineOf(edge: Polygon, placed: WalkPlacement[], closed = true): RockLine | null {
  const runs = ledgeRuns(placed, closed)
    .map(({ run, open }) => {
      const line = seatLine(run).map(round);
      return open || line.length === 0 ? line : [...line, line[0]];
    })
    .filter((run) => run.length >= 2);
  return runs.length === 0 ? null : { edge: edge.map(round), closed, runs };
}

/** The line a plateau's cliff run was laid on with its own measured kit: `edge` the run as drawn. */
export function cliffLineOf(run: Pick<EdgeRun, 'points' | 'closed'>, placed: WalkPlacement[]): RockLine | null {
  const line = rockLineOf(run.points, placed, run.closed);
  return line && { kind: 'cliff', ...line };
}

/**
 * Every plateau cliff run of a layer walked (`walkCliff`), stretch by stretch off the walls
 * (`LaidRun.cliffs`, along the walls' lines only), and the line each stretch laid with a
 * measured kit of its own left: a run along no wall is one closed line, each stretch of one
 * that meets a wall an open line, and the wall's line stands for the rest. `missing`: the runs
 * whose kit is not installed.
 */
export function cliffRockLines(layer: DungeonLayer): { walks: CliffWalks; lines: RockLine[]; missing: Polygon[] } {
  const walks: CliffWalks = new Map();
  const lines: RockLine[] = [];
  const missing: Polygon[] = [];
  if (!hasPlateaus(layer)) return { walks, lines, missing };
  for (const band of layerPlateaus(layer).bands) {
    const byRun = new Map<string, WalkPlacement[][]>();
    for (const { run, cliffs } of laidRuns(layer, band)) {
      if (!cliffs) continue;
      const placed = cliffs.map((c) => walkCliff(c.run, c.merged));
      byRun.set(cliffKey(run), placed);
      const { setId } = cliffChoice(run.owner?.edgeArt);
      if (!isBandSet(setId)) missing.push(run.points);
      else if (isMeasuredBandSet(setId)) {
        cliffs.forEach((c, i) => {
          const line = cliffLineOf(c.run, placed[i]);
          if (line) lines.push(line);
        });
      }
    }
    walks.set(band, byRun);
  }
  return { walks, lines, missing };
}

/** Whether two lists of rock lines are the same, point for point: what a rebuild that changed nothing stores. */
function sameLines(a: readonly RockLine[], b: readonly RockLine[]): boolean {
  const samePts = (p: readonly (readonly number[])[], q: readonly (readonly number[])[]): boolean => p.length === q.length && p.every((v, i) => v[0] === q[i][0] && v[1] === q[i][1]);
  return (
    a.length === b.length &&
    a.every((x, i) => {
      const y = b[i];
      return x.kind === y.kind && x.closed === y.closed && samePts(x.edge, y.edge) && x.runs.length === y.runs.length && x.runs.every((r, k) => samePts(r, y.runs[k]));
    })
  );
}

/** What each part of the renderer last laid on a layer: the floor rings, the painted caves, and the plateau cliffs. */
const laid = new Map<string, { floor?: RockLine[]; cave?: RockLine[]; cliff?: RockLine[] }>();

/**
 * Writes what `part` laid on layer `layerId` (`lines`) to the store with what the other parts
 * last laid, without an undo step and only when the list changes; a layer with none has the
 * field removed. A ring or run of `missing` (its kit is not installed, so nothing was laid
 * round it) keeps the entry stored for it, so a map opened without its pack keeps the lines it
 * was saved with. Until another part has laid anything here, its share is read off the store:
 * the cliff entries are the cliffs', the entries laid for a painted cave's ring the caves', the
 * rest the floor's.
 */
export function storeRockLines(layerId: string, part: 'floor' | 'cave' | 'cliff', lines: RockLine[], missing: Polygon[]): void {
  const layer = useStore.getState().layers.find((l): l is DungeonLayer => l.id === layerId && l.type === 'dungeon');
  if (!layer) return;
  const stored = layer.rockLines ?? [];
  const record = laid.get(layerId) ?? {};
  const own = (e: RockLine): boolean => (e.kind === 'cliff') === (part === 'cliff');
  record[part] = [...lines, ...stored.filter((e) => own(e) && missing.some((ring) => laidFor(e, ring)))];
  laid.set(layerId, record);
  const walls = stored.filter((e) => e.kind !== 'cliff');
  const caveRings = (record.floor && record.cave) || walls.length === 0 ? [] : caveEdges(layer).flatMap((c) => c.rings);
  const ofCave = (e: RockLine): boolean => caveRings.some((ring) => laidFor(e, ring));
  const next = [
    ...(record.floor ?? walls.filter((e) => !ofCave(e))),
    ...(record.cave ?? walls.filter(ofCave)),
    ...(record.cliff ?? stored.filter((e) => e.kind === 'cliff')),
  ];
  if (sameLines(next, stored)) return;
  useStore.setState((s) => {
    const l = s.layers.find((la) => la.id === layerId);
    if (!l || l.type !== 'dungeon') return;
    if (next.length > 0) l.rockLines = next;
    else delete l.rockLines;
  });
}
