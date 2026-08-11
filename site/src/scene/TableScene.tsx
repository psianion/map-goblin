// The table world (D2 "the lit table"): a wood table + a parchment map sheet
// the diorama physically stands on, always present — beats 0-6 see the sheet
// under the model with wood beyond its edges wherever the camera's FOV
// reaches it, same as beat 7 "The kit" / beat 8 "The door", the pulled-back
// camera reveals this file otherwise exists for (table-scatter props: dice,
// mug, chair; a taller exit door beat 8 settles on). Table/sheet planes sit
// just under floor level (TABLE_Y/SHEET_Y, both negative) so beat 6's
// swap-in-place still reads as "walls rise up through it" rather than
// clipping oddly. The geometry and camera choreography are static — reveals
// are the existing scroll-driven camera pull-back (cameraPath.ts) — but the
// table-scatter PROPS below still fade in on sceneProgress.kitT (0 before
// beat 7's pull-back starts) so they don't bleed past earlier beats' tight
// framing; the table/sheet themselves are no longer part of that fade (see
// their own always-on materials below).
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { doorFrameParts, doorGeometry, outlineGeometry, withUv2 } from './geometry';
import { Outline, OUTLINE_EPS_PROP, OUTLINE_EPS_STRUCTURE } from './Outline';
import { sceneProgress } from './sceneProgress';
import {
  getDiceFaceTexture,
  getDoorTexture,
  getRadialGlowTexture,
  getSheetShadowTexture,
  getSheetTexture,
  getTableWoodTexture,
  getWallTexture,
} from './textures';

// D2 "the lit table" (docs/2026-08-07-landing-art-pass-d2-plan.md, adjudicated
// decision 1): the table world is real, always-present scene geometry, not a
// beat-7-only reveal — a physical model standing on a map sheet on a wood
// table, visible (if the camera's FOV reaches it) at every beat. Stacked
// bottom-up so nothing z-fights: wood table (TABLE_Y) < its shadow < the
// sheet's own drop shadow < the parchment sheet (SHEET_Y) < the diorama's
// wood skirt (Diorama.tsx BORDER_HEIGHT, base -0.12) < the floor (y=0).
const TABLE_Y = -0.18;
// Issue 4 fix: named so getTableWoodTexture (textures.ts) can derive the
// LAMP_WORLD pool's UV position from the SAME numbers the plane geometry and
// mesh position below use, instead of a second hardcoded copy — the P1-A bug
// was exactly two correct-alone, contradictory-together numbers (the plane
// grew to this size without the bake's lamp position following it).
const TABLE_CENTER: [number, number] = [8, 3.5];
const TABLE_SIZE: [number, number] = [120, 64];
// Sheet: comfortably bigger than MAIN_MAP's floor+skirt footprint (x 0-16,
// z 0-7, centered ~8/3.5) so wood shows beyond it on every side, comfortably
// smaller than the 26x16 wood table so the table's own edge never shows
// through it at the beats that frame close on the map.
const SHEET_CENTER: [number, number] = [8, 3.5];
const SHEET_SIZE: [number, number] = [21, 13];
const SHEET_Y = -0.13;
const SHEET_SHADOW_Y = -0.145;
// Board recipe: `.sheet { transform: rotate(-0.6deg) }` — a slight physical
// misalignment between "a sheet someone set down" and "the wood grain under
// it". Small enough that it never fights the diorama's own axis-aligned
// grid at the tight, near-nadir framing beats 2-6 use (verified visually).
const SHEET_ROTATION_Y = THREE.MathUtils.degToRad(-0.6);
const DOOR_HEIGHT = 4;
const DOOR_THICKNESS = 0.3;
// Door + stone arch are structure; dice/mug/chair are props/clutter — same
// tiering as Diorama.tsx (art-style-guide rule 3), see scene/Outline.tsx.
const OUTLINE_EPS_DOOR = OUTLINE_EPS_STRUCTURE;
const OUTLINE_EPS = OUTLINE_EPS_PROP;
// getWoodTexture bakes a vertical light-top/dark-bottom grade from this mid
// tint (art-brief: table wood "#4A3420 -> #2A1E11 gradient").
// D2 fix round (finding 3): the table plane used to be a lit MeshToonMaterial
// (see below) — its 4-step toon ramp quantized this same grade into visible
// bands, and its shadow-side band (~0.235x) crushed the bottom of the
// gradient toward near-black regardless of what was baked here. Value system
// contract says bake the value, don't tune the lit chain, so the plane is
// now unlit and this base tint is picked so ±26 (paintWoodGrade's fixed
// delta) lands the grade directly in the target range: top #8a6138 (the
// board's --wood-lit) down to a bottom that never drops below the board's
// --wood-deep (#3a2717) floor.
const WOOD_TINT = '#70471e';
const WOOD_SEAM_TINT = '#241a0f';
// Issue 5 (split unlit/toon value system): the exit door leaf, its stone
// frame/arch, the hinge straps, and the DM chair were the last four toon-lit
// surfaces in this file — none share their tint with an already-unlit
// sibling in THIS file, so all four are darkened in place. Measured factor:
// the background-texture rescore doc found toon-shaded surfaces render
// ~0.35x an unlit surface of the same hex (`docs/2026-08-08-background-
// texture-rescore.md`, finding P1-C) — every value below is the old toon
// hex, srgb-decoded, multiplied by 0.35 in linear space, re-encoded.
const DOOR_WOOD_TINT = '#412b17';
const DOOR_SEAM_TINT = '#2b1a0b';
// Exit-door frame trim: kept as its own near-black stone rather than
// following Diorama.tsx's WALL_TINT into the D2 value inversion — this trim
// isn't part of the map's own floor/wall read, and beat 8's door stage stays
// dark-stone-in-shadow regardless of the map's day/night state.
const STONE_TINT = '#0b0c08';
// Standard right-handed die layout (opposite faces sum to 7), mapped to
// BoxGeometry's default face-group order: +x -x +y -y +z -z.
const DICE_PIP_ORDER = [3, 4, 1, 6, 2, 5];
// DM's seat, opposite the map, silhouette-simple per the art brief ("a DM
// chair silhouette" — not a modeled chair, just a readable dark shape).
const CHAIR_POS: [number, number, number] = [8, 0, 10.5];
const CHAIR_TINT = '#0d0a07';
// Camera-to-subject distance during the beat 7/8 pull-back runs ~20-26 units
// (cameraPath.ts keyframes 7-8) — the old near=15/far=38 fog washed that
// whole range toward void, dimming the table, diorama torches and props
// along with it. Pushed out so the pull-back stays legible; still fades to
// black well before the true void surround.
const FOG_NEAR = 26;
const FOG_FAR = 60;
// Table world night dimming (D2 item 4): same "white = untinted, lerp toward
// a night-linear/day-linear ratio by clockT" mechanism Diorama.tsx uses for
// the floor/wall/border, so the wood table and parchment sheet dim with the
// rest of the world instead of staying lit through beat 5's nightfall. Both
// ratios computed the same way: night target is the D2 board's own night
// anchors (`.d2n .stage`'s darkest stop for wood, `.d2n .sheet`'s mid stop
// for the sheet), divided by each surface's OWN day albedo (they differ, so
// the ratios differ) — both hexes decoded through the real sRGB curve.
const WHITE = new THREE.Color(1, 1, 1);
const TABLE_NIGHT_TINT = new THREE.Color(0.0529, 0.0758, 0.187);
const SHEET_NIGHT_TINT = new THREE.Color(0.0161, 0.0217, 0.0523);
// D2 fix round (finding 7): the fog and the <color> background below share
// this same rest-state hex with SceneRenderer.tsx's NORMAL_BG (grep
// NORMAL_BG when touching either) — the fog now also lerps toward
// SceneRenderer.tsx's own NIGHT_BG_COLOR by the same swap-gated nightT (grep
// NIGHT_BG when touching either), so beat 5's darkened surround and the fog
// it fades into agree instead of the fog staying warm-lit while everything
// else goes night-blue.
const NORMAL_BG_TINT = new THREE.Color('#3a2717');
const NIGHT_BG_TINT = new THREE.Color('#0c0906');
// Padding past the table's 26x16 footprint so the contact shadow's soft
// falloff shows past the plane's own edge — same "bigger shadow plane than
// the thing it's under" trick as Diorama.tsx's CONTACT_SHADOW_PAD.
const TABLE_SHADOW_SIZE: [number, number] = [34, 22];

export function TableScene() {
  const tableGeometry = useMemo(() => {
    // D2 fix round (finding 3): 26x16 exactly matched the table's own
    // authored footprint, so at beat 0's wide frustum the plane's hard edge
    // sat well inside frame — a framed picture floating in void rather than a
    // table filling it. 70x44 still showed both vertical edges at beat 0 on
    // wide aspects (frustum ~-40..49 world x at 1920x855); 120x64 clears up
    // to ~3.2:1 aspect with margin. An unlit quad costs nothing drawn bigger.
    const geometry = new THREE.PlaneGeometry(TABLE_SIZE[0], TABLE_SIZE[1]);
    geometry.rotateX(-Math.PI / 2);
    return withUv2(geometry);
  }, []);

  // Reuses the same door-from-two-points helper the diorama's real doors use
  // (scene/geometry.ts) — this one just stands taller, south of the map, as
  // the thing beat 8's camera settles on.
  const exitDoorDef = useMemo(() => ({ id: 'exit-door', a: { x: 6.8, z: 8.5 }, b: { x: 9.2, z: 8.5 } }), []);
  const exitDoor = useMemo(() => doorGeometry(exitDoorDef, DOOR_THICKNESS, DOOR_HEIGHT), [exitDoorDef]);
  const exitDoorOutline = useMemo(() => outlineGeometry(exitDoor.geometry, OUTLINE_EPS_DOOR), [exitDoor]);
  // Hero treatment (art-brief beat 8): stone jambs + an arch instead of a
  // flat lintel, plus two hinge straps rendered as the door mesh's own
  // children below so they inherit its position/rotation for free.
  const exitDoorFrame = useMemo(() => doorFrameParts(exitDoorDef, DOOR_THICKNESS, DOOR_HEIGHT, DOOR_HEIGHT), [exitDoorDef]);
  const archRadius = useMemo(() => Math.hypot(exitDoorDef.b.x - exitDoorDef.a.x, exitDoorDef.b.z - exitDoorDef.a.z) / 2 + 0.15, [exitDoorDef]);
  const archGeometry = useMemo(() => withUv2(new THREE.TorusGeometry(archRadius, DOOR_THICKNESS * 0.7, 8, 24, Math.PI)), [archRadius]);
  const archOutline = useMemo(() => outlineGeometry(archGeometry, OUTLINE_EPS_DOOR), [archGeometry]);
  const hingeGeometry = useMemo(() => new THREE.BoxGeometry(0.5, 0.16, 0.06), []);

  const diceGeometry = useMemo(() => new THREE.BoxGeometry(0.32, 0.32, 0.32), []);
  const diceOutline = useMemo(() => outlineGeometry(diceGeometry, OUTLINE_EPS), [diceGeometry]);
  const dice2Geometry = useMemo(() => new THREE.BoxGeometry(0.24, 0.24, 0.24), []);
  const dice2Outline = useMemo(() => outlineGeometry(dice2Geometry, OUTLINE_EPS), [dice2Geometry]);
  // Pip decals per face (simple box, not a true bevel — "simple beveled
  // cubes with pip decals are fine" per the art brief, and a real bevel
  // needs a geometry not shipped in this codebase's three build).
  // Background-texture critique P3-13: these were toon-lit, and at beat 7's
  // pull-back distance the toon shadow band crushed both dice to black
  // specks. Unlit-baked now (MeshBasicMaterial + toneMapped:false), the same
  // escape every other value-critical surface here already uses — the face
  // albedo survives any distance/light level.
  const diceMats = useMemo(
    () =>
      DICE_PIP_ORDER.map(
        (n) =>
          new THREE.MeshBasicMaterial({
            map: getDiceFaceTexture(n, '#b53a3a'),
            toneMapped: false,
            transparent: true,
            opacity: 0,
            depthWrite: false,
          }),
      ),
    [],
  );
  const dice2Mats = useMemo(
    () =>
      DICE_PIP_ORDER.map(
        (n) =>
          new THREE.MeshBasicMaterial({
            map: getDiceFaceTexture(n, '#3a5bb5'),
            toneMapped: false,
            transparent: true,
            opacity: 0,
            depthWrite: false,
          }),
      ),
    [],
  );

  const mugGeometry = useMemo(() => new THREE.CylinderGeometry(0.35, 0.3, 0.5, 16), []);
  const mugOutline = useMemo(() => outlineGeometry(mugGeometry, OUTLINE_EPS), [mugGeometry]);
  // Handle: a squashed half-torus tacked onto the mug's east side, sharing
  // the mug's own material (mugMat below) — same clay, one draw call fewer
  // to track for the fade-in.
  const handleGeometry = useMemo(() => {
    const geometry = new THREE.TorusGeometry(0.22, 0.05, 8, 16, Math.PI * 1.3);
    geometry.rotateZ(-Math.PI * 0.15);
    geometry.rotateY(Math.PI / 2);
    return geometry;
  }, []);
  const handleOutline = useMemo(() => outlineGeometry(handleGeometry, OUTLINE_EPS), [handleGeometry]);
  // P3-13, same fix as the dice: unlit + a lifted clay value (the old
  // toon-lit '#40291a' rendered as a black blob at pull-back).
  const mugMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: '#5c3d26', toneMapped: false, transparent: true, opacity: 0, depthWrite: false }),
    [],
  );

  // DM chair: seat + backrest, flat silhouette shapes — "a DM chair
  // silhouette", not a modeled chair — sharing one dark material.
  const chairSeatGeometry = useMemo(() => new THREE.BoxGeometry(0.9, 0.12, 0.9), []);
  const chairSeatOutline = useMemo(() => outlineGeometry(chairSeatGeometry, OUTLINE_EPS), [chairSeatGeometry]);
  const chairBackGeometry = useMemo(() => new THREE.BoxGeometry(0.9, 1.1, 0.12), []);
  const chairBackOutline = useMemo(() => outlineGeometry(chairBackGeometry, OUTLINE_EPS), [chairBackGeometry]);
  // Issue 5: unlit now — CHAIR_TINT already darkened above (own comment).
  const chairMat = useMemo(() => new THREE.MeshBasicMaterial({ color: CHAIR_TINT, toneMapped: false, transparent: true, opacity: 0, depthWrite: false }), []);

  // Hero door trim: stone jambs + arch share one material; the two hinge
  // straps share another. Issue 5: unlit now — pulls only `.map` from
  // getWallTexture, not the full {...} spread, which crashes three.js's
  // renderer on a MeshBasicMaterial (measured live; the fix plan's own claim
  // that MeshBasicMaterial silently ignores normalMap is wrong — see
  // Diorama.tsx's DOOR_FRAME_TOON_TINT comment for the full finding).
  // STONE_TINT already darkened above.
  const frameMat = useMemo(
    () => new THREE.MeshBasicMaterial({ map: getWallTexture(STONE_TINT).map, toneMapped: false, transparent: true, opacity: 0, depthWrite: false }),
    [],
  );
  // Issue 5: unlit now — '#1c1c1a' x0.35 (own comment above the tint block).
  const hingeMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: '#0d0d0c', toneMapped: false, transparent: true, opacity: 0, depthWrite: false }),
    [],
  );
  // Room-glow (beat 7, under the table) and stage-glow (beat 8, behind the
  // exit door) — both the same radial-falloff primitive, just recolored/
  // resized (art-brief: table "radial room glow #241A10 behind"; door
  // "radial warm stage glow #17150F ellipse 70%x55% at 50% 62%"). Additive
  // basic materials, not lights — cheap, and they fade with kitT like
  // everything else here.
  const roomGlowMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: getRadialGlowTexture('#241a10', 0.6, 0.25),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [],
  );
  const stageGlowMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: getRadialGlowTexture('#17150f', 0.7, 0.3),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [],
  );
  // D2 fix round (finding 3): soft dark ellipse under the table's own
  // footprint, normal (non-additive) blending so it darkens the parchment
  // field it sits on — the table plane's hard rectangular edge used to cut
  // straight into the page with nothing grounding it. Same primitive as
  // Diorama.tsx's own contact shadow, just sized to this table's footprint.
  // Always opaque now (not in fadeMats below): this grounds the table itself,
  // which is always-on world geometry (D2 item 2), not beat-7 kit dressing —
  // gating it on kitT left beats 0-6 with the same ungrounded hard edge this
  // shadow exists to fix.
  const tableShadowMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: getRadialGlowTexture('#000000', 0.5, 0.22),
        transparent: true,
        opacity: 1,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  const fadeMats = useMemo(
    () => [mugMat, chairMat, frameMat, hingeMat, roomGlowMat, stageGlowMat],
    [mugMat, chairMat, frameMat, hingeMat, roomGlowMat, stageGlowMat],
  );

  // Issue 5: all MeshBasicMaterial now (index 4, the exit door, was the last
  // toon-lit one in this array). The fade loop below only ever touches
  // `.opacity`, which every THREE.Material shares. The table wood + sheet
  // are NOT in here any more: they're always-on world geometry
  // (D2 item 2), not beat-7 kit dressing — see their own refs/useFrame below.
  const propMatRefs = useRef<(THREE.Material | null)[]>([]);
  const tableMatRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const sheetMatRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const fogRef = useRef<THREE.Fog>(null);
  // D2 value inversion fix (same root cause as Diorama.tsx's border/wall
  // outlines — see Outline.tsx's own comment): every prop's ink Outline
  // sibling used to default to opacity 1 permanently, regardless of its
  // parent's own kitT-gated fade — dice/mug/chair/exit-door/arch all traced
  // their full ink silhouette from the very first frame, well before beat 7
  // "The kit" ever pulls the camera back to reveal them. One flat array
  // (all 8 outlines share the same kitT timing, no per-prop stagger) rather
  // than 8 named refs.
  const outlineMatRefs = useRef<(THREE.MeshBasicMaterial | null)[]>([]);

  useFrame(() => {
    const opacity = sceneProgress.kitT;
    for (const material of propMatRefs.current) {
      if (material) material.opacity = opacity;
    }
    for (const material of diceMats) material.opacity = opacity;
    for (const material of dice2Mats) material.opacity = opacity;
    for (const material of fadeMats) material.opacity = opacity;
    for (const material of outlineMatRefs.current) {
      if (material) material.opacity = opacity;
    }
    // Table world night dimming: same clockT-lerped tint mechanism as
    // Diorama.tsx's floor/wall/border (see TABLE_NIGHT_TINT's own comment).
    // Uses raw clockT (not Diorama's frontLoad ramp) — this is peripheral
    // set dressing, not the beat's own subject, so a plain linear dim is
    // enough and doesn't need to "arrive early" mid-scrub.
    // D2 fix round (finding 2): clockT alone latches at 1 from beat 5 onward
    // (it's never reset) — gating by (1 - swapT) is what actually lets the
    // table/sheet return to their day values as beat 6's swap completes,
    // same "own * (1 - next)" shape as composition.tsx's COPY_BEATS.
    const nightT = sceneProgress.clockT * (1 - sceneProgress.swapT);
    if (tableMatRef.current) tableMatRef.current.color.copy(WHITE).lerp(TABLE_NIGHT_TINT, nightT);
    if (sheetMatRef.current) sheetMatRef.current.color.copy(WHITE).lerp(SHEET_NIGHT_TINT, nightT);
    if (fogRef.current) fogRef.current.color.copy(NORMAL_BG_TINT).lerp(NIGHT_BG_TINT, nightT);
  });

  return (
    <>
      {/* D2 "the lit table": the world's rest-state field is deep wood-dark
          (board `.d2 .stage` gradient's own outer stop, --wood-deep), not
          flat parchment — the always-on wood table plane below now covers
          most of the frame at every beat, so this only shows past its own
          edges (wide shots, FOV overshoot at the corners) and reads as the
          table simply continuing into shadow rather than a mismatched flat
          field. Matches SceneRenderer.tsx's NORMAL_BG exactly (that file
          owns the beat-4 lerp target/restore, this one owns the mount-time
          value — kept as two literals, not an import, so this stays a plain
          declarative R3F leaf; grep NORMAL_BG when touching either). Fog
          shares the same hex so beat 7-8's pull-back geometry fades OUT into
          the same wood tone the flat background clears to. Background itself
          is SceneRenderer.tsx's job past mount (its useFrame lerps
          scene.background toward NIGHT_BG_COLOR every frame — see finding 7);
          this <color> is only the mount-time value, kept as a literal for the
          same reason NORMAL_BG_TINT above is, not an import. */}
      <color attach="background" args={['#3a2717']} />
      <fog ref={fogRef} attach="fog" args={['#3a2717', FOG_NEAR, FOG_FAR]} />
      {/* Issue 5, light deletion: this used to also mount a warm overhead
          pointLight here ("so the tabletop reads against the void once the
          camera pulls back") — every prop on this table is unlit
          MeshBasicMaterial now (dice/mug/chair/exit-door/frame, see their own
          issue-5 comments below), so it fed nothing. Verified live: removing
          it changed zero on-screen pixels at beat 7's pull-back. */}

      {/* Wood table: unlit + baked, matching Diorama.tsx's floor/border rule
          ("floors/walls/props are UNLIT meshBasicMaterial with final values
          BAKED into canvas textures"). D2 item 2: always-on world geometry
          now, not gated on kitT — beats 0-6 sit their diorama on this same
          plane the beat-7/8 pull-back reveals, one table, not two. */}
      <mesh geometry={tableGeometry} position={[TABLE_CENTER[0], TABLE_Y, TABLE_CENTER[1]]}>
        <meshBasicMaterial
          ref={tableMatRef}
          map={getTableWoodTexture(WOOD_TINT, WOOD_SEAM_TINT, TABLE_CENTER, TABLE_SIZE).map}
          toneMapped={false}
          depthWrite={false}
        />
      </mesh>
      {/* Parchment sheet: the map's own "paper", between the wood table and
          the diorama's floor/skirt — the board's `.sheet` recipe baked into
          a texture (getSheetTexture) rather than a DOM gradient, since this
          has to exist as real geometry the model physically sits on. Always
          on, like the table. Slight rotation per the board recipe (see
          SHEET_ROTATION_Y). */}
      <mesh position={[SHEET_CENTER[0], SHEET_Y, SHEET_CENTER[1]]} rotation-x={-Math.PI / 2} rotation-y={SHEET_ROTATION_Y}>
        <planeGeometry args={SHEET_SIZE} />
        <meshBasicMaterial ref={sheetMatRef} map={getSheetTexture()} toneMapped={false} depthWrite={false} />
      </mesh>
      {/* Sheet drop shadow: the board's `.sheet { box-shadow: 0 14px 34px
          rgba(12,8,4,.55) }` baked as a box-vignette decal (getSheetShadowTexture)
          just under the sheet's own edges, slightly larger so it peeks out
          past them onto the wood — the sheet's own grounding, always on. */}
      <mesh
        position={[SHEET_CENTER[0], SHEET_SHADOW_Y, SHEET_CENTER[1]]}
        rotation-x={-Math.PI / 2}
        rotation-y={SHEET_ROTATION_Y}
      >
        <planeGeometry args={[SHEET_SIZE[0] + 1.4, SHEET_SIZE[1] + 1.4]} />
        <meshBasicMaterial map={getSheetShadowTexture()} transparent depthWrite={false} toneMapped={false} />
      </mesh>
      {/* Contact shadow: grounds the table's own hard-edged plane against
          whatever's beyond it (see TABLE_SHADOW_SIZE above) — still a
          beat-7/8 reveal flourish (kitT-gated), not needed earlier now that
          the background itself already reads as the same dark wood. */}
      <mesh position={[8, TABLE_Y - 0.03, 3.5]} rotation-x={-Math.PI / 2} material={tableShadowMat}>
        <planeGeometry args={TABLE_SHADOW_SIZE} />
      </mesh>
      {/* Table-room glow: a warm radial wash on the wood around the map, so
          the diorama reads as glowing brighter than the table it sits on
          (art-brief: "radial room glow #241A10 behind"). */}
      <mesh position={[8, TABLE_Y + 0.02, 3.5]} rotation-x={-Math.PI / 2} material={roomGlowMat}>
        <planeGeometry args={[22, 14]} />
      </mesh>

      {/* dice — tossed near the table's east edge, colors match the mockup's
          .dice/.dice.d2; per-face materials paint the pips. */}
      <mesh geometry={diceGeometry} position={[17.5, 0.16, 1]} rotation={[0, 0.9, 0.24]} material={diceMats}>
        <Outline
          geometry={diceOutline}
          matRef={(m) => {
            outlineMatRefs.current[0] = m;
            if (m) m.opacity = 0;
          }}
        />
      </mesh>
      <mesh geometry={dice2Geometry} position={[17.1, 0.12, 1.6]} rotation={[0, -1.1, -0.38]} material={dice2Mats}>
        <Outline
          geometry={dice2Outline}
          matRef={(m) => {
            outlineMatRefs.current[1] = m;
            if (m) m.opacity = 0;
          }}
        />
      </mesh>

      {/* mug — table's west margin, with a handle on its east side */}
      <mesh geometry={mugGeometry} position={[-1.5, 0.25, 6]} material={mugMat}>
        <Outline
          geometry={mugOutline}
          matRef={(m) => {
            outlineMatRefs.current[2] = m;
            if (m) m.opacity = 0;
          }}
        />
      </mesh>
      <mesh geometry={handleGeometry} position={[-1.15, 0.25, 6]} material={mugMat}>
        <Outline
          geometry={handleOutline}
          matRef={(m) => {
            outlineMatRefs.current[3] = m;
            if (m) m.opacity = 0;
          }}
        />
      </mesh>

      {/* DM chair — south edge of the table, facing the map */}
      <mesh geometry={chairSeatGeometry} position={[CHAIR_POS[0], 0.45, CHAIR_POS[2]]} material={chairMat}>
        <Outline
          geometry={chairSeatOutline}
          matRef={(m) => {
            outlineMatRefs.current[4] = m;
            if (m) m.opacity = 0;
          }}
        />
      </mesh>
      <mesh geometry={chairBackGeometry} position={[CHAIR_POS[0], 1.0, CHAIR_POS[2] + 0.4]} material={chairMat}>
        <Outline
          geometry={chairBackOutline}
          matRef={(m) => {
            outlineMatRefs.current[5] = m;
            if (m) m.opacity = 0;
          }}
        />
      </mesh>

      {/* exit door — beat 8's camera settles here; the DOM waitlist plaque
          (main { z-index: 1 } over .canvas-mount { z-index: 0 } in
          global.css) layers on top of it, so this recedes into fog behind
          the interactive form rather than competing with it. Hero
          treatment: iron-banded planks, stone jambs + arch, hinge straps. */}
      <mesh geometry={exitDoor.geometry} position={exitDoor.center} rotation-y={exitDoor.rotationY}>
        {/* Issue 5: unlit now — DOOR_WOOD_TINT/DOOR_SEAM_TINT already
            darkened above; `.map` only, not the full getDoorTexture spread
            (see frameMat's comment for why). */}
        <meshBasicMaterial
          ref={(m) => {
            propMatRefs.current[4] = m;
          }}
          map={getDoorTexture(DOOR_WOOD_TINT, DOOR_SEAM_TINT).map}
          toneMapped={false}
          transparent
          opacity={0}
          depthWrite={false}
        />
        <Outline
          geometry={exitDoorOutline}
          matRef={(m) => {
            outlineMatRefs.current[6] = m;
            if (m) m.opacity = 0;
          }}
        />
        {/* hinge straps, left (hinge) edge of the leaf — positions are local
            to the door's own center-origin box, so these are offsets from
            the door's vertical/horizontal middle, not world coordinates. */}
        <mesh geometry={hingeGeometry} position={[-exitDoor.geometry.parameters.width / 2 + 0.3, -DOOR_HEIGHT * 0.3, DOOR_THICKNESS]} material={hingeMat} />
        <mesh geometry={hingeGeometry} position={[-exitDoor.geometry.parameters.width / 2 + 0.3, DOOR_HEIGHT * 0.3, DOOR_THICKNESS]} material={hingeMat} />
      </mesh>
      <mesh geometry={exitDoorFrame.jambs[0].geometry} position={exitDoorFrame.jambs[0].position} rotation-y={exitDoorFrame.rotationY} material={frameMat} />
      <mesh geometry={exitDoorFrame.jambs[1].geometry} position={exitDoorFrame.jambs[1].position} rotation-y={exitDoorFrame.rotationY} material={frameMat} />
      <mesh
        geometry={archGeometry}
        position={[exitDoor.center[0], DOOR_HEIGHT, exitDoor.center[2]]}
        rotation-y={exitDoorFrame.rotationY}
        material={frameMat}
      >
        <Outline
          geometry={archOutline}
          matRef={(m) => {
            outlineMatRefs.current[7] = m;
            if (m) m.opacity = 0;
          }}
        />
      </mesh>
      {/* Stage glow: a soft warm ellipse behind the door — was a small
          always-on point light (extra per-fragment lighting cost, and no
          spec of its own); this is a single cheap additive quad, and it's
          exactly the "radial warm stage glow" the door beat asks for
          (art-brief: "#17150F ellipse ... behind the door"). Sits farther
          from camera than the door (smaller z, since the camera approaches
          from +z) so the door silhouettes against it. */}
      <mesh position={[exitDoor.center[0], 2.2, exitDoor.center[2] - 1.3]} material={stageGlowMat}>
        <planeGeometry args={[9, 6]} />
      </mesh>
    </>
  );
}
