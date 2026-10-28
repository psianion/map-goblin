// Universal VTT reader (.uvtt / .dd2vtt / .df2vtt — Dungeondraft, Dungeon Alchemist,
// Inkarnate, Arkenforge). Everything in the file is already in squares, so this is
// mostly a rename; the image rides along as base64 with no data: prefix.

import type { ImportedDoor, ImportedLight, ImportedMap, ImportedWall } from './types';
import { edgeClamp, pulledWarning, round3 } from './types';

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
export function uvttColor(c: string | undefined, fallback = DEFAULT_LIGHT): string {
  if (!c) return fallback;
  const hex = c.replace(/^#/, '');
  if (!/^[0-9a-f]{6,8}$/i.test(hex)) return fallback;
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
  // Walls sit on the image. Dungeondraft hugs the outer ones a fraction of a cell outside
  // it, which would grow the pinned frame a cell or two past the picture. Lights stay put:
  // they never grow the frame, and one just off the edge still lights the map.
  const wallEdge = edgeClamp(size.x, size.y);
  const wallPt = (p: Pt): [number, number] => wallEdge.point(...pt(p));
  const poly = (ring: Pt[]): ImportedWall | null =>
    ring.length >= 2
      ? { points: ring.map(wallPt), wallType: 'normal', direction: 'both' }
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
      a: wallPt(b[0]),
      b: wallPt(b[b.length - 1]),
      state: p.closed === false ? 'open' : 'closed',
      isSecret: false,
      archway: false,
    });
  }
  if (freestanding) warnings.push(`${freestanding} freestanding portals skipped`);
  warnings.push(...pulledWarning(wallEdge.pulled, 'wall points'));

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
  // Exporters write the ambient as a colour; absent means the map was drawn lit.
  const ambientLight = file.environment?.ambient_light ? uvttColor(file.environment.ambient_light) : '#ffffff';

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
    ambientLight,
    // No scale in the format (only pixels_per_grid); the document builder supplies 5 ft.
    cellScale: undefined,
    warnings,
  };
}
