// Universal VTT reader (.uvtt / .dd2vtt / .df2vtt — Dungeondraft, Dungeon Alchemist,
// Inkarnate, Arkenforge). Everything in the file is already in squares, so this is
// mostly a rename; the image rides along as base64 with no data: prefix.

import type { ImportedDoor, ImportedLight, ImportedMap, ImportedWall } from './types';
import { round3 } from './types';

interface Pt {
  x: number;
  y: number;
}

interface UvttFile {
  format?: number;
  resolution?: {
    map_origin?: Pt;
    map_size?: Pt;
    pixels_per_grid?: number;
  };
  line_of_sight?: Pt[][];
  objects_line_of_sight?: Pt[][];
  portals?: {
    position?: Pt;
    bounds?: Pt[];
    rotation?: number;
    closed?: boolean;
    freestanding?: boolean;
  }[];
  lights?: {
    position?: Pt;
    range?: number;
    intensity?: number;
    color?: string;
    shadows?: boolean;
  }[];
  environment?: { baked_lighting?: boolean; ambient_light?: string };
  image?: string;
}

const DEFAULT_LIGHT = '#ffdd88';

/** UVTT colours are 8-digit `aarrggbb` in most exporters; take the trailing rgb. */
export function uvttColor(c: string | undefined): string {
  if (!c) return DEFAULT_LIGHT;
  const hex = c.replace(/^#/, '');
  if (!/^[0-9a-f]{6,8}$/i.test(hex)) return DEFAULT_LIGHT;
  return `#${hex.slice(-6).toLowerCase()}`;
}

function imageMime(base64: string): string {
  if (base64.startsWith('UklGR')) return 'image/webp';
  if (base64.startsWith('/9j/')) return 'image/jpeg';
  return 'image/png';
}

export function readUvtt(input: unknown, name: string): ImportedMap {
  const file = (input ?? {}) as UvttFile;
  const warnings: string[] = [];
  const res = file.resolution ?? {};
  const origin = res.map_origin ?? { x: 0, y: 0 };
  const size = res.map_size ?? { x: 0, y: 0 };
  const ppg = res.pixels_per_grid ?? 0;
  if (!(size.x > 0 && size.y > 0)) throw new Error('UVTT file has no map_size');

  const pt = (p: Pt): [number, number] => [round3(p.x - origin.x), round3(p.y - origin.y)];
  const poly = (ring: Pt[]): ImportedWall | null =>
    ring.length >= 2
      ? { points: ring.map(pt), wallType: 'normal', direction: 'both' }
      : null;

  const walls: ImportedWall[] = [];
  for (const ring of file.line_of_sight ?? []) {
    const w = poly(ring);
    if (w) walls.push(w);
  }
  const objectWalls = (file.objects_line_of_sight ?? []).map(poly).filter((w): w is ImportedWall => !!w);
  if (objectWalls.length) {
    walls.push(...objectWalls);
    warnings.push(`${objectWalls.length} object outlines imported as walls`);
  }

  const doors: ImportedDoor[] = [];
  let freestanding = 0;
  for (const p of file.portals ?? []) {
    const b = p.bounds ?? [];
    if (b.length < 2) continue;
    if (p.freestanding) {
      freestanding++;
      continue;
    }
    doors.push({
      a: pt(b[0]),
      b: pt(b[b.length - 1]),
      state: p.closed === false ? 'open' : 'closed',
      isSecret: false,
      archway: false,
    });
  }
  if (freestanding) warnings.push(`${freestanding} freestanding portals skipped`);

  const lights: ImportedLight[] = (file.lights ?? [])
    .filter((l) => l.position && (l.range ?? 0) > 0)
    .map((l) => {
      const [x, y] = pt(l.position!);
      const range = l.range!;
      return {
        x,
        y,
        radius: round3(range),
        featherRadius: round3(range / 2),
        color: uvttColor(l.color),
        intensity: Math.min(1, Math.max(0.2, l.intensity ?? 0.9)),
        hidden: false,
      };
    });

  if (file.environment?.baked_lighting) warnings.push('lighting is baked into the image');

  let image: ImportedMap['image'] = null;
  if (file.image) {
    if (!(ppg > 0)) {
      warnings.push('no pixels_per_grid — image skipped');
    } else {
      image = {
        dataUrl: `data:${imageMime(file.image)};base64,${file.image}`,
        width: Math.round(size.x * ppg),
        height: Math.round(size.y * ppg),
        pxPerCell: ppg,
      };
    }
  } else {
    warnings.push('no image in file');
  }

  return {
    name,
    size: { width: Math.ceil(size.x), height: Math.ceil(size.y) },
    image,
    walls,
    doors,
    lights,
    warnings,
  };
}
