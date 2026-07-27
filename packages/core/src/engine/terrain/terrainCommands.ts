import type { Command } from '../../store/types';
import { getTerrainRenderer, type StrokeRegionSnapshot } from './TerrainRenderer';

/**
 * Ceiling on raw pixel snapshots held across the whole undo history. A single
 * long diagonal drag can snapshot a near-full 2048x2048 region twice per
 * splatmap (~64MB); undoManager keeps 100 commands, so an unbounded history
 * runs the tab out of memory.
 */
export const SNAPSHOT_BUDGET_BYTES = 192 * 1024 * 1024;

/** Commands still holding buffers, oldest first. */
const retained: TerrainStrokeCommand[] = [];
let retainedBytes = 0;

function retain(cmd: TerrainStrokeCommand, bytes: number): void {
  retained.push(cmd);
  retainedBytes += bytes;
  // ponytail: oldest terrain strokes lose their pixels first and their
  // undo/redo degrades to a no-op. Swap for on-disk/compressed snapshots if
  // deep terrain history ever matters more than the memory.
  while (retainedBytes > SNAPSHOT_BUDGET_BYTES && retained.length > 1) {
    retained[0].cleanup();
  }
}

function release(cmd: TerrainStrokeCommand, bytes: number): void {
  const i = retained.indexOf(cmd);
  if (i === -1) return;
  retained.splice(i, 1);
  retainedBytes -= bytes;
}

/**
 * One brush stroke on the terrain splatmap.
 * Holds raw before/after pixel snapshots of the stroke's dirty region only.
 * cleanup() frees the buffers when the command falls off undo history.
 */
export class TerrainStrokeCommand implements Command {
  readonly label = 'Paint terrain';
  private snapshots: StrokeRegionSnapshot[] | null;
  private bytes: number;
  /** The stroke already painted the live RT — first execute() is a no-op. */
  private applied = true;

  constructor(snapshots: StrokeRegionSnapshot[]) {
    this.snapshots = snapshots;
    this.bytes = snapshots.reduce((n, s) => n + s.before.byteLength + s.after.byteLength, 0);
    retain(this, this.bytes);
  }

  execute(): void {
    if (this.applied) {
      this.applied = false;
      return;
    }
    const r = getTerrainRenderer();
    if (!r || !this.snapshots) return;
    for (const s of this.snapshots) {
      r.restoreRegion(s.rtIndex, s.rect, s.after);
    }
  }

  undo(): void {
    const r = getTerrainRenderer();
    if (!r || !this.snapshots) return;
    for (const s of this.snapshots) {
      r.restoreRegion(s.rtIndex, s.rect, s.before);
    }
  }

  cleanup(): void {
    if (!this.snapshots) return;
    this.snapshots = null;
    release(this, this.bytes);
  }
}
