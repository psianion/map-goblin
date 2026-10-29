// Door kits: what a door is built from when its wall belongs to a kit that has
// doors (Fieldstone, Palisade, Cave Ink), or when the door picks a kit itself
// (`DoorChild.kit`).
//
// A door leaf is never one picture fitted to the opening. It is slices laid end
// to end: a hinge cap, plank tiles and a latch cap (GG_Door_Kits in gg-forge,
// drawn by forge/door-kits.mjs). The caps keep their length; a wider door gets
// more tiles, so the planks lengthen while the hinge and handle stay the size
// they were drawn. The leaf's thickness is fixed too: a door is as thick as a
// door whatever the wall is doing. What follows the wall is the jamb, which
// always fills the wall's full depth.
//
// Everything here is cells and radians, and pure, so the geometry is testable
// without a GPU; doorRenderer.ts turns it into sprites.

import type { DoorChild } from '../shared/types';

export type DoorKitId = NonNullable<DoorChild['kit']>;
export type LeafPiece = 'hinge' | 'tile-a' | 'tile-b' | 'latch';

/** Height of every leaf slice's canvas, cells. The leaf is centred across it. */
export const DOOR_SLICE_CELLS = 0.4;

export interface DoorKit {
  id: DoorKitId;
  /** Leaf thickness, cells. */
  thickness: number;
  hingeLength: number;
  latchLength: number;
  /** A tile's drawn length; placed tiles share the leftover and land near it. */
  tileLength: number;
  /** Multiplied into the grey-master leaf, the way a wall tint is. */
  tint: string;
  /**
   * How the cut ends of the wall are closed either side of the opening.
   * `ending`: the wall set's own end cap, the piece a wall wears at a free end,
   * `capPx` being how far its stone reaches past the tile's centre.
   * `art`: the kit's own jamb (`doorkit-<id>-jamb`), drawn for the opening's
   * start edge with the edge at (originX, originY) on a w x h cell canvas.
   */
  jamb: { kind: 'ending'; capPx: number } | { kind: 'art'; w: number; h: number; originX: number; originY: number };
}

const KITS: Record<DoorKitId, DoorKit> = {
  stone: {
    id: 'stone', thickness: 0.17, hingeLength: 0.16, latchLength: 0.16, tileLength: 0.5,
    tint: '#8e6844', jamb: { kind: 'ending', capPx: 46 },
  },
  wood: {
    id: 'wood', thickness: 0.15, hingeLength: 0.16, latchLength: 0.16, tileLength: 0.5,
    tint: '#ad885c', jamb: { kind: 'ending', capPx: 46 },
  },
  cave: {
    id: 'cave', thickness: 0.24, hingeLength: 0.18, latchLength: 0.18, tileLength: 0.5,
    tint: '#ffffff', jamb: { kind: 'art', w: 0.7, h: 1.36, originX: 0.55, originY: 0.66 },
  },
};

const KIT_BY_WALL_SET: Record<string, DoorKitId> = {
  GG_Fieldstone: 'stone',
  GG_Palisade: 'wood',
  GG_Cave_Ink: 'cave',
};

/** The door kit for a wall set, or null when the set has no doors of its own. */
export function doorKitFor(wallSetId: string | undefined): DoorKit | null {
  const id = wallSetId ? KIT_BY_WALL_SET[wallSetId] : undefined;
  return id ? KITS[id] : null;
}

/** Every kit a door can be built from, in the order a picker offers them. */
export const DOOR_KIT_IDS: readonly DoorKitId[] = ['stone', 'wood', 'cave'];

/** A kit by its id; null for an id this build does not know (a newer save). */
export function doorKitById(id: string | undefined): DoorKit | null {
  return id && Object.prototype.hasOwnProperty.call(KITS, id) ? KITS[id as DoorKitId] : null;
}

/**
 * The kit a door is built from: its own pick when it has one, else its wall's.
 * Null when neither names a kit, or the style is not one a kit builds.
 */
export function doorKitOf(
  door: Pick<DoorChild, 'style' | 'kit'>,
  wallSetId: string | undefined,
): DoorKit | null {
  if (!isKitStyle(door.style)) return null;
  return doorKitById(door.kit) ?? doorKitFor(wallSetId);
}

/**
 * The wall set a kit was drawn for. A stone or wood kit closes the opening with
 * that set's own end cap, so a kit picked for a wall of another set still wears
 * its own jambs.
 */
export function kitWallSet(kit: DoorKit): string {
  for (const [set, id] of Object.entries(KIT_BY_WALL_SET)) if (id === kit.id) return set;
  return '';
}

/** The pack entry (local key) holding one slice of a kit. */
export function doorKitKey(kit: DoorKit, piece: LeafPiece | 'hinge-plain' | 'jamb'): string {
  return `doorkit-${kit.id}-${piece}`;
}

/** Door styles a kit builds. The rest keep their own art or glyphs. */
export function isKitStyle(style: DoorChild['style']): boolean {
  return style === 'single' || style === 'double';
}

export interface LeafSlice {
  piece: LeafPiece;
  /** Start along the leaf, from the hinge end. */
  x: number;
  length: number;
}

/**
 * The slices of one leaf `length` long, hinge end first.
 *
 * Caps at their drawn length, then as many tiles as come closest to their drawn
 * length, at least one, sharing the leftover between them, never with the caps.
 * Tiles alternate A, B so a long door does not repeat one board.
 */
export function leafSlices(kit: DoorKit, length: number): LeafSlice[] {
  const middle = Math.max(0.05, length - kit.hingeLength - kit.latchLength);
  const n = Math.max(1, Math.round(middle / kit.tileLength));
  const tile = middle / n;
  const out: LeafSlice[] = [{ piece: 'hinge', x: 0, length: kit.hingeLength }];
  for (let i = 0; i < n; i++) {
    out.push({ piece: i % 2 ? 'tile-b' : 'tile-a', x: kit.hingeLength + i * tile, length: tile });
  }
  out.push({ piece: 'latch', x: kit.hingeLength + middle, length: kit.latchLength });
  return out;
}

/**
 * How far the wall's face stands off its centre line beside the opening.
 * Composed walls are as deep as the layer says; the cave band is laid at the
 * kit's own scale, so its depth is the rock's and not the setting's.
 *
 * `wallKit` is the kit of the wall itself, and that is what decides the depth:
 * a stone door picked for a cave wall still folds flat against the rock, and a
 * cave door in a stone wall against the stones. It defaults to the door's kit.
 */
export function wallHalfDepth(kit: DoorKit, wallWidth: number, wallKit: DoorKit | null = kit): number {
  return wallKit?.id === 'cave' ? 0.6 : wallWidth / 2;
}

/**
 * How far the hinge pin stands off the wall's centre line, toward the swing
 * side, with the leaf turned `open` radians.
 *
 * The pin is the leaf's hinge-end corner on its swing face, and it rides the
 * jamb's face (the opening's edge): there when shut, so the leaf turns about
 * its own corner and stays against the jamb as it opens; out at the wall face
 * at 180 degrees, so the folded leaf lies flat on it. In between it eases along
 * the jamb (half a cosine), so the leaf never leaves the jamb at any angle.
 *
 * A pin fixed halfway between those two lines (the first cut) carried the hinge
 * end in an arc away from the jamb. On a thin composed wall that was a sliver,
 * but the cave's jamb rock is 0.6 deep, and its open leaf floated a quarter of
 * a cell clear of the rock and well out into the room.
 */
export function hingeDepth(
  kit: DoorKit,
  wallWidth: number,
  open: number,
  wallKit: DoorKit | null = kit,
): number {
  const shut = kit.thickness / 2;
  const flat = Math.max(shut, wallHalfDepth(kit, wallWidth, wallKit));
  return shut + ((flat - shut) * (1 - Math.cos(open))) / 2;
}

/** Default opening, degrees, for a door saved before the angle was settable. */
export const DEFAULT_OPEN_ANGLE = 90;
export const MAX_OPEN_ANGLE = 180;

/** How far a door stands open right now, degrees: its set angle when open, else shut. */
export function doorOpenAngle(door: Pick<DoorChild, 'state' | 'openAngle'>): number {
  if (door.state !== 'open') return 0;
  const a = door.openAngle ?? DEFAULT_OPEN_ANGLE;
  return Math.min(Math.max(0, a), MAX_OPEN_ANGLE);
}

export interface LeafPose {
  /** World point of the leaf's hinge end on its own centre line. */
  origin: [number, number];
  /** Rotation of the leaf's length axis. */
  rotation: number;
  /** Mirrored across its length, so a far-side leaf shows its hinge the same way round. */
  flip: boolean;
  length: number;
}

/**
 * Every leaf of a kit door, posed.
 *
 * `position`/`angle` are the resolved centre of the opening and the wall's
 * direction. A single door hangs on the opening's start edge, or its end edge
 * when `hinge` is `'end'`; a double hangs one leaf on each. `swing` picks the
 * side of the wall it opens toward: +1 is the wall direction turned a quarter
 * clockwise on screen. `wallKit` is the wall's own kit (see `wallHalfDepth`).
 */
export function leafPoses(
  door: Pick<DoorChild, 'width' | 'style' | 'state' | 'openAngle' | 'hinge' | 'swing'>,
  position: [number, number],
  angle: number,
  kit: DoorKit,
  wallWidth: number,
  wallKit: DoorKit | null = kit,
): LeafPose[] {
  const dir: [number, number] = [Math.cos(angle), Math.sin(angle)];
  const nrm: [number, number] = [-dir[1], dir[0]];
  const side = door.swing === -1 ? -1 : 1;
  const open = (doorOpenAngle(door) * Math.PI) / 180;
  const depth = hingeDepth(kit, wallWidth, open, wallKit);
  const half = door.width / 2;

  const leaves: { atEnd: boolean; length: number }[] =
    door.style === 'double'
      ? [
          { atEnd: false, length: (door.width - 0.03) / 2 },
          { atEnd: true, length: (door.width - 0.03) / 2 },
        ]
      : [{ atEnd: door.hinge === 'end', length: door.width - 0.02 }];

  return leaves.map(({ atEnd, length }) => {
    const s = atEnd ? 1 : -1;
    const edge: [number, number] = [position[0] + dir[0] * half * s, position[1] + dir[1] * half * s];
    // On the jamb's face, the opening's edge line, `depth` toward the swing side.
    const pin: [number, number] = [edge[0] + nrm[0] * side * depth, edge[1] + nrm[1] * side * depth];
    // A start-edge leaf lies along +dir and turns toward the swing side; an
    // end-edge leaf lies along -dir and turns the other way to reach it.
    const rotation = atEnd ? angle + Math.PI - side * open : angle + side * open;
    // The leaf's centre line sits half a thickness back from the pin, across the
    // leaf's own axis, on the side that puts it on the wall's centre line when shut.
    const back = ((atEnd ? 1 : -1) * side * kit.thickness) / 2;
    const origin: [number, number] = [
      pin[0] - Math.sin(rotation) * back,
      pin[1] + Math.cos(rotation) * back,
    ];
    return { origin, rotation, flip: atEnd, length };
  });
}
