// Demo diorama data — product-shaped: wall polylines on a grid, door gaps,
// torch points. Mirrors how the real Editor authors a map (walls as point
// chains already broken at door/opening gaps), not a hardcoded mesh.
// Units are grid cells (1 unit = 1 cell); y is up.

export interface Vec2 {
  x: number;
  z: number;
}

export interface Door {
  id: string;
  a: Vec2;
  b: Vec2;
  /** Flagged secret doors exist in the data but render like any other door
   * in this greybox pass — the player-view redaction is a beat-4 mechanic (P3). */
  secret?: boolean;
}

export interface Torch {
  id: string;
  pos: Vec2;
}

/** Static room dressing (Phase D trust-beat fix): hand-placed, not derived
 * from geometry — same "product-shaped" spirit as walls/doors/torches, just
 * decorative rather than functional. `vault` is the beat-4 prize (the thing
 * the secret door is worth having); the rest read the two rooms as places
 * instead of greybox. Diorama.tsx renders these only for the animated
 * (MAIN_MAP) instance. */
export interface Prop {
  id: string;
  kind: 'brazier' | 'crate' | 'vault' | 'bones';
  pos: Vec2;
  rotationY?: number;
}

export interface FloorRect {
  min: Vec2;
  max: Vec2;
}

export interface MapDef {
  id: string;
  /** Wall runs as point chains, each already broken at door/opening gaps. */
  wallPolylines: Vec2[][];
  doors: Door[];
  torches: Torch[];
  floors: FloorRect[];
  /** Optional: static room dressing (see Prop). SWAP_MAP has none. */
  props?: Prop[];
}

// Main dungeon: two rooms joined by a corridor, one openable door, one
// secret door, two open archways at the corridor (no door needed there).
export const MAIN_MAP: MapDef = {
  id: 'main',
  floors: [
    { min: { x: 0, z: 0 }, max: { x: 8, z: 6 } }, // Room A
    { min: { x: 8, z: 2 }, max: { x: 10, z: 4 } }, // corridor
    { min: { x: 10, z: 0 }, max: { x: 16, z: 7 } }, // Room B
    // F3 fix round: the secret room the west-secret door actually opens
    // onto — was missing entirely (door led to bare void). Sits behind the
    // door's existing x=10 wall run (z 4-7), so its own east "wall" is
    // simply that run's two solid segments either side of the z5-6 gap;
    // only north/west/south need new geometry, added to wallPolylines below.
    { min: { x: 8.5, z: 4 }, max: { x: 10, z: 7 } }, // secret room, behind west-secret
  ],
  wallPolylines: [
    // Room A
    [{ x: 0, z: 0 }, { x: 8, z: 0 }, { x: 8, z: 2 }], // north + east upper
    [{ x: 8, z: 4 }, { x: 8, z: 6 }, { x: 4, z: 6 }], // east lower + south right
    [{ x: 3, z: 6 }, { x: 0, z: 6 }, { x: 0, z: 0 }], // south left + west
    // corridor
    [{ x: 8, z: 2 }, { x: 10, z: 2 }],
    [{ x: 8, z: 4 }, { x: 10, z: 4 }],
    // Room B
    [{ x: 10, z: 0 }, { x: 16, z: 0 }, { x: 16, z: 7 }, { x: 10, z: 7 }], // north + east + south, no east gap
    [{ x: 10, z: 7 }, { x: 10, z: 6 }],
    [{ x: 10, z: 5 }, { x: 10, z: 4 }], // gap z 5-6 is the secret door
    [{ x: 10, z: 2 }, { x: 10, z: 0 }],
    // F3 fix round: secret room north/west/south walls, closing the pocket
    // behind the secret door. East end lands exactly on the existing x=10
    // wall's own vertex ((10,7)) so the run reads as one continuous
    // enclosure per style-guide rule 8, not a floating box.
    // N5 fix round: this used to start at (10,4) -> (8.5,4), running
    // right on top of the corridor's own south wall (`[{x:8,z:4},{x:10,z:4}]`
    // above) for the x 8.5-10 stretch — two coincident meshes + doubled
    // outline weight. That corridor wall already closes the north side; this
    // polyline only needs to add the west + south legs, starting where the
    // duplicate would have begun.
    [{ x: 8.5, z: 4 }, { x: 8.5, z: 7 }, { x: 10, z: 7 }],
  ],
  doors: [
    { id: 'front-door', a: { x: 4, z: 6 }, b: { x: 3, z: 6 } },
    { id: 'west-secret', a: { x: 10, z: 6 }, b: { x: 10, z: 5 }, secret: true },
  ],
  torches: [
    { id: 't1', pos: { x: 1, z: 1 } },
    { id: 't2', pos: { x: 7, z: 1 } },
    { id: 't3', pos: { x: 11, z: 1 } },
    { id: 't4', pos: { x: 15, z: 6 } },
    // N3 fix round: the secret room had no light of its own — walls occlude
    // the floor at the beat-4 camera, so it rendered as a black slot rather
    // than a small lit room around the vault. Rides the same pool/light path
    // as every other torch; already fogged out in the player pane via
    // FOG_RECT (focalAccents.tsx), same as t4.
    { id: 't5', pos: { x: 9.25, z: 4.6 } },
  ],
  props: [
    // Room A: brazier sits ON t2 — the physical fixture that torch's own
    // point light + floor glow never had (Diorama.tsx renders only the
    // light/pool, no fixture mesh, for every OTHER torch). Crate stack
    // against the east wall, clear of SightSweep's PATH (nearest approach
    // ~3 units) and of t2 itself.
    { id: 'brazier-a', kind: 'brazier', pos: { x: 7, z: 1 } },
    // Background-texture critique P2-6: every baked pool read as a
    // sourceless wash from the nadir camera (point lights are invisible;
    // only t2 had a fixture) — every room torch now owns a visible brazier
    // at its exact authored position, so pool and source can never drift
    // apart. t5 (secret room) deliberately stays fixture-less: the vault is
    // that room's single focal and the 1.5-unit pocket has no floor to
    // spare.
    { id: 'brazier-t1', kind: 'brazier', pos: { x: 1, z: 1 } },
    { id: 'brazier-t3', kind: 'brazier', pos: { x: 11, z: 1 } },
    { id: 'brazier-t4', kind: 'brazier', pos: { x: 15, z: 6 } },
    { id: 'crates-a', kind: 'crate', pos: { x: 6.8, z: 4.8 }, rotationY: 0.3 },
    // F3 fix round: the vault is the beat-4 prize — moved INSIDE the new
    // secret room behind the door (was sitting out in plain Room B, past a
    // door that opened onto nothing). Centered in the room's own footprint,
    // clear of all three new walls, well clear of TRUST_PLAYER_SIGHT_ORIGIN's
    // visibility sweep (see focalAccents.tsx PlayerFog/FOG_RECT) and of the
    // existing beat-2 SE treasure glint (t4 area) so nothing crowds one spot.
    { id: 'vault', kind: 'vault', pos: { x: 9.25, z: 5.6 } },
    { id: 'crates-b', kind: 'crate', pos: { x: 13, z: 1 }, rotationY: -0.4 },
    { id: 'bones-b', kind: 'bones', pos: { x: 10.6, z: 0.6 } },
  ],
};

// Beat 4 "Trust": the two token positions FocalAccents' TrustTokens renders.
// Trust-pane rework: red now sits exactly on TRUST_PLAYER_SIGHT_ORIGIN (the
// corridor-mouth point in Room A the player-pane visibility sweep is cast
// from, below) instead of down at the front door — the old x=3.9 position
// projected outside the player pane's own crop once the beat-4 camera and
// crop were unified across both panes (the two-render split no longer pans
// each pane toward center independently), so the party's own token vanished
// from the pane whose sight-wedge it's supposed to be standing at the apex
// of. Sitting the token AT the sweep origin instead means the wedge visibly
// originates from something instead of empty floor, and the token is
// guaranteed inside both panes' crops by construction (it's the point the
// crop-fit math itself is centered near). PATH's own end (SightSweep.tsx)
// moves with it so the walk still reads as arriving here — see that file's
// own comment.
// Blue sits in Room B past the secret door, DM-only (art-brief: "DM pane
// has both tokens, player pane only the red one").
export const TRUST_TOKENS: { red: Vec2; blue: Vec2 } = {
  red: { x: 7, z: 3 },
  blue: { x: 12, z: 5.5 },
};

// Beat 4 "Trust", player pane: where the party is effectively standing to
// look into Room B. Was {9.4, 3} — right in the corridor's own open archway
// mouth (this file's own "two open archways at the corridor, no door needed
// there") — but that close to the 2-unit-wide archway the sweep's aperture
// cone is nearly as wide as the opening itself, so it reveals essentially
// all of Room B (~9% left dark; verified with a throwaway node script
// computing polygon area against Room B's footprint) instead of a
// deliberately narrow slice. Pulled back into Room A, at the corridor's
// mouth on Room A's own side: the same archway now subtends a much
// narrower angle from here, leaving Room B's far half — including the
// secret door — dark (~49% dark at the same script's measurement, PARTY_
// SIGHT_RADIUS below), so the two panes actually read differently.
export const TRUST_PLAYER_SIGHT_ORIGIN: Vec2 = { x: 7, z: 3 };

// Shared sight-radius cap: SightSweep.tsx's beat-3 wedge and focalAccents.tsx's
// beat-4 PlayerFog swept the same "how far can the party see" number under
// two different constants (9 vs 10) that had quietly drifted apart. One
// export, so both readers agree.
export const PARTY_SIGHT_RADIUS = 9;

// Shared "what blocks sight" wall list: walls plus the secret door, which
// stays an unconditional blocker outside beat 4 (it never opens during beat
// 3's walk, and beat 4's own PlayerFog treats it the same way). SightSweep.tsx's
// WALL_SEGMENTS and focalAccents.tsx's FOG_WALL_SEGMENTS used to each build
// this list themselves — a verbatim copy drifting apart the same way
// PARTY_SIGHT_RADIUS did. One export, so both readers agree. Typed
// structurally as `{ a: Vec2; b: Vec2 }[]` rather than importing
// visibility.ts's `Segment` (which itself imports Vec2 from here) to avoid a
// module cycle; the shape matches, so it's assignable at every call site.
export const MAIN_WALL_SEGMENTS: { a: Vec2; b: Vec2 }[] = (() => {
  const segments = MAIN_MAP.wallPolylines.flatMap((line) => polylineSegments(line).map(([a, b]) => ({ a, b })));
  const secretDoor = MAIN_MAP.doors.find((d) => d.secret);
  if (secretDoor) segments.push({ a: secretDoor.a, b: secretDoor.b });
  return segments;
})();

// Second, smaller map — the destination of beat 6's scene swap.
export const SWAP_MAP: MapDef = {
  id: 'swap',
  floors: [{ min: { x: 0, z: 0 }, max: { x: 6, z: 5 } }],
  wallPolylines: [
    [{ x: 0, z: 0 }, { x: 6, z: 0 }, { x: 6, z: 5 }, { x: 3.5, z: 5 }],
    [{ x: 2.5, z: 5 }, { x: 0, z: 5 }, { x: 0, z: 0 }],
  ],
  doors: [{ id: 'swap-door', a: { x: 3.5, z: 5 }, b: { x: 2.5, z: 5 } }],
  torches: [
    { id: 's1', pos: { x: 1, z: 1 } },
    { id: 's2', pos: { x: 5, z: 4 } },
  ],
  // F8 fix round: beat 7's hero map read as featureless (empty room, no
  // dressing) — two props via the same data-driven components MAIN_MAP's
  // own props use. Brazier sits on s1 (mirrors MAIN_MAP's brazier-a/t2
  // pairing); crate clear of both torches and the door gap.
  props: [
    { id: 'swap-brazier', kind: 'brazier', pos: { x: 1, z: 1 } },
    // P2-6: s2's pool needs a visible source too — same rule as MAIN_MAP.
    { id: 'swap-brazier-2', kind: 'brazier', pos: { x: 5, z: 4 } },
    { id: 'swap-crate', kind: 'crate', pos: { x: 4.3, z: 1.4 }, rotationY: 0.25 },
  ],
};

// World offset for the swap map: centered under the main footprint and
// hidden below ground, so the swap reads as in-place (walls sink, new map
// rises) rather than a sideways camera move. P3 raises this group's y from
// -3 to 0 as the main map's group sinks from 0 to -3 — one diorama, one
// world location, the whole way through.
export const SWAP_MAP_OFFSET: [number, number, number] = [5, -3, 0.5];

export function polylineSegments(polyline: Vec2[]): [Vec2, Vec2][] {
  const segments: [Vec2, Vec2][] = [];
  for (let i = 0; i < polyline.length - 1; i++) {
    segments.push([polyline[i], polyline[i + 1]]);
  }
  return segments;
}
