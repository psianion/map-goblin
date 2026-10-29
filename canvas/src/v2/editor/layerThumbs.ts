import { useSyncExternalStore } from 'react';
import { useStore } from '@/store/store';
import { TERRAIN_PANEL_ID, type Layer, type TerrainData } from '@/store/types';

/**
 * Filmstrip thumbnails: which tile wants a picture, when to paint it, and where the
 * pictures are kept. The painting itself (Pixi) lives in `layerThumbRender.ts`; everything
 * here is plain scheduling so it can be tested without a renderer.
 */

/** CSS size of a thumbnail, before device pixels. */
export const THUMB_CSS_PX = 40;
/** Quiet time after the last edit before a tile is repainted. */
export const THUMB_DEBOUNCE_MS = 300;
/** One more pass after a map opens, for textures that arrive after the first paint. */
export const THUMB_LATE_MS = 1000;
/** Key of the Terrain tile; every other key is a layer id. */
export const TERRAIN_THUMB = TERRAIN_PANEL_ID;

/** Device pixels for a square thumbnail: 40 CSS px at up to 2x. */
export function thumbPixels(dpr: number): number {
  const ratio = Math.min(Number.isFinite(dpr) && dpr > 0 ? dpr : 1, 2);
  return Math.round(THUMB_CSS_PX * ratio);
}

export interface WorldRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** World to thumbnail: the frame fitted into a `px` square, aspect kept, centred. */
export function fitFrame(frame: WorldRect, px: number): { scale: number; tx: number; ty: number } {
  const w = Math.max(frame.maxX - frame.minX, 1e-6);
  const h = Math.max(frame.maxY - frame.minY, 1e-6);
  const scale = Math.min(px / w, px / h);
  return {
    scale,
    tx: (px - w * scale) / 2 - frame.minX * scale,
    ty: (px - h * scale) / 2 - frame.minY * scale,
  };
}

/** What the thumbnails depend on, read off the store. */
export interface ThumbSnapshot {
  mapId: string | null;
  layers: Layer[];
  terrain: TerrainData | undefined;
  splatRev: number;
}

type StoreState = ReturnType<typeof useStore.getState>;

export function snapshotOf(s: StoreState): ThumbSnapshot {
  return {
    mapId: s.activeMapId,
    layers: s.layers,
    terrain: s.mapSettings.terrain,
    splatRev: s.terrainSplats?.rev ?? 0,
  };
}

/**
 * The tiles that show a picture. Dungeon layers always do (an empty layer is a blank tile);
 * the Background only with a texture (a flat colour keeps its swatch); Terrain only once
 * something is painted (otherwise it keeps its icon).
 */
export function thumbKeys(snap: Pick<ThumbSnapshot, 'layers' | 'terrain'>): string[] {
  const keys: string[] = [];
  for (const layer of snap.layers) {
    if (layer.type === 'dungeon') keys.push(layer.id);
    else if (layer.type === 'background' && layer.backgroundTexture) keys.push(layer.id);
  }
  if (snap.terrain?.bounds) keys.push(TERRAIN_THUMB);
  return keys;
}

export interface ThumbDiff {
  /** A different map (or the first look): every picture is stale. */
  opened: boolean;
  /** Tiles to repaint. */
  dirty: string[];
  /** Pictures to forget: their tile is gone or no longer shows one. */
  drop: string[];
}

/** What changed between two snapshots, by layer object identity. */
export function diffThumbs(prev: ThumbSnapshot | null, next: ThumbSnapshot): ThumbDiff {
  const nextKeys = thumbKeys(next);
  const prevKeys = prev ? thumbKeys(prev) : [];
  const nextSet = new Set(nextKeys);
  const drop = prevKeys.filter((k) => !nextSet.has(k));

  const prevIds = new Set(prev?.layers.map((l) => l.id) ?? []);
  const shared = next.layers.some((l) => prevIds.has(l.id));
  const opened = !prev || prev.mapId !== next.mapId || (next.layers.length > 0 && !shared);
  if (opened) return { opened, dirty: nextKeys, drop };

  const prevById = new Map(prev.layers.map((l) => [l.id, l]));
  const nextById = new Map(next.layers.map((l) => [l.id, l]));
  const prevSet = new Set(prevKeys);
  const dirty = nextKeys.filter((key) => {
    if (!prevSet.has(key)) return true;
    if (key === TERRAIN_THUMB) return prev.terrain !== next.terrain || prev.splatRev !== next.splatRev;
    return prevById.get(key) !== nextById.get(key);
  });
  return { opened, dirty, drop };
}

/** Timers the scheduler runs on; injectable for tests. */
export interface ThumbClock {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  requestFrame(fn: () => void): unknown;
  cancelFrame(handle: unknown): void;
}

export const browserClock: ThumbClock = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
  requestFrame: (fn) => globalThis.requestAnimationFrame(() => fn()),
  cancelFrame: (h) => globalThis.cancelAnimationFrame(h as number),
};

/**
 * Debounced, one-per-frame painting. Marked keys wait until edits have been quiet for the
 * debounce, then paint one tile per animation frame so a drag never stalls on thumbnails.
 */
export class ThumbScheduler {
  private waiting = new Set<string>();
  private queue: string[] = [];
  private timer: unknown = null;
  private frame: unknown = null;
  private readonly paint: (key: string) => void;
  private readonly clock: ThumbClock;
  private readonly debounceMs: number;

  constructor(paint: (key: string) => void, clock: ThumbClock = browserClock, debounceMs = THUMB_DEBOUNCE_MS) {
    this.paint = paint;
    this.clock = clock;
    this.debounceMs = debounceMs;
  }

  /** Repaint these tiles once things are quiet (`delayMs` 0: on the next frame). */
  mark(keys: readonly string[], delayMs = this.debounceMs): void {
    if (keys.length === 0) return;
    for (const k of keys) this.waiting.add(k);
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      this.release();
    }, delayMs);
  }

  /** Stop waiting on these tiles. */
  forget(keys: readonly string[]): void {
    if (keys.length === 0) return;
    const gone = new Set(keys);
    for (const k of keys) this.waiting.delete(k);
    this.queue = this.queue.filter((k) => !gone.has(k));
  }

  /** Tiles still to paint, queued first, then waiting. */
  pending(): string[] {
    return [...new Set([...this.queue, ...this.waiting])];
  }

  dispose(): void {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    if (this.frame !== null) this.clock.cancelFrame(this.frame);
    this.timer = null;
    this.frame = null;
    this.waiting.clear();
    this.queue = [];
  }

  private release(): void {
    for (const k of this.waiting) if (!this.queue.includes(k)) this.queue.push(k);
    this.waiting.clear();
    this.ask();
  }

  private ask(): void {
    if (this.frame !== null || this.queue.length === 0) return;
    this.frame = this.clock.requestFrame(() => {
      this.frame = null;
      const key = this.queue.shift();
      try {
        if (key !== undefined) this.paint(key);
      } finally {
        this.ask();
      }
    });
  }
}

// Picture store

const thumbs = new Map<string, string>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

export function setThumb(key: string, url: string): void {
  if (thumbs.get(key) === url) return;
  thumbs.set(key, url);
  emit();
}

export function dropThumbs(keys: readonly string[]): void {
  let changed = false;
  for (const k of keys) changed = thumbs.delete(k) || changed;
  if (changed) emit();
}

/** Forget every picture whose tile no longer shows one. */
export function pruneThumbs(keep: readonly string[]): void {
  const live = new Set(keep);
  dropThumbs([...thumbs.keys()].filter((k) => !live.has(k)));
}

export function clearThumbs(): void {
  if (thumbs.size === 0) return;
  thumbs.clear();
  emit();
}

export function getThumb(key: string): string | undefined {
  return thumbs.get(key);
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The current picture for a tile, or undefined while it has none. */
export function useLayerThumb(key: string | undefined): string | undefined {
  return useSyncExternalStore(
    subscribe,
    () => (key ? thumbs.get(key) : undefined),
    () => undefined,
  );
}

// Driver

/**
 * Paints one tile and returns its picture: a URL, `null` for "nothing to paint, forget it",
 * or `undefined` for "cannot paint right now" (no canvas yet), which keeps what is shown.
 */
export type ThumbPainter = (key: string, layers: Layer[]) => string | null | undefined;

/**
 * Keep the filmstrip's pictures in step with the store until the returned stop is called:
 * all tiles on start, the edited ones after a quiet spell, and everything once more shortly
 * after a map opens.
 */
export function startLayerThumbs(paint: ThumbPainter, clock: ThumbClock = browserClock): () => void {
  let prev: ThumbSnapshot | null = null;
  let late: unknown = null;

  const scheduler = new ThumbScheduler((key) => {
    const s = useStore.getState();
    // A switch lands as a new map, which repaints everything.
    if (s.isMapSwitching) return;
    if (!thumbKeys(snapshotOf(s)).includes(key)) {
      dropThumbs([key]);
      return;
    }
    const url = paint(key, s.layers);
    if (url === null) dropThumbs([key]);
    else if (url !== undefined) setThumb(key, url);
  }, clock);

  const update = () => {
    const next = snapshotOf(useStore.getState());
    const diff = diffThumbs(prev, next);
    prev = next;
    scheduler.forget(diff.drop);
    pruneThumbs(thumbKeys(next));
    if (diff.opened) {
      scheduler.mark(diff.dirty, 0);
      if (late !== null) clock.clearTimeout(late);
      late = clock.setTimeout(() => {
        late = null;
        if (prev) scheduler.mark(thumbKeys(prev), 0);
      }, THUMB_LATE_MS);
    } else {
      scheduler.mark(diff.dirty);
    }
  };

  update();
  const unsubscribe = useStore.subscribe((s, p) => {
    if (
      s.layers !== p.layers ||
      s.activeMapId !== p.activeMapId ||
      s.mapSettings.terrain !== p.mapSettings.terrain ||
      s.terrainSplats?.rev !== p.terrainSplats?.rev
    ) {
      update();
    }
  });

  return () => {
    unsubscribe();
    scheduler.dispose();
    if (late !== null) clock.clearTimeout(late);
  };
}
