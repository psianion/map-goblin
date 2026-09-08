// Foundry VTT scene reader. Input is one Scene document: a line of a compendium
// `.db` (NeDB, one JSON object per line), or the per-scene "Export Data" JSON.
// Coordinates are canvas pixels *including the scene padding* — Foundry pads the
// canvas by `padding × size` rounded up to whole cells and places the map image at
// that offset — so every point is shifted back before the divide by grid size.

import type { DoorState, WallDirection, WallType } from '../types';
import type { ImportedDoor, ImportedImage, ImportedLight, ImportedMap, ImportedWall } from './types';
import { ambientForDarkness, round3 } from './types';

export interface FoundryWall {
  c: [number, number, number, number];
  move?: number;
  sight?: number;
  /** v9 name for `sight`. */
  sense?: number;
  light?: number;
  door?: number;
  ds?: number;
  dir?: number;
  flags?: { 'wall-height'?: { top?: number | null; bottom?: number | null } };
}

interface FoundryLightConfig {
  dim?: number;
  bright?: number;
  angle?: number;
  color?: string | null;
  alpha?: number;
}

export interface FoundryLight extends FoundryLightConfig {
  x: number;
  y: number;
  hidden?: boolean;
  config?: FoundryLightConfig;
  /** v9 names. */
  tintColor?: string | null;
}

export interface FoundryScene {
  name?: string;
  width?: number;
  height?: number;
  padding?: number;
  grid?: number | { size?: number; distance?: number };
  gridDistance?: number;
  img?: string | null;
  background?: { src?: string | null };
  thumb?: string | null;
  walls?: FoundryWall[];
  lights?: FoundryLight[];
  darkness?: number;
  tiles?: unknown[];
  drawings?: unknown[];
  tokens?: unknown[];
  notes?: unknown[];
  sounds?: unknown[];
  flags?: { levels?: { sceneLevels?: unknown[] } };
}

/** Split a NeDB compendium into its scene documents, skipping NeDB's own bookkeeping lines. */
export function parseFoundryDb(text: string): FoundryScene[] {
  const scenes: FoundryScene[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let doc: unknown;
    try {
      doc = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (isFoundryScene(doc)) scenes.push(doc);
  }
  return scenes;
}

export function isFoundryScene(doc: unknown): doc is FoundryScene {
  if (!doc || typeof doc !== 'object') return false;
  const d = doc as Record<string, unknown>;
  if ('$$deleted' in d || '$$indexCreated' in d) return false;
  return Array.isArray(d.walls) && typeof d.width === 'number' && typeof d.height === 'number';
}

/** Several floors stacked on one canvas by the Levels module — one map per floor is ours, not this. */
export function isFoundryComposite(scene: FoundryScene): boolean {
  return (scene.flags?.levels?.sceneLevels?.length ?? 0) > 1;
}

/**
 * The image path relative to the module or world root, URL-decoded:
 * `modules/x/map-assets/Axeholm%20v1.webp` → `map-assets/Axeholm v1.webp`.
 */
export function foundryImagePath(scene: FoundryScene): string | null {
  const raw = scene.background?.src ?? scene.img ?? null;
  if (!raw) return null;
  let path: string;
  try {
    path = decodeURIComponent(raw);
  } catch {
    path = raw;
  }
  return path.replace(/^\/?(modules|worlds|systems)\/[^/]+\//, '');
}

function gridSize(scene: FoundryScene): number {
  return (typeof scene.grid === 'number' ? scene.grid : scene.grid?.size) ?? 100;
}

function gridDistance(scene: FoundryScene): number {
  return (typeof scene.grid === 'object' ? scene.grid?.distance : undefined) ?? scene.gridDistance ?? 5;
}

/** Canvas offset of the map image — Foundry's own rounding, whole cells up. */
export function foundryPadding(scene: FoundryScene): { x: number; y: number } {
  const g = gridSize(scene);
  const p = scene.padding ?? 0.25;
  return {
    x: Math.ceil((p * (scene.width ?? 0)) / g) * g,
    y: Math.ceil((p * (scene.height ?? 0)) / g) * g,
  };
}

const DIRECTIONS: WallDirection[] = ['both', 'left', 'right'];
const DOOR_STATES: DoorState[] = ['closed', 'open', 'locked'];
const DEFAULT_LIGHT = '#ffdd88';

/** Foundry's restriction codes: 0 none, 10 limited, 20 normal, 30 proximity, 40 distance. */
function wallTypeOf(w: FoundryWall): WallType | null {
  const sight = w.sight ?? w.sense ?? 20;
  const move = w.move ?? 20;
  if (sight === 0 && move === 0) return null;
  if (sight === 0) return 'invisible';
  if (move === 0) return 'ethereal';
  if (sight === 10) return 'terrain';
  return 'normal';
}

type Band = { top: number; bottom: number } | null;

function bandOf(w: FoundryWall): Band {
  const wh = w.flags?.['wall-height'];
  if (!wh) return null;
  const top = wh.top ?? Infinity;
  const bottom = wh.bottom ?? -Infinity;
  if (top === Infinity && bottom === -Infinity) return null;
  return { top, bottom };
}

const bandKey = (b: Band): string => (b ? `${b.bottom}..${b.top}` : '');

/**
 * Which elevation bands to keep. One band (or none) means a single floor, keep it all.
 * Several means a Levels composite: keep the ground band (the one holding elevation 0,
 * else the lowest non-negative one) plus unbanded walls.
 */
function keptBands(walls: FoundryWall[]): Set<string> | null {
  const bands = new Map<string, Band>();
  for (const w of walls) {
    const b = bandOf(w);
    if (b) bands.set(bandKey(b), b);
  }
  if (bands.size <= 1) return null;
  const ground =
    [...bands.values()].find((b) => b!.bottom <= 0 && 0 <= b!.top) ??
    [...bands.values()].filter((b) => b!.bottom >= 0).sort((a, b) => a!.bottom - b!.bottom)[0] ??
    null;
  return new Set(['', ground ? bandKey(ground) : '']);
}

export function readFoundryScene(scene: FoundryScene, image: ImportedImage | null): ImportedMap {
  const g = gridSize(scene);
  const feet = gridDistance(scene);
  const pad = foundryPadding(scene);
  const warnings: string[] = [];
  const px = (x: number, y: number): [number, number] => [round3((x - pad.x) / g), round3((y - pad.y) / g)];

  const allWalls = scene.walls ?? [];
  const keep = keptBands(allWalls);
  const walls: ImportedWall[] = [];
  const doors: ImportedDoor[] = [];
  let offFloor = 0;
  let inert = 0;
  for (const w of allWalls) {
    if (!Array.isArray(w.c) || w.c.length !== 4) continue;
    if (keep && !keep.has(bandKey(bandOf(w)))) {
      offFloor++;
      continue;
    }
    const a = px(w.c[0], w.c[1]);
    const b = px(w.c[2], w.c[3]);
    if ((w.door ?? 0) > 0) {
      const sight = w.sight ?? w.sense ?? 20;
      doors.push({
        a,
        b,
        state: DOOR_STATES[w.ds ?? 0] ?? 'closed',
        isSecret: w.door === 2,
        archway: sight === 0,
      });
      continue;
    }
    const wallType = wallTypeOf(w);
    if (!wallType) {
      inert++;
      continue;
    }
    walls.push({ points: [a, b], wallType, direction: DIRECTIONS[w.dir ?? 0] ?? 'both' });
  }
  if (offFloor) warnings.push(`${offFloor} walls on other floors skipped (multi-floor scene)`);
  if (inert) warnings.push(`${inert} walls that block nothing skipped`);

  const lights: ImportedLight[] = [];
  let cones = 0;
  for (const l of scene.lights ?? []) {
    const c = l.config ?? l;
    const dim = Math.max(c.dim ?? 0, c.bright ?? 0);
    if (!(dim > 0)) continue;
    const bright = Math.min(c.bright ?? 0, dim);
    const angle = c.angle ?? 0;
    if (angle > 0 && angle < 360) cones++;
    const [x, y] = px(l.x, l.y);
    const color = c.color ?? l.tintColor ?? null;
    lights.push({
      x,
      y,
      radius: round3(dim / feet),
      featherRadius: round3((dim - bright) / feet),
      color: color && /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : DEFAULT_LIGHT,
      // ponytail: Foundry's alpha is colour blend, not brightness; our default intensity reads right.
      intensity: 0.9,
      hidden: l.hidden === true,
    });
  }
  if (cones) warnings.push(`${cones} cone lights imported as full circles`);

  const dropped: string[] = [];
  const count = (k: keyof FoundryScene, label: string) => {
    const n = (scene[k] as unknown[] | undefined)?.length ?? 0;
    if (n) dropped.push(`${n} ${label}`);
  };
  count('tiles', 'tiles');
  count('drawings', 'drawings');
  count('tokens', 'tokens');
  count('notes', 'notes');
  count('sounds', 'sounds');
  if (dropped.length) warnings.push(`not imported: ${dropped.join(', ')}`);
  if (!image) warnings.push('no map image — walls only');

  return {
    name: scene.name?.trim() || 'Imported scene',
    size: { width: Math.ceil((scene.width ?? 0) / g), height: Math.ceil((scene.height ?? 0) / g) },
    image,
    walls,
    doors,
    lights,
    ambientLight: ambientForDarkness(scene.darkness ?? 0),
    warnings,
  };
}
