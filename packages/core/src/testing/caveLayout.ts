// src/testing/caveLayout.ts
//
// Test-only: every ring, run and cliff a layer's measured kits lay, laid the way a rebuild lays
// them (floor rings, then painted caves, their lines saved, then the plateau cliffs cut along
// those lines), each held to the rules in bandChecks.ts.

import { Container } from 'pixi.js';
import { isMeasuredBandSet } from '../assets/packCatalog';
import { bandConnectors, bandFloorFit, FIT_DOOR_PAD, fittedFloor, type FloorFit } from '../engine/caveBandRenderer';
import { kitOverlap, type WalkPlacement } from '../engine/caveWalk';
import { layerDrawStyle, layerLevelLook } from '../engine/levelLook';
import { laidCaves } from '../engine/material/materialRenderer';
import { computeMergedFloor } from '../engine/mergedFloor';
import { cliffChoice } from '../engine/plateauKit';
import { laidRuns, walkCliff } from '../engine/plateauRenderer';
import { rockLineOf } from '../engine/rockLines';
import { renderNodeWalls, type DoorGap } from '../engine/wallNodeRenderer';
import { layerPlateaus } from '../shared/plateaus';
import { edgeStyles, ringStyles } from '../shared/wallLook';
import { doorOpeningCuts, resolveDoors, resolveWalls } from '../shared/wallResolve';
import type { DungeonLayer, RockLine } from '../store/types';
import type { Polygon } from '../types/geometry';
import { checkBand, type BandCheck } from './bandChecks';

/** One ring, run or cliff stretch a measured kit laid, and what it measured. */
export interface LaidBand {
  kind: 'floor' | 'cave' | 'cliff';
  /** The drawn edge as the walk took it, void on its left. */
  ring: Polygon;
  closed: boolean;
  placed: WalkPlacement[];
  connectors: WalkPlacement[];
  gaps: DoorGap[];
  size: number;
  check: BandCheck;
}

/** What a layer's measured kits laid: each band, the floor fit, and the rock lines a rebuild saves. */
export interface LaidLayer {
  /** The layer with its union and its saved rock lines, as the cliffs were cut along them. */
  layer: DungeonLayer;
  bands: LaidBand[];
  fit: FloorFit;
  rockLines: RockLine[];
}

/** Every measured ring, painted cave and cliff stretch of `input`, laid and checked. */
export function layLayer(input: DungeonLayer): LaidLayer {
  let layer: DungeonLayer = { ...input, mergedFloor: input.mergedFloor ?? computeMergedFloor(input) };
  const rings = layer.mergedFloor ?? [];
  const walls = resolveWalls(layer);
  const doorGaps = resolveDoors(layer, walls)
    .filter((d) => d.door.visible)
    .flatMap((d) => doorOpeningCuts(d, walls)) as DoorGap[];
  const bands: LaidBand[] = [];
  const tips: Polygon[] = [];
  const gapsFit: Polygon[] = [];
  const lines: RockLine[] = [];
  const add = (kind: LaidBand['kind'], ring: Polygon, placed: WalkPlacement[], gaps: DoorGap[], size: number, floor: boolean, closed = true): void => {
    const set = placed.map((pl) => pl.piece);
    const connectors = bandConnectors(placed, set, size);
    let fitted: Polygon[] | undefined;
    if (floor) {
      const fit = bandFloorFit(ring, placed, gaps, size);
      tips.push(...fit.tips);
      gapsFit.push(...fit.gaps);
      fitted = fittedFloor([ring], fit);
      const line = rockLineOf(ring, placed);
      if (line) lines.push(line);
    }
    const check = checkBand({ ring, closed, placed, connectors, gaps, openings: kind === 'cliff' ? [] : layer.caveOpenings, floor: fitted, size, overlap: kitOverlap(set), doorPad: FIT_DOOR_PAD });
    bands.push({ kind, ring, closed, placed, connectors, gaps, size, check });
  };
  const level = layerLevelLook(layer);
  renderNodeWalls(new Container(), rings, layer.standaloneWalls.filter((w) => w.visible !== false), layerDrawStyle(layer), doorGaps, layer.floorWallEdits ?? {}, {
    ringStyles: ringStyles(layer, level),
    edgeStyles: edgeStyles(layer, level),
    openings: layer.caveOpenings,
    onBandLaid: ({ ring, placed, gaps, size }) => add('floor', ring, placed, gaps, size, true),
  });
  for (const laid of laidCaves(layer)) {
    if (!isMeasuredBandSet(laid.cave.material)) continue;
    laid.rings.forEach((ring, i) => add('cave', ring, laid.placed[i], laid.gaps, laid.size, true));
  }
  layer = { ...layer, rockLines: lines.length > 0 ? lines : undefined };
  for (const band of layerPlateaus(layer).bands) {
    for (const { run, cliffs } of laidRuns(layer, band)) {
      if (!cliffs || !isMeasuredBandSet(cliffChoice(run.owner?.edgeArt).setId)) continue;
      for (const c of cliffs) {
        const pts = c.run.drop > 0 ? c.run.points : [...c.run.points].reverse();
        add('cliff', pts, walkCliff(c.run), [], 1, false, c.run.closed);
      }
    }
  }
  return { layer, bands, fit: { tips, gaps: gapsFit }, rockLines: lines };
}
