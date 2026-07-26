import type { Command } from '../../store/types';
import { getTerrainRenderer, type StrokeRegionSnapshot } from './TerrainRenderer';

/**
 * One brush stroke on the terrain splatmap.
 * Holds raw before/after pixel snapshots of the stroke's dirty region only.
 * cleanup() frees the buffers when the command falls off undo history.
 */
export class TerrainStrokeCommand implements Command {
  readonly label = 'Paint terrain';
  private snapshots: StrokeRegionSnapshot[] | null;
  /** The stroke already painted the live RT — first execute() is a no-op. */
  private applied = true;

  constructor(snapshots: StrokeRegionSnapshot[]) {
    this.snapshots = snapshots;
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
    this.snapshots = null;
  }
}
