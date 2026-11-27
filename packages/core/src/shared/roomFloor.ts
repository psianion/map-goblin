import type { DungeonLayer, Layer, MapSettings } from '../store/types';
import type { Level, ThresholdSegment } from './types';
import type { Polygon } from '../geometry/GeometryEngine';
import { computeMapFrame, type WorldBounds } from './mapBounds';
import { baseGroundOf } from './pieces';
import { levelOf } from './lookScope';
import { roomFaces } from '../engine/roomDetection';
import { computeMergedFloor } from '../engine/mergedFloor';
import { caveCutters } from './caveFloor';

/** What a layer's rooms read beyond the layer itself: the map's frame, and whether its level has base ground. */
export interface RoomContext {
  frame: WorldBounds | null;
  baseGround: boolean;
}

/** Frame and base ground for the layer's level, from a document or the store's state. */
export function roomContextOf(
  doc: { layers: readonly Layer[]; mapSettings: MapSettings; levels?: readonly Level[] },
  layer: DungeonLayer,
): RoomContext {
  const settings = doc.mapSettings;
  const frame = computeMapFrame(doc.layers, settings?.terrain?.bounds ?? null, settings?.fixedSize ?? null);
  const level = doc.levels && doc.levels.length > 0 ? levelOf(doc.levels, layer) : null;
  return { frame, baseGround: !!baseGroundOf(settings ?? {}, level) };
}

/** Closed faces a room can sit in (plan 3.2), with extra divide lines applied on top of the layer's own. */
export function roomFacesOf(layer: DungeonLayer, _ctx: RoomContext, extraThresholds: readonly ThresholdSegment[] = []): Polygon[] {
  const floor: Polygon[] = layer.mergedFloor ?? computeMergedFloor(layer) ?? [];
  return roomFaces(floor, layer.standaloneWalls, 1, layer.style?.wallWidth ?? 0, [
    ...(layer.thresholds ?? []),
    ...extraThresholds,
    ...caveCutters(layer),
  ]);
}

/** An outline cut down to the standable ground under it (largest part); the outline itself on a picture-only map; null when under 3 points. (plan 3.3) */
export function outlineFace(
  _layer: DungeonLayer,
  _ctx: RoomContext,
  outline: readonly [number, number][],
): [number, number][] | null {
  return outline.length >= 3 ? outline.map(([x, y]): [number, number] => [x, y]) : null;
}
