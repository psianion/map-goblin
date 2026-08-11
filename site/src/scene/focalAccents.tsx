// One-focal-accent-per-beat system (enhancement doc Part 1, move 2): each
// beat gets exactly one small emissive dot + additive glow sprite, lit by
// that beat's own sceneProgress flag and dim everywhere else. Unlit/additive
// materials, amber palette only — same recipe as Diorama.tsx's existing
// torch pools and treasure glint (getRadialGlowTexture, toneMapped: false).
//
// Beats 2 (treasure glint) and 3 (sight ring) already carry their own focal
// accent, built inline where their state already lives (Diorama.tsx's glint
// group, SightSweep.tsx's ring) — not duplicated here. This module covers
// the three beats that had none (5 held pool, 6 incoming hearth, 7 glowing
// map) plus beat 4's two trust-split tokens (TrustTokens below) — the
// secret-door badge itself is still Diorama.tsx's own group, toggled by
// SceneRenderer. Eyes (beat 8) are DOM, out of scope.
import { useFrame } from '@react-three/fiber';
import { forwardRef, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { outlineGeometry } from './geometry';
import { MAIN_MAP, MAIN_WALL_SEGMENTS, PARTY_SIGHT_RADIUS, SWAP_MAP, SWAP_MAP_OFFSET, TRUST_PLAYER_SIGHT_ORIGIN, TRUST_TOKENS, type Vec2 } from './mapData';
import { Outline, OUTLINE_EPS_PROP } from './Outline';
import { sceneProgress } from './sceneProgress';
import { getRadialGlowTexture, getTokenTexture } from './textures';
import { clipPolygonToRect, computeVisibilityPolygon } from './visibility';

interface AccentConfig {
  /** World position, sampled fresh every frame — the swap map's accents
   * ride the same rise Diorama.tsx applies to its own group. */
  position: () => [number, number, number];
  color: string;
  /** 0 skips the dot mesh (glow sprite only). */
  dotRadius: number;
  glowSize: number;
  /** 0..1 — how lit the accent is this frame. */
  getOpacity: () => number;
}

const swapMapCenter = (() => {
  const xs = SWAP_MAP.floors.flatMap((f) => [f.min.x, f.max.x]);
  const zs = SWAP_MAP.floors.flatMap((f) => [f.min.z, f.max.z]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2] as const;
})();

// Beat 5 "held amber pools": the brighter of the two diagonal hearths
// (art-brief: "+10% at full night") — t4, SE room, echoing beat 2's own SE
// focal for continuity. Position is static: this accent is only ever opaque
// during beat 5's own pin, well before the swap ever moves the main map.
const HELD_POOL: AccentConfig = {
  position: () => {
    const t4 = MAIN_MAP.torches.find((t) => t.id === 't4')!;
    return [t4.pos.x, 0.09, t4.pos.z];
  },
  color: '#eda94e',
  dotRadius: 0.07,
  glowSize: 2.2,
  getOpacity: () => (sceneProgress.worldActive ? sceneProgress.clockT : 0),
};

// Beat 6 "incoming hearth": one big lit pool at the swap map's center,
// riding the same SWAP_MAP_OFFSET + swapT*swapOffsetY rise Diorama.tsx uses
// for that diorama's own group — "alive before the map finishes rising".
const INCOMING_HEARTH: AccentConfig = {
  position: () => [
    SWAP_MAP_OFFSET[0] + swapMapCenter[0],
    SWAP_MAP_OFFSET[1] + 3 * sceneProgress.swapT + 0.1,
    SWAP_MAP_OFFSET[2] + swapMapCenter[1],
  ],
  color: '#eda94e',
  dotRadius: 0.09,
  glowSize: 3.2,
  // F7 fix round: swapT never resets once beat 6 finishes, so this dot used
  // to stay lit straight through beats 7-8 (originally patched by * (1 - kitT)).
  // G4 (final critique round): even with that, the beat-6 SETTLED frame
  // (swapT 1, kitT still 0) held the beacon at full opacity — a fixtureless
  // amber dot + halo mid-floor once the room's own two braziers have taken
  // over the light story. This accent's job ends when the rise does: fade
  // over the swap's last quarter (same window as composition.tsx's
  // SwapGlow), which also makes the old kitT term redundant — opacity is
  // already 0 for every beat past the swap (swapT never resets).
  getOpacity: () => sceneProgress.swapT * (1 - THREE.MathUtils.smoothstep(sceneProgress.swapT, 0.72, 1)),
};

// Beat 7 "glowing map": the swap map, now resting on the table, reads as the
// single brightest object in frame — a broad boosted wash under its
// footprint that grows with the pull-back so it wins over the room's own
// overhead lamp.
const GLOWING_MAP: AccentConfig = {
  position: () => [SWAP_MAP_OFFSET[0] + swapMapCenter[0], 0.1, SWAP_MAP_OFFSET[2] + swapMapCenter[1]],
  color: '#eda94e',
  dotRadius: 0,
  glowSize: 7,
  // F8 fix round: at full (kitT) opacity this wash blew out the floor's own
  // grid/stone grain under it, leaving the "hero map" reading as a blank
  // warm glow instead of a textured map. Capped at 0.6 — still the brightest
  // wash in frame, but the baked floor detail underneath now survives it.
  getOpacity: () => sceneProgress.kitT * 0.6,
};

const ACCENTS: AccentConfig[] = [HELD_POOL, INCOMING_HEARTH, GLOWING_MAP];

type ObjRef = { current: THREE.Object3D | null };

// Beat 4 "Trust": module-scope handles to the two token meshes below, read
// directly by SceneRenderer's per-pane render loop — same shared-mutable-
// singleton pattern as sceneProgress, and SceneRenderer already reaches
// sibling meshes this way (secretDoorRef etc.) rather than threading more
// ref props through Canvas3D for one beat.
export const trustTokenRefs: { red: ObjRef; blue: ObjRef } = {
  red: { current: null },
  blue: { current: null },
};

// R3 fix round: one shared group for EVERYTHING that must be genuinely
// absent from the player pane — was concealedPropsRef (vault only) plus a
// second fogCoveredPoolRefs array (per-torch-pool), and both still missed
// siblings that also sit inside FOG_RECT (bones-b, crates-b, the SE-room
// treasure glint) because each new fog-hidden object needed its own ref
// wired through by hand. Diorama.tsx now parents every prop/pool/glint whose
// position falls inside FOG_RECT under ONE <group ref={fogHiddenRef}> —
// three.js skips traversing a non-visible object's children entirely, so
// toggling this one group's `visible` hides the whole set in a single write,
// and nothing new placed inside FOG_RECT can be added to the scene without
// also landing under this group (same "can't forget it" guarantee the old
// per-object ref pattern didn't have).
export const fogHiddenRef: ObjRef = { current: null };

// Shared by SightSweep.tsx too (F15/F16): the beat-3 walking token and the
// beat-4 trust tokens are the exact same painted disc, just at different
// points in the pin timeline, so one Token component now covers both — the
// old inline copy in SightSweep.tsx popped visibly at the pin boundary
// (flat toon cylinder -> painted cap) at the exact map position the copy
// calls "the same token now resting" (PATH's last point and
// TRUST_TOKENS.red are kept in sync — see mapData.ts).
export const TOKEN_RADIUS = 0.32;
const TOKEN_HEIGHT = 0.08;
export const TOKEN_LIFT = TOKEN_HEIGHT / 2 + 0.02;
const CONTACT_SHADOW_SIZE = TOKEN_RADIUS * 9; // ~4.5x radius: alpha at the token's own edge lands ~0.35, see getRadialGlowTexture call below
const SIGHT_RING_RADIUS = TOKEN_RADIUS * (26 / 17); // matches the mockup's token SVG: fill r=17, sight ring r=26
const SIGHT_RING_WIDTH = 0.045;

// Issue 5 (split unlit/toon value system): capMaterial and the rim were the
// last two toon-lit surfaces in this file. capMaterial's `emissive` prop
// (SightSweep's own walking token, the only caller that sets it) has no
// MeshBasicMaterial equivalent — an unlit material's `color` is already
// full-strength verbatim output, so both the toon ramp's diffuse multiply
// AND the additive emissive glow have to be folded into one baked tint
// instead of dropped. Measured live rather than guessed (fix-plan issue 5
// step 2): screenshotted the cap on screen, then again with a probe
// MeshBasicMaterial(color:white, same map) to isolate the capTexture's own
// baked value, then divided the two in linear space (sRGB-decoded) and
// re-encoded — same recipe Diorama.tsx's toon-conversion tints use.
//
// TOKEN_DIFFUSE_TINT: every caller that does NOT set emissive (both trust
// tokens, focalAccents.tsx's TrustToken), keyed by `color` prop. First pass
// tried one shared achromatic tint (mean of the two measured ratios below) on
// the theory that toon-shading intensity is hue-independent for a flat top
// face under one light rig — measured wrong: re-verified on screen and the
// shared tint landed the red token 37/255 low, well outside the ±4/255
// match this issue requires (docs/2026-08-11-nine-issue-fix-plan.md §5 test
// 2). The two measured ratios differ enough per channel (red: linear 0.506,
// 0.537, 0.453 — blue: 0.598, 0.448, 0.332) that capTexture's own per-color
// bake (the highlight/shadow stops in getTokenTexture, textures.ts) must be
// sampled at slightly different relative UVs at each screen size, so each
// color keeps its own measured tint instead of a formula.
const TOKEN_DIFFUSE_TINT: Record<string, string> = {
  '#b53a3a': '#b5afa0', // red — TrustToken, measured at the trust beat's DM pane, one correction pass
  '#3a5bb5': '#bda798', // blue — TrustToken, measured at the trust beat's DM pane, one correction pass
};
// TOKEN_RED_EMISSIVE_TINT: SightSweep.tsx's own token, the one caller that
// sets emissive (color '#b53a3a', emissive '#4a1512'). The additive emissive
// term skews the ratio per channel (warm — R > G ~= B: measured linear
// (0.563, 0.460, 0.383)) on top of everything TOKEN_DIFFUSE_TINT's own
// comment already says about not sharing a formula across colors, so this is
// its own measured tint too. Measured the same way, at the sight beat's own
// token position. If a second emissive color is ever added, it needs its own
// measured tint — this one is red-specific, not a general emissive formula.
const TOKEN_RED_EMISSIVE_TINT = '#c6b5a6';
// Rim (cylinder side wall): flat per-token color, no map, so no per-surface
// measurement needed — same vertical/side-facing class as every other flat
// toon->unlit conversion in this codebase (Diorama.tsx's
// DOOR_FRAME_TOON_TINT/WALL_CAP_TOON_TINT), which all use the background-
// texture-rescore doc's measured toon-vs-unlit factor (~0.35x, finding
// P1-C). Confirmed live rather than assumed: a radial pixel scan across the
// token's silhouette at the sight beat found the rim's own band read within
// a few linear values of Outline's INK_OUTLINE (the ink hull drawn just
// outside it, Outline.tsx) — the rim is genuinely not independently visible
// at this near-nadir camera, matching this component's own long-standing
// comment below. The factor is still applied rather than left at the old
// (now too-bright) 0.55 alone, so the value is principled, not arbitrary,
// if the camera angle or hull thickness ever changes.
const TOKEN_TOON_FACTOR = 0.35;

interface TokenProps {
  color: string;
  position: [number, number, number];
  visible: boolean;
  /** Matches SightSweep's old flat-cylinder emissive read so the beat-3 ->
   * beat-4 handoff doesn't brighten/dim at the pin boundary. */
  emissive?: string;
  sightRing?: boolean;
  contactShadow?: boolean;
}

// S3: painted tokens, not flat vector discs. The cylinder is kept for
// silhouette/outline, but the rim itself is painted into the cap texture
// (getTokenTexture, F12) — the side wall is unreadable as a rim under this
// diorama's near-nadir camera. A separate decal plane underneath adds the
// soft contact shadow, reusing the same radial-falloff helper every other
// baked glow in this file uses (getRadialGlowTexture), tinted near-black.
export const Token = forwardRef<THREE.Group, TokenProps>(function Token(
  { color, position, visible, emissive, sightRing = false, contactShadow = false },
  ref,
) {
  const geometry = useMemo(() => new THREE.CylinderGeometry(TOKEN_RADIUS, TOKEN_RADIUS, TOKEN_HEIGHT, 24), []);
  const outline = useMemo(() => outlineGeometry(geometry, OUTLINE_EPS_PROP), [geometry]);
  const rimColor = useMemo(() => new THREE.Color(color).multiplyScalar(0.55 * TOKEN_TOON_FACTOR), [color]);
  const capTexture = useMemo(() => getTokenTexture(color), [color]);
  // One material instance reused for both cap groups (F21) — the bottom cap
  // faces the floor and is never actually seen, so it just needs *a*
  // material, not a second one. Issue 5: unlit now, per TOKEN_DIFFUSE_TINT/
  // TOKEN_RED_EMISSIVE_TINT's own comment above.
  const capMaterial = useMemo(() => {
    let tint = emissive ? TOKEN_RED_EMISSIVE_TINT : TOKEN_DIFFUSE_TINT[color];
    if (!tint) {
      // Fails loud in dev rather than silently rendering an unmeasured
      // color wrong — same posture as Diorama.tsx's assertNightRatiosDoNotBlowOut.
      if (import.meta.env.DEV) console.warn(`Token: no measured tint for color ${color} — add one to TOKEN_DIFFUSE_TINT`);
      tint = '#ffffff';
    }
    return new THREE.MeshBasicMaterial({ color: tint, map: capTexture, toneMapped: false });
  }, [capTexture, color, emissive]);
  const sightRingGeometry = useMemo(() => {
    const g = new THREE.RingGeometry(SIGHT_RING_RADIUS - SIGHT_RING_WIDTH, SIGHT_RING_RADIUS, 32);
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);

  return (
    <group ref={ref} position={position} visible={visible}>
      <mesh geometry={geometry}>
        <meshBasicMaterial attach="material-0" color={rimColor} toneMapped={false} />
        <primitive object={capMaterial} attach="material-1" />
        <primitive object={capMaterial} attach="material-2" />
        <Outline geometry={outline} />
        {sightRing && (
          <mesh geometry={sightRingGeometry} position={[0, TOKEN_HEIGHT / 2 + 0.01, 0]}>
            <meshBasicMaterial color="#eda94e" transparent opacity={0.7} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
          </mesh>
        )}
      </mesh>
      {contactShadow && (
        <mesh rotation-x={-Math.PI / 2} position-y={-TOKEN_LIFT + 0.006}>
          <planeGeometry args={[CONTACT_SHADOW_SIZE, CONTACT_SHADOW_SIZE]} />
          <meshBasicMaterial map={getRadialGlowTexture('#0a0806', 0.45, 0.2)} transparent depthWrite={false} toneMapped={false} />
        </mesh>
      )}
    </group>
  );
});

function TrustToken({ pos, color, target }: { pos: Vec2; color: string; target: ObjRef }) {
  return (
    <Token
      ref={(g) => {
        target.current = g;
      }}
      color={color}
      position={[pos.x, TOKEN_LIFT, pos.z]}
      visible={false}
      contactShadow
    />
  );
}

// Beat 4 "Trust": the party's own token (red) resting where beat 3's walk
// ended (TRUST_TOKENS.red matches SightSweep's own PATH end, mapData.ts),
// plus a second token (blue) behind the secret door — art-brief: "DM pane
// has both tokens, player pane only the red one." Both start hidden;
// SceneRenderer's dual-pane render pass toggles them per pane while beat 4
// is pinned, and hides both again once the pin releases. One decoration
// mismatch survives the handoff: SightSweep's walking token carries a
// sightRing and no contactShadow, TrustToken below is the reverse — not
// unified since the two never overlap on screen at the pin boundary itself.
function TrustTokens() {
  return (
    <>
      <TrustToken pos={TRUST_TOKENS.red} color="#b53a3a" target={trustTokenRefs.red} />
      <TrustToken pos={TRUST_TOKENS.blue} color="#3a5bb5" target={trustTokenRefs.blue} />
    </>
  );
}

// Beat 4 "Trust", player pane: replaces a flat box that used to black out
// the whole east room — nearly the entire pane, since the camera itself
// pans to frame Room B by the end of this beat's own scrub — with a real
// visibility polygon (visibility.ts, the same sweep beat 3 uses) held
// static from the corridor's own open archway. Room B has no interior
// walls, so most of it reads in sight through that legitimate opening;
// only the secret door's own wall segment (an unconditional blocker, same
// as SightSweep's handling of it) and anything past PARTY_SIGHT_RADIUS stay dark.
// Room B's own footprint plus a pad past its walls — the fog only needs to
// cover the room the secret door hides, not the corridor/Room A the player
// already legitimately sees (never masked, never was).
// F3 fix round: min.x pulled from 9.6 to 8.2 to also cover the new secret
// room (mapData.ts, x 8.5-10 behind the west-secret door) — the old bound
// stopped short of that room's own west wall, so most of its floor sat
// outside this rect and never got blacked out at all.
export const FOG_RECT = { min: { x: 8.2, z: -0.5 }, max: { x: 16.5, z: 7.5 } };
const FOG_Y = 0.05;

export const playerFogRef: ObjRef = { current: null };

function PlayerFog() {
  // Static: this beat holds rather than walks, so the polygon is swept once
  // and never rebuilt per frame (SightSweep's own wedge rebuilds every frame
  // only because its origin moves along a path — ours doesn't).
  const geometry = useMemo(() => {
    // The sweep itself isn't bounded to Room B — it happily reaches back
    // through the open archway into the corridor/Room A too (real geometry,
    // not a fake mask), and the origin sits outside FOG_RECT to begin with
    // (in the corridor, west of it — see TRUST_PLAYER_SIGHT_ORIGIN's own
    // comment). Clipped to FOG_RECT before becoming a hole: a hole that
    // reaches past its own outer rect can triangulate wrong, and the
    // corridor/Room A were never masked in the first place, so nothing is
    // lost by not fogging that reach here. (Bounding the sweep by
    // construction instead — passing FOG_RECT's own edges into the segment
    // list below — looks cheaper but is wrong with an outside-the-rect
    // origin: the near edge becomes every ray's closest blocker and kills
    // the reveal entirely. See clipPolygonToRect's own comment.)
    const polygon = clipPolygonToRect(
      computeVisibilityPolygon(TRUST_PLAYER_SIGHT_ORIGIN, MAIN_WALL_SEGMENTS, PARTY_SIGHT_RADIUS),
      FOG_RECT,
    );
    const shape = new THREE.Shape();
    shape.moveTo(FOG_RECT.min.x, -FOG_RECT.min.z);
    shape.lineTo(FOG_RECT.max.x, -FOG_RECT.min.z);
    shape.lineTo(FOG_RECT.max.x, -FOG_RECT.max.z);
    shape.lineTo(FOG_RECT.min.x, -FOG_RECT.max.z);
    shape.closePath();
    // Same CCW-sweep -> CW-shape flip as SightSweep's own wedge: the sweep
    // is angle-sorted CCW in (x,z), the shape's (x,-z) flip turns that CW,
    // so the hole needs the opposite winding again to cut cleanly.
    const hole = new THREE.Path();
    [...polygon].reverse().forEach((p, i) => {
      if (i === 0) hole.moveTo(p.x, -p.z);
      else hole.lineTo(p.x, -p.z);
    });
    hole.closePath();
    shape.holes = [hole];
    const geom = new THREE.ShapeGeometry(shape);
    geom.rotateX(-Math.PI / 2);
    return geom;
  }, []);

  return (
    <mesh
      ref={(m) => {
        playerFogRef.current = m;
      }}
      geometry={geometry}
      position={[0, FOG_Y, 0]}
      visible={false}
    >
      {/* C4 fix round: 0.86 still let the hidden room's grid/walls read at
          12-16% of their lit value under the baked floor texture — the copy
          claims the data is genuinely absent, so the fog needs to read as
          near-opaque, not a light tint. */}
      <meshBasicMaterial color="#080706" transparent opacity={0.96} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

// Beat 4 "Trust"'s own warm vignette used to live here as a camera-portaled
// mesh (TrustGrade) — but useThree().camera is never itself added to the
// scene graph by R3F, so a mesh parented to it via createPortal was never in
// any render list (never drew), and even fixed it would've put only the
// gradient's transparent core on screen (a 40x40 quad at z=-3 with a
// 256px-texture-sized radial falloff). Replaced by an imperative DOM overlay
// owned by SceneRenderer.tsx (same pattern as its .pane-tags poke) — a
// screen-space div is trivial to size/position correctly and needs no scene
// graph at all. See SceneRenderer.tsx's trustVignetteEl.

function Accent({ config }: { config: AccentConfig }) {
  const groupRef = useRef<THREE.Group>(null);
  const dotMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const glowMatRef = useRef<THREE.MeshBasicMaterial>(null);

  useFrame(() => {
    const [x, y, z] = config.position();
    if (groupRef.current) groupRef.current.position.set(x, y, z);
    const opacity = config.getOpacity();
    if (dotMatRef.current) dotMatRef.current.opacity = opacity;
    if (glowMatRef.current) glowMatRef.current.opacity = opacity * 0.8;
  });

  return (
    <group ref={groupRef}>
      {config.dotRadius > 0 && (
        <mesh position-y={-0.01}>
          <sphereGeometry args={[config.dotRadius, 8, 8]} />
          <meshBasicMaterial ref={dotMatRef} color={config.color} transparent opacity={0} toneMapped={false} />
        </mesh>
      )}
      <mesh rotation-x={-Math.PI / 2}>
        <planeGeometry args={[config.glowSize, config.glowSize]} />
        <meshBasicMaterial
          ref={glowMatRef}
          map={getRadialGlowTexture(config.color, 0.8, 0.3)}
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

export function FocalAccents() {
  return (
    <>
      {ACCENTS.map((config, i) => (
        <Accent key={i} config={config} />
      ))}
      <TrustTokens />
      <PlayerFog />
    </>
  );
}
