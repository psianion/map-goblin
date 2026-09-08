// What a foreign map looks like once a reader is done with it. Every number is in
// cells with the origin at the top-left corner of the map and y pointing down, so
// the document builder never sees a pixel or a foot — the readers own all unit work.

import type { DoorState, WallDirection, WallType } from '../types';

export interface ImportedImage {
  /** `data:` URL, exactly what `customImages` stores. */
  dataUrl: string;
  /** Pixel size of the encoded image. */
  width: number;
  height: number;
  /** Cell scale the image was drawn at. `width / pxPerCell` is its footprint in cells. */
  pxPerCell: number;
}

export interface ImportedWall {
  points: [number, number][];
  wallType: WallType;
  direction: WallDirection;
}

/** A door is its own segment in every source format; `a`→`b` is that segment. */
export interface ImportedDoor {
  a: [number, number];
  b: [number, number];
  state: DoorState;
  isSecret: boolean;
  /** An opening that never blocks sight even when "closed" — a doorway, not a door. */
  archway: boolean;
}

export interface ImportedLight {
  x: number;
  y: number;
  radius: number;
  featherRadius: number;
  color: string;
  intensity: number;
  hidden: boolean;
}

export interface ImportedMap {
  name: string;
  /** Map footprint in cells — becomes `mapSettings.fixedSize`. */
  size: { width: number; height: number };
  image: ImportedImage | null;
  walls: ImportedWall[];
  doors: ImportedDoor[];
  lights: ImportedLight[];
  /**
   * The ambient the source showed the map under, as our `mapSettings.ambientLight` colour.
   * Foundry's darkness 0 is a fully lit scene; a pack painted for it opens black under the
   * editor's night default, which is what the whole upper floor of Axeholm looked like.
   */
  ambientLight: string;
  /** Every dropped or approximated thing, named, for the DM to read once. */
  warnings: string[];
}

/** The editor's default ambient — what a fully dark source maps to. */
export const NIGHT_AMBIENT = '#2d2d44';

/** Mix white (lit) toward the night default by `darkness` in 0..1. */
export function ambientForDarkness(darkness: number): string {
  const d = Math.min(1, Math.max(0, darkness));
  const night = [0x2d, 0x2d, 0x44];
  const hex = (v: number) => Math.round(v).toString(16).padStart(2, '0');
  return `#${night.map((n) => hex(255 + (n - 255) * d)).join('')}`;
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
