/**
 * Spline path rendering — stubbed in v2.0 model.
 *
 * SplinePathRecord and DungeonLayer.paths have been removed from the store.
 * Spline paths are now represented as ShapeChild nodes with shapeType 'path'
 * inside DungeonLayer.children, rendered by the standard floor pipeline.
 *
 * These stubs keep floorWallRenderer.ts compiling while the new path
 * rendering pipeline is wired up.
 */

import type { DungeonLayer } from '../store/types';

/**
 * @deprecated Paths sublayer removed in v2.0 — no-op stub.
 */
export function rebuildPathsSublayer(_layer: DungeonLayer, _pathsContainer: unknown): void {
  // no-op: paths are now ShapeChild nodes rendered by floorWallRenderer
}

/**
 * @deprecated Paths sublayer removed in v2.0 — returns empty array.
 */
export function preloadPathTextures(_layer: DungeonLayer): Promise<unknown>[] {
  return [];
}
