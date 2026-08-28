/**
 * Splat worker state machine — pure logic, no Worker globals, so vitest can
 * drive it directly. The worker shell (splatWorker.ts) wires messages to
 * these functions; PNG encode/decode live in the shell because they need
 * OffscreenCanvas/createImageBitmap.
 *
 * The worker owns the canonical CPU copy of the splatmaps (two weight maps
 * and the tint layer). The main thread paints on the GPU and posts region
 * patches here at stroke end / undo / redo; at flush time the worker computes
 * painted bounds and encodes dirty maps to PNG entirely off the main thread.
 */
import {
  SPLAT_SIZE,
  applySplatPatch,
  splatBounds,
  unionBounds,
  SPLAT_MAP_INDICES,
  TINT_MAP_INDEX,
  type SplatMapIndex,
  type SplatRect,
  type TerrainBounds,
} from './terrainShared';

export interface SplatState {
  /** null until first seed/patch — a map with no terrain never allocates. */
  splats: [Uint8Array | null, Uint8Array | null, Uint8Array | null];
  dirty: [boolean, boolean, boolean];
}

export function createSplatState(): SplatState {
  return { splats: [null, null, null], dirty: [false, false, false] };
}

function ensure(state: SplatState, rtIndex: SplatMapIndex): Uint8Array {
  let s = state.splats[rtIndex];
  if (!s) {
    s = new Uint8Array(SPLAT_SIZE * SPLAT_SIZE * 4);
    state.splats[rtIndex] = s;
  }
  return s;
}

/** Replace a whole splat from decoded PNG pixels (map load), or clear it. */
export function seed(state: SplatState, rtIndex: SplatMapIndex, pixels: Uint8Array | null): void {
  if (pixels) {
    ensure(state, rtIndex).set(pixels);
  } else if (state.splats[rtIndex]) {
    state.splats[rtIndex]!.fill(0);
  }
  // Seeds come from persisted data — nothing new to encode.
  state.dirty[rtIndex] = false;
}

/** Apply a stroke/undo region patch. */
export function patch(
  state: SplatState,
  rtIndex: SplatMapIndex,
  rect: SplatRect,
  pixels: Uint8Array,
): void {
  applySplatPatch(ensure(state, rtIndex), rect, pixels);
  state.dirty[rtIndex] = true;
}

export interface FlushResult {
  bounds: TerrainBounds | null;
  /** Indices whose pixels changed since the last flush — these need encoding. */
  dirtyIndices: SplatMapIndex[];
}

/**
 * Bounds are always recomputed by full scan here — 8M iterations is tens of
 * ms in a worker, which buys exact shrink-on-erase behavior with none of the
 * incremental-AABB bookkeeping the main thread used to do.
 */
export function flush(state: SplatState): FlushResult {
  let bounds: TerrainBounds | null = null;
  for (const rtIndex of SPLAT_MAP_INDICES) {
    // Tint has no weight of its own — a tinted texel whose weights were erased
    // draws nothing, so only the weight maps decide the painted extent.
    if (rtIndex === TINT_MAP_INDEX) continue;
    const s = state.splats[rtIndex];
    if (s) bounds = unionBounds(bounds, splatBounds(s));
  }
  const dirtyIndices = SPLAT_MAP_INDICES.filter((i) => state.dirty[i]);
  for (const i of dirtyIndices) state.dirty[i] = false;
  return { bounds, dirtyIndices };
}

export function reset(state: SplatState): void {
  state.splats = [null, null, null];
  state.dirty = [false, false, false];
}
