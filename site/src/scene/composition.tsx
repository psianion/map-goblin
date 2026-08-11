// Composition shaping (enhancement doc Part 1, moves 3 + 5a): the three
// beats that name an explicit left/right copy column (2 "the rise", 3
// "sight", 5 "the world turns" — the doc's own "beats 3 and 5 alternate")
// get a screen-space vignette darkening the DOM copy's side, plus — for
// beat 2 only, the one beat whose torches don't already carry a bespoke
// per-beat accent — an extra additive wash on the pools opposite that copy
// column. Beat 5's own opposite-side pool bias already exists as
// focalAccents.tsx's HELD_POOL (t4, the SE/right pool, copy left); not
// duplicated here. Beats 4/6/7/8 have no single copy side (diptych, table,
// door) so contribute nothing. Move 5a's ember motes are systemic (every
// beat with lit torches inherits them), not tied to a copy side.
import { createPortal, useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { clippedPoolGeometry } from './geometry';
import { MAIN_MAP, SWAP_MAP, SWAP_MAP_OFFSET } from './mapData';
import { sceneProgress } from './sceneProgress';
import { getRadialGlowTexture, getTorchGlowTexture } from './textures';

interface CopyBeat {
  side: 'left' | 'right';
  /** 0..1, this beat's own composition "in" — built from sceneProgress's
   * existing per-beat progress vars (own-progress × (1 − next-progress)),
   * so it crossfades to the next beat automatically and never needs a new
   * field on sceneProgress itself. */
  strength: () => number;
}

const COPY_BEATS: CopyBeat[] = [
  // Beat 2 "the rise": copy left (art-brief: "copy-side vignette holds the
  // left half"), pools/vignette opposite on the right.
  { side: 'left', strength: () => sceneProgress.riseT * (1 - sceneProgress.sightT) },
  // Beat 3 "sight": copy right (board a2) — the doc's alternation.
  { side: 'right', strength: () => sceneProgress.sightT * (1 - sceneProgress.trustT) },
  // Beat 5 "the world turns": copy left (board a4), alternating back.
  { side: 'left', strength: () => sceneProgress.clockT * (1 - sceneProgress.swapT) },
];

let vignetteTex: THREE.CanvasTexture | null = null;
// Dark at u=0 fading transparent by ~60% across — mirrored (scale.x) per
// beat's side rather than baking two textures.
function getCopyVignetteTexture(): THREE.CanvasTexture {
  if (vignetteTex) return vignetteTex;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, size, 0);
  g.addColorStop(0, 'rgba(11,10,8,1)');
  g.addColorStop(0.55, 'rgba(11,10,8,0.32)');
  g.addColorStop(1, 'rgba(11,10,8,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  vignetteTex = new THREE.CanvasTexture(canvas);
  vignetteTex.colorSpace = THREE.SRGBColorSpace;
  return vignetteTex;
}

// Screen-space by construction (camera child via portal) rather than a
// world-space quad, so it doesn't care that the nadir camera orientation
// (beats 2-6) and the oblique one (7-8) point different world axes at the
// screen's left edge.
function CopyVignette() {
  const { camera } = useThree();
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);

  useFrame(() => {
    let side: 'left' | 'right' = 'left';
    let strength = 0;
    for (const beat of COPY_BEATS) {
      const s = beat.strength();
      if (s > strength) {
        strength = s;
        side = beat.side;
      }
    }
    // ponytail: 0.8 was sized for the old near-void field, where a
    // near-black rgba(11,10,8,*) wash over near-black #0b0a08 read as barely
    // there. Against D2's light parchment field (SceneRenderer.tsx's
    // NORMAL_BG) the same multiplier would smear up to 80% of a near-black
    // stripe across the copy column — capped low so it survives as a soft
    // hint instead of a black bar. Phase C/D owns the real light-ground
    // re-grade of this vignette (color + shape), not just its ceiling.
    if (matRef.current) matRef.current.opacity = strength * 0.16;
    if (meshRef.current) meshRef.current.scale.x = side === 'left' ? 1 : -1;
  });

  return createPortal(
    <mesh ref={meshRef} position={[0, 0, -3]} renderOrder={999}>
      <planeGeometry args={[40, 40]} />
      <meshBasicMaterial
        ref={matRef}
        map={getCopyVignetteTexture()}
        transparent
        opacity={0}
        depthTest={false}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>,
    camera,
  );
}

// Beat 2's two right-hand pools (t3, t4 — see mapData.ts), boosted opposite
// its left copy column. An extra additive layer on top of Diorama's own
// baked pool rather than touching that file's torch intensities.
const POOL_BOOST_IDS = ['t3', 't4'];
// D2 fix round (finding 4): matches Diorama.tsx's own TORCH_POOL_SIZE
// shrink (5 -> 3) — this boost sits on top of that baked pool, so leaving it
// at the old 5.5 would still spill the boost itself past the tightened pool.
const POOL_BOOST_SIZE = 3.4;

function PoolBoosts() {
  const torches = useMemo(() => MAIN_MAP.torches.filter((t) => POOL_BOOST_IDS.includes(t.id)), []);
  // Background-texture critique P1-2: this boost layer bled through walls
  // the same way Diorama's own baked pools did — same fix, same helper:
  // pre-clipped to the torch's room, UVs keep the glow centered on it.
  const pools = useMemo(
    () => torches.map((t) => clippedPoolGeometry(t.pos, MAIN_MAP.floors, POOL_BOOST_SIZE)),
    [torches],
  );
  const matRefs = useRef<(THREE.MeshBasicMaterial | null)[]>([]);

  useFrame(() => {
    const strength = COPY_BEATS[0].strength();
    matRefs.current.forEach((m) => {
      if (m) m.opacity = strength * 0.55;
    });
  });

  return (
    <>
      {torches.map((t, i) => (
        <mesh
          key={t.id}
          geometry={pools[i].geometry}
          position={[pools[i].center[0], 0.03, pools[i].center[1]]}
          rotation-x={-Math.PI / 2}
        >
          <meshBasicMaterial
            ref={(m) => {
              matRefs.current[i] = m;
            }}
            map={getTorchGlowTexture()}
            transparent
            opacity={0}
            depthWrite={false}
            // Normal (not additive) blending — see getTorchGlowTexture's own
            // comment: additive over the now-light floor blows to white.
            toneMapped={false}
          />
        </mesh>
      ))}
    </>
  );
}

// Beat 6 "the swap": a warm floor glow under the incoming map's own
// footprint, fixed at table height (between TableScene's sheet and the
// settled floor — see that file's own SHEET_Y/floor-Y comments) so it reads
// while the incoming Diorama group is still rising through negative Y
// (Diorama.tsx's swapOffsetY rig) and gets naturally covered once that
// floor's own opaque mesh settles at y=0. Sized off SWAP_MAP's own floor
// bounds (padded, same "shadow plane bigger than its footprint" trick as
// Diorama's CONTACT_SHADOW_PAD) rather than a hand-picked box, so it stays
// correct if that map's footprint ever changes. This is the plan's named
// "scale/glow under the rising map" item: without it the incoming room was
// two flat overlapping pictures with nothing grounding the arrival as a
// physical scene change on the table.
const SWAP_GLOW_Y = -0.05;
const SWAP_GLOW_PAD = 2.2;
// Spotlight-style expand: starts at 40% size so early swapT reads as a
// glow just kindling under the rising set, not the full room-sized wash
// arriving instantly.
const SWAP_GLOW_MIN_SCALE = 0.4;

function SwapGlow() {
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const meshRef = useRef<THREE.Mesh>(null);

  const { center, size } = useMemo(() => {
    const xs = SWAP_MAP.floors.flatMap((f) => [f.min.x, f.max.x]);
    const zs = SWAP_MAP.floors.flatMap((f) => [f.min.z, f.max.z]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minZ = Math.min(...zs);
    const maxZ = Math.max(...zs);
    return {
      center: [SWAP_MAP_OFFSET[0] + (minX + maxX) / 2, SWAP_MAP_OFFSET[2] + (minZ + maxZ) / 2] as [number, number],
      size: [maxX - minX + SWAP_GLOW_PAD, maxZ - minZ + SWAP_GLOW_PAD] as [number, number],
    };
  }, []);

  useFrame(() => {
    const t = sceneProgress.swapT;
    // G4 (final critique round): this glow is a TRANSITION cue — at full
    // swapT the incoming floor has settled at y=0 and the glow's job is
    // done, but its pad ring (and any additive leak through the
    // depthWrite:false floor stack) kept a fixtureless amber halo on the
    // settled beat-6 frame. Fade to zero over the last quarter of the swap
    // so nothing amber survives the settle.
    const fade = 1 - THREE.MathUtils.smoothstep(t, 0.72, 1);
    if (matRef.current) matRef.current.opacity = t * 0.65 * fade;
    if (meshRef.current) {
      const s = THREE.MathUtils.lerp(SWAP_GLOW_MIN_SCALE, 1, t);
      meshRef.current.scale.set(s, 1, s);
    }
  });

  return (
    <mesh ref={meshRef} position={[center[0], SWAP_GLOW_Y, center[1]]} rotation-x={-Math.PI / 2}>
      <planeGeometry args={size} />
      <meshBasicMaterial
        ref={matRef}
        map={getRadialGlowTexture('#eda94e', 0.85, 0.35)}
        transparent
        opacity={0}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </mesh>
  );
}

// Move 5a: sparse ember motes drifting near torch pools. One fixed Points
// buffer (no per-frame allocation), spawned within MOTE_RADIUS_MAX of a
// torch so they never stray past its pool into bare void ("killed at pool
// edge" — capping the spawn radius, rather than a real per-mote kill/respawn
// cycle, gets the same visual result far cheaper).
const MOTE_COUNT = 120;
const MOTE_RADIUS_MAX = 1.5; // cells
const MOTE_HEIGHT = 1.6;

interface MoteConfig {
  torchIdx: number;
  angle: number;
  radius: number;
  phase: number;
  heightPhase: number;
  speed: number;
}

function buildMotes(): MoteConfig[] {
  const motes: MoteConfig[] = [];
  for (let i = 0; i < MOTE_COUNT; i++) {
    motes.push({
      torchIdx: i % MAIN_MAP.torches.length,
      angle: Math.random() * Math.PI * 2,
      radius: Math.random() * MOTE_RADIUS_MAX,
      phase: Math.random() * Math.PI * 2,
      heightPhase: Math.random(),
      speed: 0.6 + Math.random() * 0.8,
    });
  }
  return motes;
}

function EmberMotes() {
  const motes = useMemo(buildMotes, []);
  // prefers-reduced-motion: static — positions are set once below and this
  // flag just skips the per-frame reshuffle, no separate reduced code path.
  const reduced = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, []);
  const pointsRef = useRef<THREE.Points>(null);
  const matRef = useRef<THREE.PointsMaterial>(null);

  const positions = useMemo(() => {
    const arr = new Float32Array(MOTE_COUNT * 3);
    motes.forEach((m, i) => {
      const torch = MAIN_MAP.torches[m.torchIdx];
      arr[i * 3] = torch.pos.x + Math.cos(m.angle) * m.radius;
      arr[i * 3 + 1] = m.heightPhase * MOTE_HEIGHT;
      arr[i * 3 + 2] = torch.pos.z + Math.sin(m.angle) * m.radius;
    });
    return arr;
  }, [motes]);

  useFrame(() => {
    // Lit fraction: rides beat 2's rise, paused during beat 3 "sight" (the
    // doc: "this beat's void must stay absolute; even motes pause outside
    // the wedge"), 4-8% opacity per the doc's own range.
    const lit = sceneProgress.riseT * (sceneProgress.sightActive ? 0 : 1);
    if (matRef.current) matRef.current.opacity = lit * 0.06;
    if (reduced || lit <= 0) return;
    const geom = pointsRef.current?.geometry;
    if (!geom) return;
    const posAttr = geom.getAttribute('position') as THREE.BufferAttribute;
    // ponytail: drift is a function of scroll progress, not wall-clock time
    // — every other animated thing in this scene is scroll-scrubbed and
    // frameloop="demand" never free-runs a rAF loop; motes sway/rise as the
    // page scrolls (i.e. exactly when a frame is already being drawn) rather
    // than idling in place, at zero extra render cost. Upgrade to real
    // elapsed-time drift if a held, unscrolled frame needs live motion.
    const st =
      sceneProgress.riseT +
      sceneProgress.sightT +
      sceneProgress.trustT +
      sceneProgress.clockT +
      sceneProgress.swapT +
      sceneProgress.kitT;
    motes.forEach((m, i) => {
      const torch = MAIN_MAP.torches[m.torchIdx];
      const y = ((m.heightPhase + st * m.speed * 0.12) % 1) * MOTE_HEIGHT;
      const sway = Math.sin(st * 2 + m.phase) * 0.12;
      posAttr.setXYZ(i, torch.pos.x + Math.cos(m.angle) * m.radius + sway, y, torch.pos.z + Math.sin(m.angle) * m.radius);
    });
    posAttr.needsUpdate = true;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        ref={matRef}
        map={getRadialGlowTexture('#eda94e', 0.9, 0.4)}
        size={0.14}
        sizeAttenuation
        transparent
        opacity={0}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </points>
  );
}

export function Composition() {
  return (
    <>
      <CopyVignette />
      <PoolBoosts />
      <SwapGlow />
      <EmberMotes />
    </>
  );
}
