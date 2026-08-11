// Diorama: toon-shaded, ink-outlined geometry built from map data (P4 art
// pass — see scene/textures.ts for the procedural materials and
// scene/Outline.tsx for the inverted-hull linework). When `animated` is set
// (the primary map only), beats 1-2 drive it here:
// wall footprints ink-draw in (beat "Ink"), then walls rise and torches
// ignite, staggered along draw order (beat "The rise"). Progress comes from
// ScrollCamera via the sceneProgress singleton (scene/sceneProgress.ts).
// Reduced-motion users never see a tween: ScrollCamera jumps inkT/riseT
// straight to each beat's end value, so this component just renders
// whatever those values already are on the next frame — no separate
// reduced-motion branch needed here.
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { FOG_RECT, fogHiddenRef } from './focalAccents';
import { clippedPoolGeometry, doorFrameParts, doorGeometry, floorGeometry, mapBorderGeometry, outlineGeometry, wallSegmentGeometry } from './geometry';
import { polylineSegments, type MapDef, type Prop, type Vec2 } from './mapData';
import { Outline, OUTLINE_EPS_PROP, OUTLINE_EPS_STRUCTURE } from './Outline';
import { sceneProgress } from './sceneProgress';
import {
  getBadgeTexture,
  getDashTexture,
  getDoorTexture,
  getDoorTopTexture,
  getFloorTexture,
  getRadialGlowTexture,
  getTorchGlowTexture,
  getWallTexture,
  getWoodTexture,
} from './textures';

export const WALL_HEIGHT = 2.2;
const WALL_THICKNESS = 0.25;
const INK_HEIGHT = 0.02;
// Walls, doors, and the map border are all structure — the heavier outline
// tier (see scene/Outline.tsx's OUTLINE_EPS_STRUCTURE/_PROP split).
const OUTLINE_EPS = OUTLINE_EPS_STRUCTURE;
// Baked pool plane, diameter in cells. Was 7 (radius 3.5, the art-brief's
// literal number) — round-2 judged screenshots showed that still merges
// into a room-wide wash at this room's torch spacing (t1/t2 6 cells apart,
// see mapData.ts). Tightened to ~2-3 cells radius per the judged finding so
// floor between torches actually returns to bare stone.
// D2 fix round (finding 4): still 1.5 cells too big at night — pools leaked
// through solid walls onto the sheet beyond them as hard-rimmed discs.
// Tightened again; see getTorchGlowTexture's own plateau-stop fix for the
// "hard-rimmed" half of this finding.
const TORCH_POOL_SIZE = 3;
// Smooth-cutoff radius in cells (three.js windows point-light falloff to
// zero by `distance`) — matches TORCH_POOL_SIZE's radius so the dynamic
// light and the baked pool agree on where the pool ends.
const TORCH_DISTANCE = 3.2;
// Stone interior palette (art-style-guide §4 / art-brief palette table).
// D2 "the lit table" value inversion (2026-08-07 plan, adjudicated decision
// 2): the board's own D2 map vars invert which side carries the read —
// `--m-floor: #efe6cf` (light stone, lighter than the parchment sheet it
// sits on), `--m-wall: #2e2a1c` (dark ink, now the darkest note AND the
// thing that reads). The map is drawn INTO the paper: floors recede toward
// the sheet's own value, walls are the ink stroke on top of it. Everything
// downstream of these two constants — FLOOR_SEAM_TINT, WALL_TORCH_CAP,
// WALL_CAP_TINT, *_NIGHT_TINT — is recomputed against these new baselines
// below; none of it is tuned in the lit chain (still unlit MeshBasicMaterial
// + baked textures throughout, per the round's value-system contract).
const WALL_TINT = '#2e2a1c';
const FLOOR_TINT = '#efe6cf';
// Dark ink, not a lighter grey — matches WALL_TINT's own family so the
// etched grid/edge-wear reads as "the same ink, fainter" rather than a third
// unrelated hue. Low-contrast per the board's own --m-grid reference
// (rgba(22,24,15,.10)): see getFloorTexture's stroke alpha in textures.ts.
const FLOOR_SEAM_TINT = '#2e2a1c';
// Dimmed from #6d4a2c (art-brief beat-2 defect: the door read as a bright
// saturated orange "prop" competing with the SE glint as an accidental
// second focal — only one focal accent is allowed per beat). Same hue,
// pulled darker/less saturated so it still reads as wood, not a light source.
const WOOD_TINT = '#4a331f';
const WOOD_SEAM_TINT = '#4a3018';
// Thin lighter lip on the wall top, per art-brief: "wall tops may carry a
// thin lip so extrusion reads, but the side faces stay ink" — the "thick ink
// stroke with a lighter fill" read from top-down (style-guide rule 3), on
// top of the ink-dark side faces the wall mesh + Outline already give.
// D2 value inversion: recomputed off the new WALL_TINT, same lightening
// delta the old #181a13 -> #3a3e33 pair used (+34,+36,+32 per channel).
const WALL_CAP_TINT = '#504e3c';
// Issue 5 (split unlit/toon value system): the door frame parts (jambs/
// lintels), the secret-door wall filler, and the wall caps are the last
// three toon-lit surfaces that shared a day-tint constant with an
// ALREADY-unlit sibling (WALL_TINT also feeds the unlit wall faces and door-
// top ink; WALL_CAP_TINT also feeds the already-unlit Brazier via
// BRAZIER_TINT). Darkening WALL_TINT/WALL_CAP_TINT in place to compensate
// for the toon ramp's removal would have wrongly darkened those already-
// correct unlit surfaces too, so these get their own dedicated darkened
// constants instead. Measured factor: the background-texture rescore doc
// found toon-shaded surfaces render ~0.35x an unlit surface of the same hex
// (`docs/2026-08-08-background-texture-rescore.md`, finding P1-C) — every
// value below is its own already-unlit sibling's hex, srgb-decoded,
// multiplied by 0.35 in linear space, re-encoded. CAP_NIGHT_TINT (below)
// is rebuilt off WALL_CAP_TOON_TINT instead of WALL_CAP_TINT so its ratio
// keeps recomputing correctly.
//
// Correction to the fix plan's own claim: every converted material below
// pulls only `.map` from getWallTexture/getWoodTexture/getDoorTexture, NOT
// the full `{...getXTexture(...)}` spread the toon versions used. The plan
// (`docs/2026-08-11-nine-issue-fix-plan.md`, issue 5 step 5) says
// "MeshBasicMaterial ignores normalMap" — false, measured live: spreading
// the bundle's `normalMap`/`aoMap` onto a MeshBasicMaterial JSX element
// throws `TypeError: Cannot set properties of undefined (setting 'value')`
// inside three.js's refreshUniformsCommon on every render, a hard crash
// (blank canvas), not a silent no-op. `.map`-only is also what every
// already-unlit surface in this file (floor/wall faces, door tops, Brazier)
// already does — this makes every converted surface match that existing,
// working pattern instead of the toon one.
const DOOR_FRAME_TOON_TINT = '#19160d';
const WALL_CAP_TOON_TINT = '#2f2d22';
// R3 fix round: is a map position inside FOG_RECT (focalAccents.tsx) —
// shared test for everything that needs to render under fogHiddenRef below
// (props, torch pools, the SE-room glint) rather than each site re-deriving
// its own bounds check.
function inFogRect(p: Vec2): boolean {
  return p.x >= FOG_RECT.min.x && p.x <= FOG_RECT.max.x && p.z >= FOG_RECT.min.z && p.z <= FOG_RECT.max.z;
}
const WALL_CAP_HEIGHT = 0.08;
const WALL_CAP_THICKNESS_MULT = 1.5;
// Wall-face torch-response ceiling. Wall side faces used to stay
// MeshToonMaterial and pick up the dynamic point lights directly — fine near
// a single torch, but two torches' banded contributions simply sum in the
// toon shader with no ceiling, so a corridor wall sitting in both t2 and
// t3's overlap (or any point lit by >1 torch) could blow well past a sane
// cap. Rather than re-tune intensities against an unbounded sum, wall side
// faces go unlit (matching the floor/border's own "MeshBasicMaterial +
// toneMapped=false" fix for this exact class of bug — see the floor mesh's
// comment below) and their torch response is an explicit lerp toward a
// color computed to land EXACTLY on the cap: since displayed = albedo *
// color and this ratio is albedo-independent of intensity/light-count, the
// result can never exceed the cap regardless of how many torches are
// nearby. Computed via THREE.Color (not hand sRGB math) so it stays correct
// if WALL_TINT or the cap ever change.
// D2 value inversion: recomputed off the new (much darker) WALL_TINT, same
// relative brighten the old #181a13 -> #20221a pair used (+8,+8,+7).
const WALL_TORCH_CAP = '#363223';
const WALL_CAP_RATIO = (() => {
  const cap = new THREE.Color(WALL_TORCH_CAP);
  const base = new THREE.Color(WALL_TINT);
  return new THREE.Color(Math.max(1, cap.r / base.r), Math.max(1, cap.g / base.g), Math.max(1, cap.b / base.b));
})();
// Skirt: recedes BORDER_HEIGHT below the floor plane (top face flush with
// floor level) so rooms read as carved into their base rather than a curb
// sitting proud of it — enhancement doc Part 1 move 1. Geometry (the ragged
// silhouette from mapBorderGeometry) is unchanged by the D2 pass; only the
// material below changed from torn rock to table wood.
const BORDER_HEIGHT = 0.12;
// D2 "the lit table" (docs/2026-08-07-landing-art-pass-d2-plan.md): this
// skirt is now the physical wood table the diorama sits on, not torn rock —
// the model's own visible seat, distinct from the flatter parchment field
// further out (SceneRenderer.tsx's NORMAL_BG). Exact hex from the direction
// board's --wood token, so the 3D skirt and the DOM's wood context (owned by
// the tokens.css/global.css pass) read as the same material. Value sits
// between the floor's baked #2b2e26 and the parchment field's #e8dfc6 by
// construction, same "value between floor and what's beyond it" approach as
// the old rock skirt — unlit MeshBasicMaterial, still never picks up
// torchlight, keeping it on the floor's own baked value ladder.
// Background-texture critique P1-4: the skirt's torn fringe read as
// mid-brown "cardboard shims" against the sheet — pinking-shears triangles
// in wood color. Fill pulled toward the ink/sheet family (a dark sepia-ink
// between WALL_TINT and the parchment) so the tear reads as the map world's
// own torn edge, not craft-supply wood trim. The prop wood (crates, door
// tops) kept the old bright --wood value — see PROP_WOOD_TINT below, now
// its own literal instead of aliasing this.
const BORDER_WOOD_TINT = '#443b28';
const BORDER_WOOD_SEAM_TINT = '#2a2418';
// Night target for the skirt fringe: rides the same night lerp as the floor
// (borderMatRef below). P1-4's "rust trim at night" half: the old warm
// night target kept the teeth brown against the moonlit world — night
// target now sits in the cool night family, slightly darker than the walls'
// own night value so the fringe stays the quietest note. Same
// night-linear/day-linear recipe as every other *_NIGHT_TINT here.
const BORDER_NIGHT_TINT = (() => {
  const day = new THREE.Color(BORDER_WOOD_TINT);
  const night = new THREE.Color('#14161f');
  return new THREE.Color(night.r / day.r, night.g / day.g, night.b / day.b);
})();
// Soft dark ellipse under the whole footprint so the diorama reads as
// sitting on something rather than floating (enhancement doc Part 1 move
// 5b). Sized as a multiple of the map's own bounding box.
const CONTACT_SHADOW_PAD = 1.7;
const CONTACT_SHADOW_Y = -BORDER_HEIGHT - 0.05;
// Beat 5 "the world turns" night shift: multiplicative tint ratios
// (night-hex / day-hex per channel) lerped onto each material's `color`
// (white = untinted, shows the baked albedo as-is) by clockT — the single
// mechanism that carries every face from its day palette to the art-brief's
// night palette (floor #232833, wall stroke-adjacent fill #0c0e12, wood
// #54391f) without a second set of baked textures. Only applied to the
// animated (MAIN_MAP) instance: the swap's incoming map stays day-graded
// per its own contract ("rises already carrying the DAY grade").
const WHITE = new THREE.Color(1, 1, 1);
// Ratio is night-linear/day-linear (both decoded through the real sRGB
// curve), NOT the sRGB hex ratio the old constant used — the floor material
// multiplies this against its (already sRGB-decoded) albedo texture in
// linear space, so an sRGB-space ratio landed short on blue. See
// value-diagnosis.md finding 3.
// D2 value inversion round: recomputed against the new light-day albedo
// (floor #efe6cf, wall #2e2a1c) so nightfall still lands on the D2 board's
// own established night targets — floor #232838 (board `.d2n --m-floor`),
// wall #9aa3bd (board `.d2n --m-wall`; walls go LIGHT at night, carrying the
// read the same way ink carries it by day). The day floor is now much
// brighter than before, so it needs a much bigger multiplicative cut to
// reach the same dark night value — hence the far lower floor ratio; the
// day wall is now much darker, needing a much bigger lift — hence the far
// higher wall ratio. Both computed the same way: night-linear/day-linear
// per channel, both hexes decoded through the real sRGB curve.
const FLOOR_NIGHT_TINT = new THREE.Color(0.0195, 0.0268, 0.0634);
// Background-texture critique P0-1 (night wall value inversion): the old
// ratio (11.83, 15.82, 43.82) lifted the wall SLABS to the board's #9aa3bd
// — a value authored for 2-3px night STROKES — making walls the brightest
// surface on the map at night and inverting the ink doctrine. Side faces
// now keep dark ink at night: target #1a1d28, slightly darker than the
// moonlit floor (#232838) so walls stay the darkest note at dusk and full
// night alike. The thin-stroke moonlit read the board wants comes from the
// CAPS (CAP_NIGHT_TINT below, #5a6272 family — lighter than the floor),
// which are exactly what this near-nadir camera sees of a wall. Same
// night-linear/day-linear recipe as every other *_NIGHT_TINT here, via the
// THREE.Color-ratio IIFE so it stays correct if WALL_TINT ever changes.
const WALL_NIGHT_TINT = (() => {
  const day = new THREE.Color(WALL_TINT);
  const night = new THREE.Color('#1a1d28');
  return new THREE.Color(night.r / day.r, night.g / day.g, night.b / day.b);
})();
const WOOD_NIGHT_TINT = new THREE.Color(0.771, 0.77, 0.705);
// D2 fix round (finding 5): wall caps were excluded from night tint entirely
// (opacity was driven, color never was) — they stayed warm olive while the
// wall faces below them went night-blue, framing every wall in its own day
// color. Same night-linear/day-linear recipe as every other *_NIGHT_TINT
// here: day cap albedo (WALL_CAP_TINT) -> a night target in the wall's own
// #9aa3bd family.
// R8 fix round: that target was nudged +12 per channel to #a6afc9 (brighter
// than the wall faces, "slightly lighter cap" reading), but at full night
// that landed brighter than the amber torch pools sitting right next to it —
// the caps, not the pools, won the value hierarchy. Reusing BONE_NIGHT_TINT's
// own darker moonlit-stone target (#5a6272, below) instead of a fresh hex:
// same family, already established in this file, comfortably under both the
// wall body and the pools. Same THREE.Color-ratio IIFE every other prop
// tint here uses, replacing the old hand-computed literal ratio.
const CAP_NIGHT_TINT = (() => {
  // Issue 5: rebuilt off WALL_CAP_TOON_TINT (the cap's own now-unlit day
  // albedo) instead of WALL_CAP_TINT (still the Brazier's day albedo via
  // BRAZIER_TINT) — the IIFE recomputes the ratio automatically as long as
  // it points at whichever day tint actually feeds this material.
  const day = new THREE.Color(WALL_CAP_TOON_TINT);
  const night = new THREE.Color('#5a6272');
  return new THREE.Color(night.r / day.r, night.g / day.g, night.b / day.b);
})();
// Phase D trust-beat dressing: door TOP faces (getDoorTopTexture) and the
// vault/crate props all want a bright warm wood distinct from both WALL_TINT
// (dark ink) and WOOD_TINT (the door's own dark side faces). This used to
// alias BORDER_WOOD_TINT, but P1-4 pulled the skirt fringe into the ink
// family — the props keep the board's bright --wood value as their own
// literals now (the old BORDER_* values, verbatim), so the fringe retint
// can't drag every crate and door top with it. Night ratio is the same
// wood-day -> #170f08 (board night-stage darkest anchor) literal the old
// shared BORDER_NIGHT_TINT carried.
const PROP_WOOD_TINT = '#6d4a2c';
// Issue 5: the crate is the one PROP_WOOD_TINT consumer still toon-lit —
// door tops (getDoorTopTexture(PROP_WOOD_TINT, ...), already unlit) share
// this exact hex, so darkening PROP_WOOD_TINT itself would have wrongly
// darkened the door tops too. CRATE_WOOD_TINT/CRATE_WOOD_SEAM_TINT are
// PROP_WOOD_TINT/PROP_WOOD_SEAM_TINT srgb-decoded, x0.35 (the rescore doc's
// measured toon-vs-unlit factor, see DOOR_FRAME_TOON_TINT's comment above),
// re-encoded — CrateStack (below) is the only consumer.
const CRATE_WOOD_TINT = '#412b17';
const CRATE_WOOD_SEAM_TINT = '#2b1a0b';
const PROP_WOOD_NIGHT_TINT = (() => {
  // Was a hand-typed ratio computed against PROP_WOOD_TINT; rebuilt as an
  // IIFE off CRATE_WOOD_TINT (issue 5) so it recomputes automatically like
  // every other prop's night ratio, targeting the same '#170f08' board
  // night-stage anchor this hand-typed version was already aimed at (see
  // the paragraph above — "night ratio is the same wood-day -> #170f08").
  const day = new THREE.Color(CRATE_WOOD_TINT);
  const night = new THREE.Color('#170f08');
  return new THREE.Color(night.r / day.r, night.g / day.g, night.b / day.b);
})();
// Brazier bowl/legs (F4 fix round): was meshToonMaterial reusing WALL_CAP_TINT
// + CAP_NIGHT_TINT — but the bowl sits AT torch t2's own point-light origin,
// so the toon ramp saturates to white before the night-tint multiply (applied
// via material.color, same mechanism as every other lit material here) gets
// a chance to darken it; CAP_NIGHT_TINT's own >1 ratios (computed to lift a
// near-black wall toward a pale moonlit blue) then blew straight past white
// once night hit. Same unlit-baked escape the floor/wall/door faces already
// use for this exact class of bug (this file's own "MeshBasicMaterial +
// toneMapped=false" doctrine, see the floor mesh's comment) — own tint, own
// night ratio computed fresh (BONE_TINT's own THREE.Color-ratio method)
// rather than reused, since a ratio sized for one day albedo applied to an
// unlit surface with no ramp to clamp it can blow out just as easily.
const BRAZIER_TINT = WALL_CAP_TINT;
const BRAZIER_NIGHT_TINT = (() => {
  const day = new THREE.Color(BRAZIER_TINT);
  const night = new THREE.Color('#4b5062');
  return new THREE.Color(night.r / day.r, night.g / day.g, night.b / day.b);
})();
// Cavity-rim ring inset from the bowl's own lip (F4: "give the bowl a
// visible rim ... so it has volume at nadir") — an unlit flat top cap alone
// gives this near-nadir camera no shading cue for "hollow", so without this
// darker inset ring the bowl reads as a solid puck with a floating ember dot
// rather than a vessel. Own (darker) day tint, own night ratio, same method.
const BRAZIER_RIM_TINT = '#221f18';
const BRAZIER_RIM_NIGHT_TINT = (() => {
  const day = new THREE.Color(BRAZIER_RIM_TINT);
  const night = new THREE.Color('#282c38');
  return new THREE.Color(night.r / day.r, night.g / day.g, night.b / day.b);
})();
// Vault (F5 fix round): its own iron-banded base tint + brighter lid tint,
// distinct from PROP_WOOD_TINT (shared by every crate) so the strongbox
// silhouette actually reads as a different object rather than "one more
// crate" — see the Vault component's own comment. Own night ratios, same
// THREE.Color-ratio method as everything else on this list.
// Issue 5: VAULT_BASE_TINT/SEAM and VAULT_LID_TINT/SEAM are exclusive to
// this prop (no unlit sibling shares them), so darkened in place — x0.35,
// same measured factor as DOOR_FRAME_TOON_TINT's comment above. The night
// IIFEs below are untouched code, just recomputed against the new day
// values automatically.
const VAULT_BASE_TINT = '#201f1c';
const VAULT_BASE_SEAM_TINT = '#0d0c09';
const VAULT_BASE_NIGHT_TINT = (() => {
  const day = new THREE.Color(VAULT_BASE_TINT);
  const night = new THREE.Color('#2c3040');
  return new THREE.Color(night.r / day.r, night.g / day.g, night.b / day.b);
})();
const VAULT_LID_TINT = '#54381d';
const VAULT_LID_SEAM_TINT = '#2b1a0b';
const VAULT_LID_NIGHT_TINT = (() => {
  const day = new THREE.Color(VAULT_LID_TINT);
  const night = new THREE.Color('#5c4d3e');
  return new THREE.Color(night.r / day.r, night.g / day.g, night.b / day.b);
})();
// Bone pile: the one prop with no existing tint to reuse (pale bone-white
// has no day-color relative anywhere else in this palette). Same
// THREE.Color-ratio methodology as WALL_CAP_RATIO above — night target is a
// cool moonlit grey in the WALL_NIGHT_TINT family, computed rather than
// hand-picked so it stays correct if BONE_TINT ever changes.
// Issue 5: darkened in place (x0.35, no unlit sibling shares this hex).
const BONE_TINT = '#87816b';
const BONE_NIGHT_TINT = (() => {
  const day = new THREE.Color(BONE_TINT);
  const night = new THREE.Color('#5a6272');
  return new THREE.Color(night.r / day.r, night.g / day.g, night.b / day.b);
})();

// Issue 5, blow-out guard: every *_NIGHT_TINT here is a per-channel
// multiplier applied to an unlit (verbatim-display) day albedo. On the old
// toon-lit materials the ramp's own <=1.0 output clamped the product no
// matter how big the ratio got — CAP_NIGHT_TINT's ratio is >1 per channel
// (it lifts a dark cap toward a pale moonlit blue) and relied on exactly
// that clamp. Unlit has no such clamp: night_tint * day_linear landing
// above 1.0 clips a texture's brighter-than-average pixels (grain, speckle)
// to flat white at full night, losing detail a toon-shaded frame never lost.
// One check over every (day, nightRatio) pair actually feeding a converted
// or pre-existing unlit night-tinted surface — day-only materials (door
// frame parts, secret filler, and everything in TableScene.tsx's issue-5
// list) have no ratio to check. Fails loud in dev; per the fix plan, a
// failing pair means the night TARGET must be re-picked, not the ratio
// clamped, so this only ever logs and points at the offending pair rather
// than silently clamping for you.
(function assertNightRatiosDoNotBlowOut() {
  if (!import.meta.env.DEV) return;
  const pairs: [string, string, THREE.Color][] = [
    ['FLOOR_TINT', FLOOR_TINT, FLOOR_NIGHT_TINT],
    ['WOOD_TINT', WOOD_TINT, WOOD_NIGHT_TINT],
    ['BORDER_WOOD_TINT', BORDER_WOOD_TINT, BORDER_NIGHT_TINT],
    ['WALL_TINT', WALL_TINT, WALL_NIGHT_TINT],
    ['WALL_CAP_TOON_TINT', WALL_CAP_TOON_TINT, CAP_NIGHT_TINT],
    ['BRAZIER_TINT', BRAZIER_TINT, BRAZIER_NIGHT_TINT],
    ['BRAZIER_RIM_TINT', BRAZIER_RIM_TINT, BRAZIER_RIM_NIGHT_TINT],
    ['CRATE_WOOD_TINT', CRATE_WOOD_TINT, PROP_WOOD_NIGHT_TINT],
    ['VAULT_BASE_TINT', VAULT_BASE_TINT, VAULT_BASE_NIGHT_TINT],
    ['VAULT_LID_TINT', VAULT_LID_TINT, VAULT_LID_NIGHT_TINT],
    ['BONE_TINT', BONE_TINT, BONE_NIGHT_TINT],
  ];
  for (const [label, dayHex, nightRatio] of pairs) {
    const day = new THREE.Color(dayHex);
    const channels: [number, 'r' | 'g' | 'b'][] = [
      [nightRatio.r * day.r, 'r'],
      [nightRatio.g * day.g, 'g'],
      [nightRatio.b * day.b, 'b'],
    ];
    for (const [product, channel] of channels) {
      if (product > 1.001) {
        // eslint-disable-next-line no-console
        console.error(
          `[night-ratio blow-out] ${label}.${channel}: night_ratio (${nightRatio[channel].toFixed(3)}) * day_linear ` +
            `(${day[channel].toFixed(3)}) = ${product.toFixed(3)} > 1.0 — this channel clips to white at full night. ` +
            `Re-pick the night target hex for ${label}, don't clamp the ratio.`,
        );
      }
    }
  }
})();

// Pre-dawn ember cap (beat 0 "Whisper"): at most this fraction of a torch's
// final intensity/glow, and only while both inkT and riseT are still 0 —
// i.e. before the "Ink" section's own pin has moved at all (art-brief beat
// 0: "nothing above #1a1710 except <=2 faint torch embers at <=25%").
const EMBER_FRACTION = 0.22;
const EMBER_TORCH_COUNT = 2;
// Beat 6 incoming-map fill — see the swap useFrame below.
const SWAP_RISE_LIGHT_INTENSITY = 1.6;
// Outgoing-map wall shrink: 1.5 lands wall height at exactly 25% by swapT
// 0.5 (comfortably under the "<=30% by mid-pin" mark) and at 0 by ~0.67,
// well before swapT's own 0-1 range finishes.
const OUTGOING_SWAP_SHRINK_RATE = 1.5;

// Each grower (wall segment, door, or torch) gets this fraction of riseT to
// animate; the rest of the range is spread as stagger offsets so the LAST
// grower always finishes exactly at riseT = 1. That's what times the
// positioning headline to "the last torch catches" — no separate DOM sync
// needed, the beat section simply comes to rest exactly then.
const GROW_SPAN = 0.4;

function staggered(t: number, index: number, count: number): number {
  const stagger = count > 1 ? (1 - GROW_SPAN) / (count - 1) : 0;
  return THREE.MathUtils.clamp((t - index * stagger) / GROW_SPAN, 0, 1);
}

// easeOutBack: overshoots slightly past 1 before settling — the torch
// "catching" flicker and the walls' settle, sharing the app's --ease-settle
// character (small overshoot, never a bounce).
function easeSettle(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const p = t - 1;
  return 1 + c3 * p * p * p + c1 * p * p;
}

// Cubic ease-out: reaches ~88% of the way to its target by t=0.5, ~99.9% by
// t=0.9 — used wherever a baked-value ramp (never a lit, dynamically-shaded
// surface) needs to already read as "arrived" well before the pin's scrub
// actually finishes, instead of lingering in a muddy half-day/half-night
// blend through the middle of the pin (value-diagnosis.md: floor/border
// night grade must read mid-scrub, not just at the end pin).
function frontLoad(t: number): number {
  const inv = 1 - t;
  return 1 - inv * inv * inv;
}

// Positions for a partially-drawn polyline: points beyond the reveal length
// collapse onto the cut point (a zero-length tail is invisible), giving a
// smooth dashoffset-style draw instead of whole segments popping in.
function revealPositions(points: Vec2[], t: number, y: number): Float32Array {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z));
  }
  const target = THREE.MathUtils.clamp(t, 0, 1) * (cum[cum.length - 1] || 1);
  const out = new Float32Array(points.length * 3);
  let head = points[0];
  for (let i = 0; i < points.length; i++) {
    let p = points[i];
    if (cum[i] > target) {
      if (cum[i - 1] <= target) {
        // head lies inside this segment — interpolate to its exact position
        const segLen = cum[i] - cum[i - 1] || 1;
        const segT = THREE.MathUtils.clamp((target - cum[i - 1]) / segLen, 0, 1);
        const prev = points[i - 1];
        p = { x: prev.x + (p.x - prev.x) * segT, z: prev.z + (p.z - prev.z) * segT };
        head = p;
      } else {
        // fully past the head — collapse onto the head, not the prior vertex
        p = head;
      }
    } else {
      head = p;
    }
    out[i * 3] = p.x;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = p.z;
  }
  return out;
}

// Beat 1 "Ink" stroke ramp: dim half-drawn remnant grey brightening to a
// parchment-lit head right at the draw point (art-brief: "stroke #5a5d50
// brightening to parchment-lit #8a877a at the draw head"). Per-vertex, not a
// flat material color, so the line genuinely reads as mid-draw rather than a
// single flat tint the whole way — collapsed tail vertices (see
// revealPositions) all sit at the head point, so they come out fully bright,
// which is correct: that's where they're actually rendered.
const INK_DIM = new THREE.Color('#5a5d50');
const INK_BRIGHT = new THREE.Color('#8a877a');
const INK_HEAD_WINDOW = 1.4; // world units of brightening trail behind the head

// Phase B beat-1 identity: "the map draws itself in ink, stroke by stroke."
// Wall polylines get the first DOOR_INK_PHASE_START share of inkT, spent
// sequentially (not simultaneously) in proportion to each polyline's own
// length — MAIN_MAP.wallPolylines is already authored outer-perimeter-first,
// corridor-threads-next, secret-room-last (see mapData.ts), so reusing that
// array order IS the authored stroke order; no separate ordering data needed.
// The remaining tail is reserved for door-gap hints, per the brief's "door
// gaps/props hinted last."
const DOOR_INK_PHASE_START = 0.85;
// Style-guide rule 3 ("line weight is heavier on structure, lighter on
// ground clutter"): WebGL ignores LineBasicMaterial.linewidth, so weight is
// faked via opacity ceiling instead of thickness — walls (structure) reach
// full opacity, door-gap hints (detail) cap lower and read thinner.
const DOOR_INK_MAX_OPACITY = 0.55;
// Grid hint: a faint, non-stroked crosshatch across the floor rects (reusing
// map.floors — no new data) that just fades in/out with inkT/riseT rather
// than drawing stroke-by-stroke like the walls; it's a background hint, not
// its own beat. Caps well under the wall strokes' own INK_DIM so it never
// competes with them.
const GRID_HINT_MAX = 0.12;
const GRID_STEP = 1;
function revealColors(points: Vec2[], t: number): Float32Array {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z));
  }
  const target = THREE.MathUtils.clamp(t, 0, 1) * (cum[cum.length - 1] || 1);
  const out = new Float32Array(points.length * 3);
  const c = new THREE.Color();
  for (let i = 0; i < points.length; i++) {
    const behindHead = Math.max(0, target - Math.min(cum[i], target));
    c.copy(INK_DIM).lerp(INK_BRIGHT, 1 - THREE.MathUtils.clamp(behindHead / INK_HEAD_WINDOW, 0, 1));
    out[i * 3] = c.r;
    out[i * 3 + 1] = c.g;
    out[i * 3 + 2] = c.b;
  }
  return out;
}

export function Diorama({
  map,
  position = [0, 0, 0],
  animated = false,
  doorRefsById,
  secretExtras,
  swapOffsetY = 0,
}: {
  map: MapDef;
  position?: [number, number, number];
  animated?: boolean;
  /** External refs keyed by door id — lets sibling components (SightSweep's
   * door-swing, SceneRenderer's trust split) reach into this diorama's own
   * door meshes instead of duplicating them. */
  doorRefsById?: Record<string, RefObject<THREE.Mesh | null>>;
  /** Beat 4 "Trust": a DM-pane-only marker group (amber dashed break + "S"
   * badge) over the secret door, and a fog quad standing in for the door
   * itself — genuinely absent, not styled over — on the player pane.
   * Rendered only alongside the map's flagged secret door. */
  secretExtras?: { badgeRef: RefObject<THREE.Object3D | null>; fogRef: RefObject<THREE.Mesh | null> };
  /** Beat 6 "The swap" — added to this diorama's group Y as swapT (0→1)
   * scrubs: -3 sinks the outgoing map out of view, +3 raises the incoming
   * one into it. In-place because only Y moves; x/z stay put. 0 (default)
   * opts a diorama out of the swap entirely. */
  swapOffsetY?: number;
}) {
  const walls = useMemo(
    () =>
      map.wallPolylines.flatMap((polyline) =>
        polylineSegments(polyline).map(([a, b]) => wallSegmentGeometry(a, b, WALL_THICKNESS, WALL_HEIGHT)),
      ),
    [map],
  );
  const wallOutlines = useMemo(() => walls.map((g) => outlineGeometry(g, OUTLINE_EPS)), [walls]);
  // Segment midpoints, parallel to `walls` — the only thing the torch-cap
  // clamp above needs per wall (nearest-torch distance), so this stays a
  // plain [x,z] pair rather than carrying the full geometry around again.
  const wallCenters = useMemo(
    () =>
      map.wallPolylines.flatMap((polyline) =>
        polylineSegments(polyline).map(([a, b]) => [(a.x + b.x) / 2, (a.z + b.z) / 2] as [number, number]),
      ),
    [map],
  );
  // Lighter cap strip riding each wall's top edge — same a/b recipe as the
  // wall itself, just thicker (a slight overhang) and barely tall.
  const wallCaps = useMemo(
    () =>
      map.wallPolylines.flatMap((polyline) =>
        polylineSegments(polyline).map(([a, b]) =>
          wallSegmentGeometry(a, b, WALL_THICKNESS * WALL_CAP_THICKNESS_MULT, WALL_CAP_HEIGHT),
        ),
      ),
    [map],
  );
  const floors = useMemo(() => map.floors.map((rect) => floorGeometry(rect)), [map]);
  // Rough plan center, for the swap's incoming-map fill light (below) — not
  // used for anything visual/geometric, just where to hang one light.
  const mapCenter = useMemo((): [number, number] => {
    const xs = map.floors.flatMap((f) => [f.min.x, f.max.x]);
    const zs = map.floors.flatMap((f) => [f.min.z, f.max.z]);
    return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2];
  }, [map]);
  // Footprint size, for the contact-shadow plane below — padded out past the
  // rock skirt so the shadow's soft falloff clears the torn edge.
  const mapExtent = useMemo((): [number, number] => {
    const xs = map.floors.flatMap((f) => [f.min.x, f.max.x]);
    const zs = map.floors.flatMap((f) => [f.min.z, f.max.z]);
    return [(Math.max(...xs) - Math.min(...xs)) * CONTACT_SHADOW_PAD, (Math.max(...zs) - Math.min(...zs)) * CONTACT_SHADOW_PAD];
  }, [map]);
  // P1-2: pool planes pre-clipped to each torch's own room so the baked
  // glow can never cross an authored wall — see clippedPoolGeometry.
  const torchPools = useMemo(
    () => map.torches.map((torch) => clippedPoolGeometry(torch.pos, map.floors, TORCH_POOL_SIZE)),
    [map],
  );
  const mapBorder = useMemo(() => mapBorderGeometry(map.floors, BORDER_HEIGHT), [map]);
  const mapBorderOutline = useMemo(() => outlineGeometry(mapBorder, OUTLINE_EPS), [mapBorder]);
  const doors = useMemo(() => map.doors.map((door) => doorGeometry(door, WALL_THICKNESS, WALL_HEIGHT)), [map]);
  const doorOutlines = useMemo(() => doors.map((d) => outlineGeometry(d.geometry, OUTLINE_EPS)), [doors]);
  // Stone jambs + lintel for every door gap (style-guide rule 8: "archways
  // are gaps with stone trim"). One shared toon material per door — cheaper
  // than three — whose opacity the doors' own useFrame loop below drives
  // alongside the door leaf, so the trim settles in with its door.
  // ponytail: opacity-fade instead of a bottom-anchored grow like the walls'
  // own scale trick (their geometry is bottom-origin; these boxes are
  // center-origin, so a matching grow needs a position+scale pair per part)
  // — trim briefly reads translucent mid-rise instead of un-drawn; upgrade
  // if that transition ever gets scrutinized on its own.
  const doorFrames = useMemo(
    () => map.doors.map((door) => doorFrameParts(door, WALL_THICKNESS, WALL_HEIGHT, WALL_HEIGHT * 0.85)),
    [map],
  );
  // Issue 5: was MeshToonMaterial reusing WALL_TINT (the wall faces' own day
  // albedo, already unlit) — DOOR_FRAME_TOON_TINT is that same hex x0.35 so
  // this reads the same on screen unlit as it did toon-shaded, without
  // dragging the wall faces' own tint dark. No night tint here (matches the
  // plan's own inventory: "opacity only" — day-only material, same as
  // before).
  const doorFrameMats = useMemo(
    () =>
      doors.map(
        () =>
          new THREE.MeshBasicMaterial({
            // Stray leftover from before this material was converted to
            // unlit: was `...getWallTexture(...)`, spreading the full bundle
            // (map + normalMap + aoMap) — throws `Cannot set properties of
            // undefined` inside three's refreshUniformsCommon every frame on
            // some paths and a bare console warning on others, neither of
            // which this doctrine allows (see doorSideMats just below, the
            // pattern every other converted surface in this file already
            // follows: `.map` only).
            map: getWallTexture(DOOR_FRAME_TOON_TINT).map,
            toneMapped: false,
            transparent: animated,
            opacity: animated ? 0 : 1,
          }),
      ),
    [doors, animated],
  );
  // Door side/front/back/bottom faces (BoxGeometry material indices
  // 0,1,3,4,5) — was an inline ref-tracked toon <meshToonMaterial>, now an
  // unlit useMemo'd instance (doorFrameMats' own pattern, plus the same
  // toon->unlit escape doorTopMats needed just above): at beat 4's true-
  // nadir camera the secret door sits well off the frame's own lookAt point
  // (mapData.ts TRUST_TOKENS.blue's own comment on this room's geometry), so
  // even a modest viewing angle puts real screen area on these SIDE faces
  // too, not just the top one — and they sit in the same torch-less pocket,
  // so toon shading crushed them equally dark. Same fix, same reason.
  const doorSideMats = useMemo(
    () =>
      doors.map(
        () =>
          new THREE.MeshBasicMaterial({
            map: getDoorTexture(WOOD_TINT, WOOD_SEAM_TINT).map,
            toneMapped: false,
            transparent: animated,
            opacity: animated ? 0 : 1,
          }),
      ),
    [doors, animated],
  );
  // Door TOP faces (BoxGeometry material index 2) — see getDoorTopTexture's
  // own comment for why doors need a dedicated plan-view material at all.
  // Unlit MeshBasicMaterial, not toon: the secret door sits outside every
  // torch's TORCH_DISTANCE (nothing lights it on purpose — it's meant to sit
  // in an unlit pocket), so a toon-shaded top face lands on the ramp's
  // darkest ambient-only step regardless of albedo, reproducing the exact
  // "flat placeholder color" defect this texture exists to fix. Same escape
  // as the floor/wall faces (this file's own "unlit MeshBasicMaterial, final
  // values BAKED into canvas textures" rule) — the baked wood tint now
  // arrives at the framebuffer undimmed, immune to local light level. One
  // instance per door (not shared, like doorFrameMats above) because each
  // door fades/night-tints on its own stagger the same way its side material
  // already does.
  const doorTopMats = useMemo(
    () =>
      map.doors.map(
        (door) =>
          new THREE.MeshBasicMaterial({
            map: getDoorTopTexture(PROP_WOOD_TINT, WALL_TINT, !!door.secret).map,
            toneMapped: false,
            transparent: animated,
            opacity: animated ? 0 : 1,
          }),
      ),
    [map, animated],
  );
  // Wall-filler standing in for the secret door on the player pane: same
  // geometry recipe as a real wall segment, so a closed secret door reads as
  // unbroken wall (it "does not exist") rather than a gap or an edge-on plane.
  const secretWallFiller = useMemo(() => {
    const secretDoor = map.doors.find((d) => d.secret);
    return secretDoor ? wallSegmentGeometry(secretDoor.a, secretDoor.b, WALL_THICKNESS, WALL_HEIGHT) : null;
  }, [map]);
  // Ink lines: one THREE.Line per wall polyline, built once (`<line>` JSX
  // collides with the DOM SVGLineElement type, so it's a plain object via
  // `<primitive>` instead) and mutated every frame by revealPositions().
  const inkLines = useMemo(() => {
    if (!animated) return [];
    return map.wallPolylines.map((polyline) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(polyline.length * 3), 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(polyline.length * 3), 3));
      const material = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 1 });
      return new THREE.Line(geometry, material);
    });
  }, [map, animated]);
  // Per-polyline stroke window (start/end inkT fraction, proportional to the
  // polyline's own length) + its segment index range within the flattened
  // `walls` array (same flatMap order as `walls` itself, since both come
  // from polylineSegments(polyline) in the same per-polyline loop) — the
  // latter is what lets the ink->rise handoff below fade each polyline's
  // stroke out in step with that SAME polyline's own (slowest/last) wall
  // segment, instead of every stroke fading on raw riseT regardless of
  // whether its own wall has even started rising yet.
  const wallPolylineMeta = useMemo(() => {
    if (!animated) return [];
    const lengths = map.wallPolylines.map((poly) => {
      let len = 0;
      for (let i = 1; i < poly.length; i++) len += Math.hypot(poly[i].x - poly[i - 1].x, poly[i].z - poly[i - 1].z);
      return len || 0.001;
    });
    const total = lengths.reduce((a, b) => a + b, 0) || 1;
    let cumLen = 0;
    let segIndex = 0;
    return map.wallPolylines.map((poly, i) => {
      const start = (cumLen / total) * DOOR_INK_PHASE_START;
      cumLen += lengths[i];
      const end = (cumLen / total) * DOOR_INK_PHASE_START;
      const segCount = poly.length - 1;
      const range: [number, number] = [segIndex, segIndex + segCount - 1];
      segIndex += segCount;
      return { start, end, range };
    });
  }, [map, animated]);
  // Door-gap ink hints: same reveal technique as the wall strokes, just a
  // 2-point line per door (the gap itself), timed into the tail
  // (DOOR_INK_PHASE_START..1) so they draw last, per the brief.
  const doorInkLines = useMemo(() => {
    if (!animated) return [];
    return map.doors.map(() => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(2 * 3), 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(2 * 3), 3));
      const material = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0 });
      return new THREE.Line(geometry, material);
    });
  }, [map, animated]);
  // Grid hint: one static LineSegments draw call (built once, never
  // rewritten) covering every floor rect at GRID_STEP spacing — "the grid
  // hinting in" is a uniform fade (see GRID_HINT_MAX below), not a
  // stroke-by-stroke reveal, so unlike the wall/door lines this needs no
  // per-frame position rewrite at all.
  const gridHintGeometry = useMemo(() => {
    if (!animated) return null;
    const points: number[] = [];
    for (const rect of map.floors) {
      for (let x = Math.ceil(rect.min.x / GRID_STEP) * GRID_STEP; x <= rect.max.x; x += GRID_STEP) {
        points.push(x, INK_HEIGHT, rect.min.z, x, INK_HEIGHT, rect.max.z);
      }
      for (let z = Math.ceil(rect.min.z / GRID_STEP) * GRID_STEP; z <= rect.max.z; z += GRID_STEP) {
        points.push(rect.min.x, INK_HEIGHT, z, rect.max.x, INK_HEIGHT, z);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    return geometry;
  }, [map, animated]);

  const groupRef = useRef<THREE.Group>(null);
  const wallRefs = useRef<(THREE.Mesh | null)[]>([]);
  const wallCapRefs = useRef<(THREE.Mesh | null)[]>([]);
  const doorRefs = useRef<(THREE.Mesh | null)[]>([]);
  const floorMatRefs = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  // Unlit basic material (see ROCK_TINT above) — the skirt never picks up
  // torchlight, matching the floor's own unlit bake.
  const borderMatRef = useRef<THREE.MeshBasicMaterial | null>(null);
  // The border's own ink outline (see Outline.tsx's D2 fix comment) — faded
  // in step with borderMatRef below instead of its old always-opaque-at-1
  // default, so beat 0 "pre-dawn" doesn't show the room's full silhouette
  // traced in ink before riseT has moved at all.
  const borderOutlineMatRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const contactShadowMatRef = useRef<THREE.MeshBasicMaterial | null>(null);
  // Wall/door material refs — lerp `.color` (a tint multiplied over the
  // baked albedo texture) toward the night palette as beat 5's clockT
  // climbs (see WALL_NIGHT_TINT/WOOD_NIGHT_TINT above), and — D2 value
  // inversion fix — also carry `.opacity` now, matched every frame to the
  // exact same per-wall/per-door `p` (staggered easeSettle) that already
  // drives their scale.y grow below. mesh.scale.y=0 collapses a wall/door's
  // top+bottom caps onto the SAME y=0 plane rather than making them
  // disappear — from this diorama's near-nadir camera those caps are
  // exactly what's facing the lens, so an un-grown wall used to still paint
  // its full flattened footprint in solid ink from frame one. Harmless
  // against the old dark-on-dark void; a stark, fully-formed room outline
  // showing through beat 0 "pre-dawn" and racing ahead of beat 1's own
  // stroke-by-stroke ink reveal against D2's light floor/parchment. Same
  // fix, wall CAPS and wall/door OUTLINES below (own ref arrays each).
  const wallMatRefs = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const wallCapMatRefs = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const wallOutlineMatRefs = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const doorOutlineMatRefs = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  // Baked torch-pool glow quads track the same staggered ignition curve as
  // their point light (see the loop below) so the painted pool and the
  // dynamic light always arrive together.
  const glowMatRefs = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  // Beat 2 "The rise" focal accent: a small treasure glint in the SE room,
  // only at the end-pin (art-brief: "one focal accent — the treasure glint
  // ... in the SE room").
  const glintGlowRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const glintDotRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const gridHintMatRef = useRef<THREE.LineBasicMaterial | null>(null);

  const growCount = walls.length + doors.length;

  useFrame(() => {
    if (!animated) return;
    const { inkT, riseT, clockT, swapT } = sceneProgress;
    // Beat 0 "Whisper": both progress vars are still exactly 0 for the
    // entire scroll span of the (unpinned) whisper section — see
    // ScrollCamera.tsx's trigger remap — so this window reliably covers
    // only beat 0, never beat 1's own draw.
    const preDawn = inkT === 0 && riseT === 0;
    // D2 fix round (finding 2): clockT alone latches at 1 from beat 5 onward
    // (it's never reset) — gating by (1 - swapT) is what lets the floor/
    // wall/door/cap night tints actually return to day values as beat 6's
    // swap completes, instead of showing a day map on a still-night world
    // through beats 6-8. Same "own * (1 - next)" shape as TableScene.tsx's
    // own nightT and composition.tsx's COPY_BEATS.
    const nightT = clockT * (1 - swapT);
    // Tail window (see DOOR_INK_PHASE_START) for the door-gap hints — same
    // fraction for every door, they're small marks meant to land together
    // right at the end of the stroke sequence, not their own mini-sequence.
    const doorInkT = THREE.MathUtils.clamp((inkT - DOOR_INK_PHASE_START) / (1 - DOOR_INK_PHASE_START), 0, 1);
    // Per-wall-segment rise progress, populated below by the walls loop and
    // read right after by the ink-line loop — a plain local array (not a
    // ref) since both loops run synchronously within this one useFrame call.
    const wallRiseP: number[] = new Array(walls.length);

    // Floor/border are the unlit-baked surfaces (see the floor mesh's own
    // comment below) — only opacity (riseT, the reveal) is allowed to move
    // their on-screen value. The night tint uses frontLoad(clockT), not raw
    // clockT, so mid-scrub already reads blue-grey rather than a muddy
    // linear half-blend between the warm day ratio and the cool night one.
    const floorNightT = frontLoad(nightT);
    for (const material of floorMatRefs.current) {
      if (material) {
        material.opacity = riseT;
        material.color.copy(WHITE).lerp(FLOOR_NIGHT_TINT, floorNightT);
      }
    }
    if (borderMatRef.current) {
      borderMatRef.current.opacity = riseT;
      borderMatRef.current.color.copy(WHITE).lerp(BORDER_NIGHT_TINT, floorNightT);
    }
    if (borderOutlineMatRef.current) borderOutlineMatRef.current.opacity = riseT;
    if (contactShadowMatRef.current) contactShadowMatRef.current.opacity = riseT;

    walls.forEach((_, i) => {
      const p = easeSettle(staggered(riseT, i, growCount));
      wallRiseP[i] = p;
      const mesh = wallRefs.current[i];
      if (mesh) mesh.scale.y = p;
      const cap = wallCapRefs.current[i];
      if (cap) {
        cap.scale.y = p;
        cap.position.y = WALL_HEIGHT * p;
      }
      const mat = wallMatRefs.current[i];
      if (mat) {
        mat.opacity = p;
        const [cx, cz] = wallCenters[i];
        let nearest = Infinity;
        for (const torch of map.torches) {
          const d = Math.hypot(torch.pos.x - cx, torch.pos.z - cz);
          if (d < nearest) nearest = d;
        }
        // riseT-gated (no glow before torches have actually caught) and
        // clamped by construction — see WALL_CAP_RATIO above.
        const torchT = riseT * (1 - THREE.MathUtils.smoothstep(nearest, 0, TORCH_DISTANCE));
        // D2 fix round (finding 6): the old chain — WHITE -> WALL_NIGHT_TINT
        // (by clockT) -> WALL_CAP_RATIO (by torchT) — applied the torch lerp
        // SECOND, so torchT pulled the already-brightened night color back
        // toward WALL_CAP_RATIO's day-scale ratio (~1x), landing torch-
        // adjacent walls ~3x DARKER at night than walls with no torch nearby.
        // Torch tint now applies first (day-scale, as before), night tint
        // applies last and fades the torch term out as nightT climbs
        // (torchT * (1 - nightT)) — so night always wins the final value,
        // and torch response smoothly recedes into the night tint instead of
        // fighting it.
        mat.color.copy(WHITE).lerp(WALL_CAP_RATIO, torchT * (1 - nightT)).lerp(WALL_NIGHT_TINT, nightT);
      }
      const capMat = wallCapMatRefs.current[i];
      if (capMat) {
        capMat.opacity = p;
        // D2 fix round (finding 5): caps never carried the night tint at all
        // (only opacity was driven here) — they stayed warm olive while the
        // wall faces below went blue-grey, framing every night wall in its
        // own day color. Same swap-gated nightT as everything else.
        capMat.color.copy(WHITE).lerp(CAP_NIGHT_TINT, nightT);
      }
      const outlineMat = wallOutlineMatRefs.current[i];
      if (outlineMat) outlineMat.opacity = p;
    });

    // Ink strokes: authored order (wallPolylineMeta's own start/end window
    // per polyline, proportional to length) drives the draw-in; each
    // polyline's fade-out on the way to riseT=1 uses THAT polyline's own
    // slowest (last) wall segment's rise progress — not raw riseT — so a
    // late-order polyline's stroke can never vanish before its own wall has
    // actually started rising to replace it (the ink->rise "no pop" fix).
    map.wallPolylines.forEach((polyline, i) => {
      const line = inkLines[i];
      const meta = wallPolylineMeta[i];
      if (!line || !meta) return;
      const localT = THREE.MathUtils.clamp((inkT - meta.start) / (meta.end - meta.start || 1), 0, 1);
      const posAttr = line.geometry.getAttribute('position') as THREE.BufferAttribute;
      posAttr.set(revealPositions(polyline, localT, INK_HEIGHT));
      posAttr.needsUpdate = true;
      const colorAttr = line.geometry.getAttribute('color') as THREE.BufferAttribute;
      colorAttr.set(revealColors(polyline, localT));
      colorAttr.needsUpdate = true;
      const lastP = THREE.MathUtils.clamp(wallRiseP[meta.range[1]] ?? 0, 0, 1);
      (line.material as THREE.LineBasicMaterial).opacity = 1 - lastP;
    });

    // Grid hint: fades in as a background wash early in the ink beat, holds,
    // then fades back out as riseT climbs — the baked floor texture carries
    // its own (much subtler) etched grid once the floor itself is visible,
    // so this placeholder only ever needs to cover the pre-floor window.
    if (gridHintMatRef.current) {
      gridHintMatRef.current.opacity = GRID_HINT_MAX * THREE.MathUtils.smoothstep(inkT, 0, 0.3) * (1 - riseT);
    }

    doors.forEach((door, j) => {
      const mesh = doorRefs.current[j];
      if (!mesh) return;
      const p = easeSettle(staggered(riseT, walls.length + j, growCount));
      mesh.scale.y = p;
      mesh.position.y = door.center[1] * p;
      const frameMat = doorFrameMats[j];
      if (frameMat) frameMat.opacity = p;
      const doorMat = doorSideMats[j];
      if (doorMat) {
        doorMat.opacity = p;
        doorMat.color.copy(WHITE).lerp(WOOD_NIGHT_TINT, nightT);
      }
      const doorTopMat = doorTopMats[j];
      if (doorTopMat) {
        doorTopMat.opacity = p;
        doorTopMat.color.copy(WHITE).lerp(PROP_WOOD_NIGHT_TINT, nightT);
      }
      const doorOutlineMat = doorOutlineMatRefs.current[j];
      if (doorOutlineMat) doorOutlineMat.opacity = p;
      // Door-gap ink hint: same authored-tail draw-in (doorInkT) + same
      // own-progress fade-out (this door's own `p`, not raw riseT) as the
      // wall strokes above, capped at DOOR_INK_MAX_OPACITY for the lighter
      // "detail" weight (style-guide rule 3).
      const hintLine = doorInkLines[j];
      if (hintLine) {
        const rawDoor = map.doors[j];
        const pts = [rawDoor.a, rawDoor.b];
        const posAttr = hintLine.geometry.getAttribute('position') as THREE.BufferAttribute;
        posAttr.set(revealPositions(pts, doorInkT, INK_HEIGHT));
        posAttr.needsUpdate = true;
        const colorAttr = hintLine.geometry.getAttribute('color') as THREE.BufferAttribute;
        colorAttr.set(revealColors(pts, doorInkT));
        colorAttr.needsUpdate = true;
        (hintLine.material as THREE.LineBasicMaterial).opacity =
          DOOR_INK_MAX_OPACITY * (1 - THREE.MathUtils.clamp(p, 0, 1));
      }
    });

    map.torches.forEach((_, i) => {
      // Clamped to [0,1] — easeSettle's back-ease overshoots past 1 while a
      // torch is catching (fine for the wall/door grow-scale bounce above,
      // which reads as a settle), but here it fed straight into light
      // intensity and pool opacity, briefly blowing both past their own
      // end-frame values mid-rise ("torch pools washed large" mid-pin).
      let p = THREE.MathUtils.clamp(easeSettle(staggered(riseT, i, map.torches.length)), 0, 1);
      if (preDawn && i < EMBER_TORCH_COUNT) p = EMBER_FRACTION;
      const glow = glowMatRefs.current[i];
      if (glow) glow.opacity = p;
    });

    // Treasure glint: only reads once the rise is essentially settled.
    const glint = THREE.MathUtils.smoothstep(riseT, 0.82, 1);
    if (glintGlowRef.current) glintGlowRef.current.opacity = glint * 0.8;
    if (glintDotRef.current) glintDotRef.current.opacity = glint;
  });

  // Beat 6 "The swap" — independent of `animated`: it moves both the
  // outgoing (main) and incoming (swap) diorama, not just the primary one.
  // The incoming map (swapOffsetY > 0) also gets its own warm fill light,
  // ramped in with swapT: WorldTurns' shared ambient/sun are already
  // night-dim by this point (clockT stuck at 1 from beat 5), so without a
  // local light the incoming map would rise into the same dim wash as the
  // outgoing one — failing "incoming map rises already day-graded" and
  // "never both [maps] below 40%" (art-brief beat 6).
  const swapRiseLightRef = useRef<THREE.PointLight | null>(null);
  useFrame(() => {
    if (!swapOffsetY || !groupRef.current) return;
    const group = groupRef.current;
    group.position.y = position[1] + swapOffsetY * sceneProgress.swapT;
    if (swapRiseLightRef.current) swapRiseLightRef.current.intensity = sceneProgress.swapT * SWAP_RISE_LIGHT_INTENSITY;
    if (swapOffsetY > 0) {
      // The incoming map sits fully opaque and fully lit at rest — sunk
      // below ground, but nothing actually occludes it there: the outgoing
      // map's own floor is itself transparent (opacity tied to riseT)
      // through beats 0-1, so the opaque swap map underneath was bleeding
      // straight through as a lit room-shaped ghost in frame long before
      // beat 6 ever runs. Only cull it in.
      group.visible = sceneProgress.swapT > 0.001;
    } else {
      // Outgoing map: sinking its group alone barely reads from this
      // beat's near-nadir overhead camera (a few world units of Y barely
      // shifts anything on screen), so the old rig kept sitting there as a
      // fully lit, fully opaque room next to the incoming one — a
      // permanent triptych instead of a completed swap. Shrink its walls
      // toward the floor as swapT climbs (<=30% height by swapT 0.5, gone
      // by ~0.67) so it visibly collapses, then cull the whole group once
      // swapT completes so nothing outgoing — floor, border, torches —
      // lingers behind the incoming map.
      const shrink = THREE.MathUtils.clamp(1 - sceneProgress.swapT * OUTGOING_SWAP_SHRINK_RATE, 0, 1);
      for (const mesh of wallRefs.current) if (mesh) mesh.scale.y *= shrink;
      for (const mesh of wallCapRefs.current) if (mesh) mesh.scale.y *= shrink;
      for (const mesh of doorRefs.current) if (mesh) mesh.scale.y *= shrink;
      group.visible = sceneProgress.swapT < 1;
    }
  });

  return (
    <group ref={groupRef} position={position}>
      {/* Ambient + directional light are WorldTurns.tsx's job — one shared
          rig for the whole scene (art-style-guide rule 5: "one global
          shadow direction per map"). This file used to *also* mount a warm
          ambient, doubling it up on top of WorldTurns' own and washing every
          wall warm regardless of the day/night scrub — the value-inversion
          global defect. */}
      {swapOffsetY > 0 && (
        <pointLight
          ref={swapRiseLightRef}
          position={[mapCenter[0], 6, mapCenter[1]]}
          color="#eda94e"
          intensity={0}
          distance={20}
          decay={1.6}
        />
      )}
      {/* Floor is unlit on purpose (value-diagnosis.md finding 1): three
          rounds of tuning ambient/exposure/torch intensity against
          ACESFilmicToneMapping never landed the albedo at its authored
          #2b2e26 — the tonemap's shadow-region compression ate every fix.
          MeshBasicMaterial + toneMapped=false makes the baked albedo (incl.
          the etched grid seam) arrive at the framebuffer verbatim, immune to
          that whole chain. Torch warmth now comes only from the additive
          glow decal below (getTorchGlowTexture) — the dynamic point lights
          still light walls/doors but no longer touch the floor. */}
      {floors.map((floor, i) => (
        <mesh key={i} geometry={floor.geometry} position={floor.center}>
          <meshBasicMaterial
            ref={(m) => {
              floorMatRefs.current[i] = m;
            }}
            map={getFloorTexture(FLOOR_TINT, FLOOR_SEAM_TINT).map}
            toneMapped={false}
            transparent={animated}
            opacity={animated ? 0 : 1}
          />
        </mesh>
      ))}
      {/* Dark contact ellipse under the whole footprint, well below the
          skirt, so the diorama reads as sitting on something rather than
          floating (enhancement doc Part 1 move 5b). Normal (non-additive)
          blending: it darkens whatever it sits over — now the wood table
          skirt/parchment field rather than the old void, which if anything
          reads more correctly (a model actually casts a contact shadow onto
          a lit table; it wouldn't onto a void). */}
      <mesh position={[mapCenter[0], CONTACT_SHADOW_Y, mapCenter[1]]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={mapExtent} />
        <meshBasicMaterial
          ref={contactShadowMatRef}
          map={getRadialGlowTexture('#000000', 0.55, 0.28)}
          transparent
          opacity={animated ? 0 : 1}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      {/* Wood table skirt around the floor union's exterior, unlit and
          noise-displaced (mapBorderGeometry — same ragged silhouette as the
          old rock skirt, just wood-grained now), receding below floor level
          so the model reads as sitting IN its table board rather than
          floating on top of it. Unlit like the floor — MeshBasicMaterial
          ignores torchlight and never receives shadows, keeping it on the
          same baked value ladder as the floor. */}
      <mesh geometry={mapBorder} position={[0, -BORDER_HEIGHT, 0]}>
        <meshBasicMaterial
          ref={borderMatRef}
          map={getWoodTexture(BORDER_WOOD_TINT, BORDER_WOOD_SEAM_TINT).map}
          toneMapped={false}
          transparent={animated}
          opacity={animated ? 0 : 1}
        />
        <Outline
          geometry={mapBorderOutline}
          matRef={(m) => {
            borderOutlineMatRef.current = m;
            if (m) m.opacity = animated ? 0 : 1;
          }}
        />
      </mesh>
      {walls.map((geometry, i) => (
        <mesh
          key={i}
          ref={(m) => {
            wallRefs.current[i] = m;
          }}
          geometry={geometry}
          scale={animated ? [1, 0, 1] : [1, 1, 1]}
        >
          <meshBasicMaterial
            ref={(m) => {
              wallMatRefs.current[i] = m;
              if (m) m.opacity = animated ? 0 : 1;
            }}
            map={getWallTexture(WALL_TINT).map}
            toneMapped={false}
            transparent={animated}
            opacity={animated ? 0 : 1}
          />
          <Outline
            geometry={wallOutlines[i]}
            matRef={(m) => {
              wallOutlineMatRefs.current[i] = m;
              if (m) m.opacity = animated ? 0 : 1;
            }}
          />
        </mesh>
      ))}
      {wallCaps.map((geometry, i) => (
        <mesh
          key={`cap-${i}`}
          ref={(m) => {
            wallCapRefs.current[i] = m;
          }}
          geometry={geometry}
          position={[0, animated ? 0 : WALL_HEIGHT, 0]}
          scale={animated ? [1, 0, 1] : [1, 1, 1]}
        >
          {/* Issue 5: was toon-lit; WALL_CAP_TOON_TINT is WALL_CAP_TINT x0.35
              (see its own comment above) — WALL_CAP_TINT itself stays
              untouched since the already-unlit Brazier aliases it via
              BRAZIER_TINT. */}
          <meshBasicMaterial
            ref={(m) => {
              wallCapMatRefs.current[i] = m;
              if (m) m.opacity = animated ? 0 : 1;
            }}
            map={getWallTexture(WALL_CAP_TOON_TINT).map}
            toneMapped={false}
            transparent={animated}
            opacity={animated ? 0 : 1}
          />
        </mesh>
      ))}
      {doors.map((door, i) => (
        <mesh
          key={i}
          ref={(m) => {
            doorRefs.current[i] = m;
            const externalRef = doorRefsById?.[map.doors[i].id];
            if (externalRef) externalRef.current = m;
          }}
          geometry={door.geometry}
          position={animated ? [door.center[0], 0, door.center[2]] : door.center}
          rotation-y={door.rotationY}
          scale={animated ? [1, 0, 1] : [1, 1, 1]}
          // BoxGeometry face order [+x,-x,+y,-y,+z,-z]: index 2 (top) is the
          // one this diorama's near-nadir camera actually looks at — see
          // getDoorTopTexture's own comment. The other five keep sharing the
          // one doorSideMats instance, same as before this was an array.
          material={[
            doorSideMats[i],
            doorSideMats[i],
            doorTopMats[i],
            doorSideMats[i],
            doorSideMats[i],
            doorSideMats[i],
          ]}
        >
          <Outline
            geometry={doorOutlines[i]}
            matRef={(m) => {
              doorOutlineMatRefs.current[i] = m;
              if (m) m.opacity = animated ? 0 : 1;
            }}
          />
        </mesh>
      ))}
      {doorFrames.map((frame, i) => (
        <group key={`frame-${i}`}>
          <mesh geometry={frame.jambs[0].geometry} position={frame.jambs[0].position} rotation-y={frame.rotationY} material={doorFrameMats[i]} />
          <mesh geometry={frame.jambs[1].geometry} position={frame.jambs[1].position} rotation-y={frame.rotationY} material={doorFrameMats[i]} />
          <mesh geometry={frame.lintel.geometry} position={frame.lintel.position} rotation-y={frame.rotationY} material={doorFrameMats[i]} />
        </group>
      ))}
      {/* Background-texture critique P3-12: from a near-nadir camera the
          stone LINTEL (spanning leaf-top to wall-top, wider and deeper than
          the leaf) is what actually occludes the door's bright wood top —
          the swap map's beat-6 camera is true enough nadir that its door
          read as a dark slab. A thin plan-view decal just above the lintel
          gives every non-secret door the same seam+studs top read at any
          camera, reusing that door's own doorTopMats instance so fade-in
          and night tint stay in lockstep with the leaf for free. Secret
          doors are skipped: their leaf is swapped out per-pane by
          SceneRenderer's trust split, and a decal this machinery doesn't
          manage would leak the door into the player pane. */}
      {doors.map((door, i) =>
        map.doors[i].secret ? null : (
          <group key={`door-top-decal-${i}`} position={[door.center[0], WALL_HEIGHT + 0.005, door.center[2]]} rotation-y={door.rotationY}>
            <mesh rotation-x={-Math.PI / 2} material={doorTopMats[i]}>
              <planeGeometry args={[door.geometry.parameters.width, WALL_THICKNESS * 1.6]} />
            </mesh>
          </group>
        ),
      )}
      {animated && inkLines.map((line, i) => <primitive key={`ink-${i}`} object={line} />)}
      {animated && doorInkLines.map((line, i) => <primitive key={`door-ink-${i}`} object={line} />)}
      {animated && gridHintGeometry && (
        <lineSegments geometry={gridHintGeometry}>
          <lineBasicMaterial ref={gridHintMatRef} color={INK_DIM} transparent opacity={0} toneMapped={false} />
        </lineSegments>
      )}
      {animated &&
        secretExtras &&
        (() => {
          const secretIndex = map.doors.findIndex((d) => d.secret);
          if (secretIndex === -1 || !secretWallFiller) return null;
          const secretDoor = doors[secretIndex];
          const rawDoor = map.doors[secretIndex];
          const gapLength = Math.hypot(rawDoor.b.x - rawDoor.a.x, rawDoor.b.z - rawDoor.a.z);
          return (
            <group key="secret-extras">
              {/* DM-pane-only marker, top-down facing: the amber dashed
                  break across the gap, plus a circular "S" badge above it —
                  both hidden by default, toggled together by SceneRenderer
                  during beat 4's DM-pane render pass.
                  C6 fix round: two bugs made this invisible. (1) the dash
                  plane's long axis ran along world X — correct for an X-run
                  door, but this door's own gap runs along Z (a=(10,6),
                  b=(10,5)) so the dash crossed straight over the wall
                  instead of lying along the gap. Fixed by rotating the whole
                  group to the door's own rotationY (doorGeometry already
                  computes it, same value doorFrames carries) — position the
                  group AT the door center instead, so the meshes' own
                  positions stay local (rotating around the door, not the
                  world origin). (2) both planes sat well below the door
                  mesh's own top face (doorHeight = secretDoor.center[1]*2 at
                  rest), so the door's opaque top drew straight over them at
                  this near-nadir camera. Lifted both above that. */}
              <group
                ref={secretExtras.badgeRef}
                visible={false}
                position={[secretDoor.center[0], 0, secretDoor.center[2]]}
                rotation-y={secretDoor.rotationY}
              >
                {/* X2 fix round: the door's own lintel (doorFrameParts, an
                    opaque box spanning y [doorLeafHeight, WALL_HEIGHT]) sat
                    ABOVE these markers when they rode secretDoor.center[1]*2
                    (~1.9-1.93) — occluded from this near-nadir camera. Lifted
                    past the wall cap's own top (WALL_HEIGHT +
                    WALL_CAP_HEIGHT) instead of re-deriving from the door
                    mesh, so the lintel can never again outgrow this offset. */}
                <mesh position={[0, WALL_HEIGHT + WALL_CAP_HEIGHT + 0.03, 0]} rotation-x={-Math.PI / 2}>
                  <planeGeometry args={[gapLength, 0.3]} />
                  <meshBasicMaterial map={getDashTexture()} transparent depthWrite={false} toneMapped={false} />
                </mesh>
                <mesh position={[0, WALL_HEIGHT + WALL_CAP_HEIGHT + 0.06, 0]} rotation-x={-Math.PI / 2}>
                  <circleGeometry args={[0.22, 20]} />
                  <meshBasicMaterial map={getBadgeTexture()} transparent depthWrite={false} toneMapped={false} />
                </mesh>
              </group>
              {/* X1 fix round: needs `transparent` so SceneRenderer's
                  trustGlow-driven opacity fade (player pane, fading this
                  wall-filler IN as the door leaf fades out) actually blends
                  instead of drawing fully opaque regardless of opacity. */}
              <mesh ref={secretExtras.fogRef} geometry={secretWallFiller} position={[0, 0, 0]} visible={false}>
                {/* Issue 5: was toon-lit reusing WALL_TINT; DOOR_FRAME_TOON_TINT
                    is that hex x0.35 (see its own comment) so this unlit
                    swap reads the same on screen — the trustGlow opacity
                    fade above this comment is untouched. */}
                <meshBasicMaterial map={getWallTexture(DOOR_FRAME_TOON_TINT).map} toneMapped={false} transparent opacity={0} />
              </mesh>
            </group>
          );
        })()}
      {/* Phase D trust-beat dressing: static room props (brazier/crates/
          vault/bones — mapData.ts's MapDef.props). Fades in with riseT and
          night-tints with the world like everything else here; see the Props
          component and its kind components below Diorama. F8 fix round: no
          longer gated on `animated` — SWAP_MAP's own (non-animated) instance
          now carries props too, and its global riseT is already 1 by the
          time that instance ever becomes visible (swapT gates it, well after
          the rise), so they simply render at rest instead of animating in.
          R3 fix round: props inside FOG_RECT (the vault, crates-b, bones-b)
          render under the shared fogHiddenRef group below instead — split
          here so this call only ever renders the ones that must stay visible
          in the player pane. */}
      {map.props && <Props props={animated ? map.props.filter((p) => !inFogRect(p.pos)) : map.props} />}
      {/* R3 fix round: everything the player-pane fog must genuinely hide —
          props inside FOG_RECT, the SE-room treasure glint (sits inside t4's
          own pool, well within FOG_RECT), and the torch pools whose torch
          falls inside FOG_RECT — now lives under ONE group, toggled once by
          SceneRenderer's player pass (fogHiddenRef, focalAccents.tsx) instead
          of a per-object ref each new fog-hidden thing had to remember to
          wire up. Only ever mounted for the animated (MAIN_MAP) instance —
          the only one beat 4's dual-pane pass renders. */}
      {animated && (
        <group
          ref={(g) => {
            fogHiddenRef.current = g;
          }}
        >
          {map.props && <Props props={map.props.filter((p) => inFogRect(p.pos))} />}
          {/* Beat 2 "The rise" focal accent: treasure glint in the SE room,
              reading only once the rise has essentially settled. Sits inside
              t4's own baked torch pool (see map.torches below), so it needs a
              hotter, tighter core than that pool's own diffuse falloff
              (getTorchGlowTexture, core alpha 0.12) or it just reads as more
              of the same ambient wash — getRadialGlowTexture's punchier core
              is what actually lets it win as "the enforced single focal" per
              the art brief, not one more torch-pool-sized glow. */}
          <group position={[14.3, 0, 5.3]}>
            <mesh position={[0, INK_HEIGHT + 0.015, 0]} rotation-x={-Math.PI / 2}>
              <planeGeometry args={[1.4, 1.4]} />
              <meshBasicMaterial
                ref={glintGlowRef}
                map={getRadialGlowTexture('#eda94e', 0.9, 0.4)}
                transparent
                opacity={0}
                depthWrite={false}
                blending={THREE.AdditiveBlending}
                toneMapped={false}
              />
            </mesh>
            {/* Additive (not the flat opaque blend a solid sphere would
                normally get) and sized up from the original 0.05 — flat-blend
                amber at the SAME value as the ambient torch-pool wash it sits
                inside had ~zero contrast against that wash, which is the
                other half of why this accent read as "absent". Additive
                guarantees a genuine hotspot regardless of what's under it. */}
            <mesh position={[0, 0.06, 0]}>
              <sphereGeometry args={[0.14, 8, 8]} />
              <meshBasicMaterial
                ref={glintDotRef}
                color="#eda94e"
                transparent
                opacity={0}
                blending={THREE.AdditiveBlending}
                toneMapped={false}
              />
            </mesh>
          </group>
          {map.torches.map(
            (torch, i) =>
              inFogRect(torch.pos) && (
                <mesh
                  key={torch.id}
                  geometry={torchPools[i].geometry}
                  position={[torchPools[i].center[0], INK_HEIGHT + 0.01, torchPools[i].center[1]]}
                  rotation-x={-Math.PI / 2}
                >
                  <meshBasicMaterial
                    ref={(m) => {
                      glowMatRefs.current[i] = m;
                    }}
                    map={getTorchGlowTexture()}
                    transparent
                    opacity={0}
                    depthWrite={false}
                    toneMapped={false}
                  />
                </mesh>
              ),
          )}
        </group>
      )}
      {map.torches.map((torch, i) => (
        <group key={torch.id}>
          {/* Issue 5, light deletion: this used to also mount a pointLight
              here — every material in the scene is unlit MeshBasicMaterial
              now, so a dynamic torch light fed nothing (the warm response
              below is entirely the baked glow decal + the torchT proximity
              lerp on the wall/door materials, both already independent of
              this light). Verified live: removing it changed zero on-screen
              pixels. TORCH_DISTANCE (above) stays — it still sizes the
              torchT falloff those baked lerps use. */}
          {/* Baked warm pool on the floor under the torch — see
              getTorchGlowTexture. Pools inside FOG_RECT render under the
              fogHiddenRef group above instead (R3 fix round) — skip it here
              so it isn't drawn twice. */}
          {!(animated && inFogRect(torch.pos)) && (
            <mesh
              geometry={torchPools[i].geometry}
              position={[torchPools[i].center[0], INK_HEIGHT + 0.01, torchPools[i].center[1]]}
              rotation-x={-Math.PI / 2}
            >
              <meshBasicMaterial
                ref={(m) => {
                  glowMatRefs.current[i] = m;
                }}
                map={getTorchGlowTexture()}
                transparent
                opacity={animated ? 0 : 1}
                depthWrite={false}
                // Normal (not additive) blending — see getTorchGlowTexture's
                // own comment: additive over the now-light floor blows to white.
                toneMapped={false}
              />
            </mesh>
          )}
        </group>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Phase D room props (mapData.ts's Prop list). Self-contained components,
// each with its own useFrame reading sceneProgress directly — same pattern
// composition.tsx's CopyVignette/PoolBoosts already use — rather than
// routing through the big useFrame above: these don't stagger like walls
// and doors, they just night-tint like the floor/border already do, so one
// small shared helper covers all of them. Renamed from fadeAndNight (crate
// x-ray fix, issue 6): the reveal used to be this function's own
// `mat.opacity = riseT` line, which put every prop body in three.js's
// transparent/alphaHash pass — alphaHash discards fragments stochastically
// to fake the fade, which leaves holes in the depth buffer (the outline
// hull and the floor draw straight through them) and can't converge under
// `frameloop="demand"` (no temporal accumulation), so a half-faded crate
// read as a frozen dither, not a dissolve. The reveal is now each prop's own
// group.scale.y growing from 0 (Brazier/CrateStack/BonePile/Vault below),
// the same opaque, depth-writing technique walls and doors already use — so
// this helper only ever touches color now. Narrowed to MeshBasicMaterial
// (issue 5): every remaining caller is unlit now, no toon materials survive
// in this file.
// Leaving the bodies opaque is deliberate and it has ONE consequence worth
// knowing before touching these materials again: `material.opacity` does
// nothing at all on a material with `transparent === false`, so beat 4's
// player pane cannot conceal a prop by fading it. The props inside FOG_RECT
// are hidden there by SceneRenderer's fogHiddenRef pass, which flips
// `transparent` on for exactly that beat and leaves depth-write alone —
// see the capture block in its useFrame. Do not re-add
// `transparent`/`alphaHash` here to "make the fade work": at beat 4 it is
// already handled, and everywhere else it would only put these bodies back
// in the transparent queue during the grow-in for no gain.
function applyNightTint(mat: THREE.MeshBasicMaterial | null, nightTint: THREE.Color) {
  if (!mat) return;
  const { clockT, swapT } = sceneProgress;
  mat.color.copy(WHITE).lerp(nightTint, clockT * (1 - swapT));
}

/** Marks torch t2's own fixture — every OTHER torch in this map is still
 * just a point light + floor glow with no physical vessel; this is the one
 * place that gets an actual iron bowl, so it doubles as "the room's own
 * light source, made visible" and Room A's own dressing prop. */
function Brazier({ pos }: { pos: Vec2 }) {
  const bowlGeo = useMemo(() => new THREE.CylinderGeometry(0.26, 0.16, 0.3, 12), []);
  const bowlOutline = useMemo(() => outlineGeometry(bowlGeo, OUTLINE_EPS_PROP), [bowlGeo]);
  const legGeo = useMemo(() => new THREE.CylinderGeometry(0.08, 0.11, 0.5, 8), []);
  const legOutline = useMemo(() => outlineGeometry(legGeo, OUTLINE_EPS_PROP), [legGeo]);
  // Background-texture critique P3-11: at nadir the bowl read as concentric
  // target rings. Two handle nubs on the rim break the rotational symmetry,
  // and each instance gets its own deterministic rotation (hashed off its
  // position) so the nub axis never repeats across the map's braziers.
  const nubGeo = useMemo(() => new THREE.BoxGeometry(0.14, 0.06, 0.07), []);
  const nubMat = useMemo(() => new THREE.MeshBasicMaterial({ map: getWallTexture(BRAZIER_TINT).map, toneMapped: false }), []);
  const instanceRotation = useMemo(() => (Math.sin(pos.x * 12.9898 + pos.z * 78.233) * 43758.5453) % (Math.PI * 2), [pos]);
  // F4 fix round: darker inset ring, sitting just above the bowl's own top
  // cap (not coplanar — see the ember/rim y-offsets below) so it reads as a
  // shadowed cavity rather than z-fighting the cap it sits on. Narrower than
  // the bowl's own top radius (0.26) on both ends — a visible sliver of the
  // bowl's own cap shows outside it (the rim) and the ember (radius 0.13)
  // pokes through the middle — so the cap, rim, and ember all actually read
  // as three distinct tones instead of the rim swallowing the whole top.
  const rimGeo = useMemo(() => {
    const g = new THREE.RingGeometry(0.135, 0.22, 16);
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);
  const bowlMatRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const legMatRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const rimMatRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const shadowRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const emberRef = useRef<THREE.MeshBasicMaterial | null>(null);
  // Crate x-ray fix (issue 6): the whole fixture grows out of the floor via
  // group.scale.y instead of fading its bodies via opacity — see
  // applyNightTint's comment. `visible` gates the exact riseT=0 frame: a
  // box-shaped prop's TOP face doesn't vanish the way a wall's vertical body
  // does when scale.y collapses to 0 (a wall's side faces degenerate to zero
  // area; a box's flat top/bottom faces don't, they just collapse onto the
  // floor plane as a fully opaque textured decal), so an explicit visibility
  // cutoff is what actually gets to zero rather than a coincident-with-the-
  // floor footprint ghost.
  const groupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    applyNightTint(bowlMatRef.current, BRAZIER_NIGHT_TINT);
    applyNightTint(legMatRef.current, BRAZIER_NIGHT_TINT);
    applyNightTint(rimMatRef.current, BRAZIER_RIM_NIGHT_TINT);
    applyNightTint(nubMat, BRAZIER_NIGHT_TINT);
    const riseT = sceneProgress.riseT;
    if (groupRef.current) {
      groupRef.current.visible = riseT > 0;
      groupRef.current.scale.y = easeSettle(riseT);
    }
    if (shadowRef.current) shadowRef.current.opacity = riseT;
    if (emberRef.current) emberRef.current.opacity = riseT * 0.8;
  });

  return (
    <group ref={groupRef} position={[pos.x, 0, pos.z]} rotation-y={instanceRotation}>
      <mesh position={[0, INK_HEIGHT + 0.005, 0]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[0.85, 0.85]} />
        <meshBasicMaterial ref={shadowRef} map={getRadialGlowTexture('#000000', 0.4, 0.18)} transparent opacity={0} depthWrite={false} toneMapped={false} />
      </mesh>
      {/* P3-11 handle nubs: straddling the rim at bowl-lip height, opposite
          sides — the nadir read gains one clear non-radial axis. */}
      <mesh geometry={nubGeo} position={[0.3, 0.76, 0]} material={nubMat} />
      <mesh geometry={nubGeo} position={[-0.3, 0.76, 0]} material={nubMat} />
      <mesh geometry={legGeo} position={[0, 0.25, 0]}>
        <meshBasicMaterial ref={legMatRef} map={getWallTexture(BRAZIER_TINT).map} toneMapped={false} />
        <Outline geometry={legOutline} />
      </mesh>
      <mesh geometry={bowlGeo} position={[0, 0.65, 0]}>
        <meshBasicMaterial ref={bowlMatRef} map={getWallTexture(BRAZIER_TINT).map} toneMapped={false} />
        <Outline geometry={bowlOutline} />
      </mesh>
      {/* F4 fix round: cavity-rim ring, sitting just above the bowl's top
          cap (y=0.65+0.15=0.8) — see rimGeo's own comment. Textured (not a
          flat `color` prop) for the same reason the bowl/legs are: applyNightTint
          always overwrites `.color` to a WHITE(day)/tint(night) multiplier —
          the file's own "map + neutral color multiplier" convention — so a
          flat-color material here rendered solid WHITE at day, not
          BRAZIER_RIM_TINT (this round's own regression, caught in browser
          verification). */}
      <mesh position={[0, 0.803, 0]} geometry={rimGeo}>
        <meshBasicMaterial ref={rimMatRef} map={getWallTexture(BRAZIER_RIM_TINT).map} toneMapped={false} />
      </mesh>
      {/* Embers in the bowl — same additive-dot recipe as the treasure
          glint below, just amber-only (no radial glow plane; the bowl's own
          torch pool on the floor already covers that). F4 fix round: raised
          from y=0.68 (BELOW the bowl's own opaque top cap at y=0.8, where it
          was depth-occluded and effectively invisible from this near-nadir
          camera) to just above the rim ring, so it actually reads. */}
      <mesh position={[0, 0.809, 0]} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[0.13, 14]} />
        <meshBasicMaterial ref={emberRef} color="#eda94e" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** Two stacked boxes, top offset/rotated off the base — reads as a
 * haphazard crate stack rather than one big flat-topped block from the
 * near-nadir camera. */
function CrateStack({ pos, rotationY = 0 }: { pos: Vec2; rotationY?: number }) {
  const baseGeo = useMemo(() => new THREE.BoxGeometry(0.7, 0.42, 0.55), []);
  const baseOutline = useMemo(() => outlineGeometry(baseGeo, OUTLINE_EPS_PROP), [baseGeo]);
  const topGeo = useMemo(() => new THREE.BoxGeometry(0.5, 0.34, 0.42), []);
  const topOutline = useMemo(() => outlineGeometry(topGeo, OUTLINE_EPS_PROP), [topGeo]);
  const baseMatRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const topMatRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const shadowRef = useRef<THREE.MeshBasicMaterial | null>(null);
  // Crate x-ray fix (issue 6): group.scale.y grow-in replaces the old
  // alphaHash fade — see applyNightTint's comment for the full mechanism.
  const groupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    applyNightTint(baseMatRef.current, PROP_WOOD_NIGHT_TINT);
    applyNightTint(topMatRef.current, PROP_WOOD_NIGHT_TINT);
    const riseT = sceneProgress.riseT;
    if (groupRef.current) {
      groupRef.current.visible = riseT > 0;
      groupRef.current.scale.y = easeSettle(riseT);
    }
    if (shadowRef.current) shadowRef.current.opacity = riseT;
  });

  return (
    <group ref={groupRef} position={[pos.x, 0, pos.z]} rotation-y={rotationY}>
      <mesh position={[0, INK_HEIGHT + 0.005, 0]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[1.1, 1]} />
        <meshBasicMaterial ref={shadowRef} map={getRadialGlowTexture('#000000', 0.4, 0.18)} transparent opacity={0} depthWrite={false} toneMapped={false} />
      </mesh>
      {/* Background-texture critique P3-10 / issue 6: the two boxes used to
          fade via alphaHash, which left depth-buffer holes the outline hull
          and floor drew through (a frozen dither, not a dissolve, under
          frameloop="demand"). The stack now grows opaquely out of the floor
          with the rest of this group (see groupRef above) — no transparency
          on the box bodies at all, so no x-ray of any kind is possible. */}
      {/* Issue 5: was toon-lit; CRATE_WOOD_TINT/CRATE_WOOD_SEAM_TINT are
          PROP_WOOD_TINT/PROP_WOOD_SEAM_TINT x0.35 (own comment above) — a
          dedicated pair since PROP_WOOD_TINT itself still feeds the
          already-unlit door tops. */}
      <mesh geometry={baseGeo} position={[0, 0.21, 0]}>
        <meshBasicMaterial ref={baseMatRef} map={getWoodTexture(CRATE_WOOD_TINT, CRATE_WOOD_SEAM_TINT).map} toneMapped={false} />
        <Outline geometry={baseOutline} />
      </mesh>
      <mesh geometry={topGeo} position={[0.09, 0.42 + 0.17, 0.05]} rotation-y={0.35}>
        <meshBasicMaterial ref={topMatRef} map={getWoodTexture(CRATE_WOOD_TINT, CRATE_WOOD_SEAM_TINT).map} toneMapped={false} />
        <Outline geometry={topOutline} />
      </mesh>
    </group>
  );
}

// Three bone shafts fanned around a small skull — kept low-count (perf +
// simplicity) rather than a real particle scatter.
const BONE_LAYOUT: [number, number, number][] = [
  [-0.15, Math.PI / 2.3, -0.05],
  [0.06, Math.PI / 1.9, 0.13],
  [0.18, Math.PI / 2.7, -0.15],
];

function BonePile({ pos }: { pos: Vec2 }) {
  const boneGeo = useMemo(() => new THREE.CylinderGeometry(0.035, 0.045, 0.5, 6), []);
  const boneOutline = useMemo(() => outlineGeometry(boneGeo, OUTLINE_EPS_PROP), [boneGeo]);
  const skullGeo = useMemo(() => new THREE.SphereGeometry(0.13, 8, 8), []);
  const skullOutline = useMemo(() => outlineGeometry(skullGeo, OUTLINE_EPS_PROP), [skullGeo]);
  const boneMatRefs = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const skullMatRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const shadowRef = useRef<THREE.MeshBasicMaterial | null>(null);
  // Crate x-ray fix (issue 6): same group.scale.y grow-in as CrateStack —
  // see applyNightTint's comment. The individual bone shafts are rotated off
  // the Y axis (rotation-z, lying on their sides), so this group-level scale
  // reads as the pile "flattening up" out of the floor rather than a literal
  // lengthwise grow, same character as a wall cap thickening — the point is
  // the same one applyNightTint's comment makes: no transparency anywhere
  // on the bodies, so no x-ray is possible during the transition.
  const groupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    boneMatRefs.current.forEach((m) => applyNightTint(m, BONE_NIGHT_TINT));
    applyNightTint(skullMatRef.current, BONE_NIGHT_TINT);
    const riseT = sceneProgress.riseT;
    if (groupRef.current) {
      groupRef.current.visible = riseT > 0;
      groupRef.current.scale.y = easeSettle(riseT);
    }
    if (shadowRef.current) shadowRef.current.opacity = riseT;
  });

  return (
    <group ref={groupRef} position={[pos.x, 0, pos.z]}>
      <mesh position={[0, INK_HEIGHT + 0.005, 0]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[0.75, 0.6]} />
        <meshBasicMaterial ref={shadowRef} map={getRadialGlowTexture('#000000', 0.4, 0.18)} transparent opacity={0} depthWrite={false} toneMapped={false} />
      </mesh>
      {/* Issue 5: was toon-lit; BONE_TINT is darkened in place (own comment
          above, x0.35) since no unlit sibling shares it. */}
      {BONE_LAYOUT.map(([x, rotZ, z], i) => (
        <mesh key={i} geometry={boneGeo} position={[x, 0.08, z]} rotation-z={rotZ} rotation-y={i * 0.7}>
          <meshBasicMaterial
            ref={(m) => {
              boneMatRefs.current[i] = m;
            }}
            map={getWallTexture(BONE_TINT).map}
            toneMapped={false}
          />
          <Outline geometry={boneOutline} />
        </mesh>
      ))}
      <mesh geometry={skullGeo} position={[0.02, 0.13, 0.02]}>
        <meshBasicMaterial ref={skullMatRef} map={getWallTexture(BONE_TINT).map} toneMapped={false} />
        <Outline geometry={skullOutline} />
      </mesh>
    </group>
  );
}

/** The beat-4 prize: a banded strongbox with a warm glint spilling from its
 * lid seam — the "something worth hiding" the trust beat's own founding
 * complaint named. getDoorTexture reused for both box parts (its plank +
 * iron-band recipe already IS a strongbox's read), but F5 fix round: base
 * and lid now carry their OWN tints (VAULT_BASE/LID_TINT above) instead of
 * PROP_WOOD_TINT — the same wood every crate uses, which is why this prop
 * used to be indistinguishable from a crate stack. Placed well clear of the
 * existing SE-room treasure glint (this file's own beat-2 focal, ~line 900)
 * — see mapData.ts's own vault-placement comment — so beat 4 reads its own
 * single focal accent instead of two glints competing in one corner. */
function Vault({ pos }: { pos: Vec2 }) {
  // F5 fix round: wider, lower footprint than the old (0.95/0.42/0.62)
  // base — reads as a squat strongbox rather than a tall crate-shaped box —
  // sized to still clear the secret room's own walls (mapData.ts, 1.5 units
  // wide) with margin either side at this rotation.
  const baseGeo = useMemo(() => new THREE.BoxGeometry(1.05, 0.34, 0.68), []);
  const baseOutline = useMemo(() => outlineGeometry(baseGeo, OUTLINE_EPS_PROP), [baseGeo]);
  const lidGeo = useMemo(() => new THREE.BoxGeometry(1.12, 0.15, 0.74), []);
  const lidOutline = useMemo(() => outlineGeometry(lidGeo, OUTLINE_EPS_PROP), [lidGeo]);
  const baseMatRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const lidMatRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const shadowRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const seamRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const glowRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const dotRef = useRef<THREE.MeshBasicMaterial | null>(null);
  // Crate x-ray fix (issue 6): same group.scale.y grow-in as CrateStack —
  // see applyNightTint's comment.
  const groupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    applyNightTint(baseMatRef.current, VAULT_BASE_NIGHT_TINT);
    applyNightTint(lidMatRef.current, VAULT_LID_NIGHT_TINT);
    const riseT = sceneProgress.riseT;
    if (groupRef.current) {
      groupRef.current.visible = riseT > 0;
      groupRef.current.scale.y = easeSettle(riseT);
    }
    if (shadowRef.current) shadowRef.current.opacity = riseT;
    // Same "reads once the rise has essentially settled" gate as the SE
    // room's own glint (Diorama's main useFrame above) — holds through every
    // later beat that keeps riseT at 1. Unrelated to the body's own reveal
    // (glowRef/seamRef/dotRef are flat additive decals, depthWrite:false —
    // never a body-solidity concern, kept exactly as before).
    const glint = THREE.MathUtils.smoothstep(riseT, 0.82, 1);
    if (seamRef.current) seamRef.current.opacity = glint * 0.9;
    if (glowRef.current) glowRef.current.opacity = glint * 0.85;
    if (dotRef.current) dotRef.current.opacity = glint;
  });

  const baseHeight = 0.34;
  const lidCenterY = baseHeight + 0.075;
  const lidTop = lidCenterY + 0.075;

  return (
    <group ref={groupRef} position={[pos.x, 0, pos.z]} rotation-y={0.15}>
      <mesh position={[0, INK_HEIGHT + 0.005, 0]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[1.55, 1.15]} />
        <meshBasicMaterial ref={shadowRef} map={getRadialGlowTexture('#000000', 0.45, 0.2)} transparent opacity={0} depthWrite={false} toneMapped={false} />
      </mesh>
      {/* Issue 5: was toon-lit; VAULT_BASE/LID_TINT+SEAM darkened in place
          (own comment above, x0.35). */}
      <mesh geometry={baseGeo} position={[0, baseHeight / 2, 0]}>
        <meshBasicMaterial ref={baseMatRef} map={getDoorTexture(VAULT_BASE_TINT, VAULT_BASE_SEAM_TINT).map} toneMapped={false} />
        <Outline geometry={baseOutline} />
      </mesh>
      <mesh geometry={lidGeo} position={[0, lidCenterY, 0]}>
        <meshBasicMaterial ref={lidMatRef} map={getDoorTexture(VAULT_LID_TINT, VAULT_LID_SEAM_TINT).map} toneMapped={false} />
        <Outline geometry={lidOutline} />
      </mesh>
      {/* F5 fix round: glint moved from the base's south face (occluded from
          every camera in this scene — they all look down, near-nadir; a
          vertical south-facing plane only the PLAYER pane's own oblique
          angle could ever catch, exactly backwards from the brief) to the
          lid's own top surface, where every camera looks straight at it. A
          thin bright seam strip across the lid plus the existing
          radial-glow + additive-dot recipe (same as the SE room's own
          treasure glint), stacked in ascending y so they layer correctly
          under this near-nadir camera regardless of draw order. */}
      <mesh position={[0, lidTop + 0.004, 0]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[1.0, 1.0]} />
        <meshBasicMaterial
          ref={glowRef}
          map={getRadialGlowTexture('#eda94e', 0.9, 0.4)}
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
      <mesh position={[0, lidTop + 0.007, 0]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[0.9, 0.08]} />
        <meshBasicMaterial ref={seamRef} color="#f4c878" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      <mesh position={[0, lidTop + 0.012, 0]}>
        <sphereGeometry args={[0.08, 8, 8]} />
        <meshBasicMaterial ref={dotRef} color="#eda94e" transparent opacity={0} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Props({ props }: { props: Prop[] }) {
  return (
    <>
      {props.map((prop) => {
        switch (prop.kind) {
          case 'brazier':
            return <Brazier key={prop.id} pos={prop.pos} />;
          case 'crate':
            return <CrateStack key={prop.id} pos={prop.pos} rotationY={prop.rotationY} />;
          case 'vault':
            // R3 fix round: no longer wraps its own concealment ref — the
            // caller (Diorama's own render, above) already routes every
            // in-FOG_RECT prop through the shared fogHiddenRef group, so the
            // vault just renders like any other prop here.
            return <Vault key={prop.id} pos={prop.pos} />;
          case 'bones':
            return <BonePile key={prop.id} pos={prop.pos} />;
          default:
            return null;
        }
      })}
    </>
  );
}
