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
  /** Every dropped or approximated thing, named, for the DM to read once. */
  warnings: string[];
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
