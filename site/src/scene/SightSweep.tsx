// Beat 3 "Sight": a token walks a fixed path while a real visibility
// polygon is swept every frame from MAIN_MAP's own wall segments (see
// visibility.ts) — the product's algorithm, miniaturized, not a baked clip.
// The front door blocks sight until it swings open (door-swing), echoing
// #83's live door-triggered relighting (issue 5 deleted the door-spill
// pointLight that used to ignite here — see its own comment below).
import { useFrame } from '@react-three/fiber';
import { useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { Token, TOKEN_LIFT } from './focalAccents';
import { MAIN_WALL_SEGMENTS, PARTY_SIGHT_RADIUS, type Vec2 } from './mapData';
import { sceneProgress } from './sceneProgress';
import { computeVisibilityPolygon, type Segment } from './visibility';

// Token path: starts inside Room A, approaches the front door, crosses its
// threshold, and continues into the darkness beyond (the "next room" the
// spill light reveals a wedge of).
const PATH: Vec2[] = [
  { x: 2, z: 2 },
  { x: 3, z: 4.2 },
  { x: 3.5, z: 5.7 },
  { x: 3.9, z: 6 }, // at the front door's own threshold — the "crosses it" beat, door swung open by here
  // Trust-pane rework: was {x:3.9,z:7.2}, resting just south of the front
  // door — matched TRUST_TOKENS.red back when that constant lived there too,
  // but that spot fell outside the player pane's own crop once beat 4's
  // camera/crop unified (see mapData.ts's TRUST_TOKENS comment). The walk
  // now continues past the door, back north across Room A, to end at
  // TRUST_PLAYER_SIGHT_ORIGIN — the same point beat 4's own sight-sweep casts
  // from — so the token beat 3 leaves walking is the same token beat 4 finds
  // standing at the apex of its own visibility wedge.
  { x: 7, z: 3 }, // matches TRUST_TOKENS.red / TRUST_PLAYER_SIGHT_ORIGIN (mapData.ts)
];
const DOOR_A: Vec2 = { x: 4, z: 6 };
const DOOR_B: Vec2 = { x: 3, z: 6 }; // hinge end — the door swings toward this point
const DOOR_SEGMENT: Segment = { a: DOOR_A, b: DOOR_B };
// MAIN_WALL_SEGMENTS already includes the closed secret door as an
// unconditional blocker (mapData.ts) — sight must not leak through it.
const OUTER_PAD = 3; // fog-quad radius beyond PARTY_SIGHT_RADIUS so the "unseen" rect always covers the frame
const WEDGE_OPACITY = 0.86;

// Y4 fix round: token/wedge/ring opacity all ease out over beat 4's first
// 20% (see the useFrame fadeT below) instead of hard-cutting the instant
// sightActive flips off. Baselines captured lazily on first touch (module
// scope — Token's own materials are otherwise untouched by anything else,
// so the first read is always the true "factor 1" value: 1 for the token's
// opaque rim/cap/outline, 0.7 for its own sight ring) so multiplying by
// fadeT never clobbers them, same pattern as SceneRenderer's own fadeBase.
const tokenFadeBase = new WeakMap<THREE.Material, number>();
function applyTokenFade(obj: THREE.Object3D, factor: number) {
  obj.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (const raw of mats) {
      const m = raw as THREE.Material & { opacity: number };
      if (!tokenFadeBase.has(m)) tokenFadeBase.set(m, m.opacity);
      if (!m.transparent) m.transparent = true;
      m.opacity = tokenFadeBase.get(m)! * factor;
    }
  });
}

function cumulativeLengths(points: Vec2[]): number[] {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z));
  }
  return cum;
}
const PATH_CUM = cumulativeLengths(PATH);

function pointAtT(points: Vec2[], cum: number[], t: number): Vec2 {
  const target = THREE.MathUtils.clamp(t, 0, 1) * cum[cum.length - 1];
  let i = 1;
  while (i < cum.length - 1 && cum[i] < target) i++;
  const segLen = cum[i] - cum[i - 1] || 1;
  const segT = (target - cum[i - 1]) / segLen;
  const a = points[i - 1];
  const b = points[i];
  return { x: a.x + (b.x - a.x) * segT, z: a.z + (b.z - a.z) * segT };
}

export function SightSweep({ frontDoorRef }: { frontDoorRef: RefObject<THREE.Mesh | null> }) {
  const tokenRef = useRef<THREE.Group>(null);
  const wedgeRef = useRef<THREE.Mesh>(null);
  const doorBaseX = useRef<number | null>(null);

  useFrame(() => {
    const { sightT, sightActive, trustT } = sceneProgress;
    const token = tokenRef.current;
    const wedge = wedgeRef.current;
    const door = frontDoorRef.current;

    if (!sightActive) {
      if (token) token.visible = false;
      if (wedge) wedge.visible = false;
      if (door) {
        door.scale.x = 1; // door resets shut once you scroll away
        if (doorBaseX.current !== null) door.position.x = doorBaseX.current;
      }
      return;
    }

    // Y4 fix round: sightActive itself now clears at trustT>=0.2, not at
    // beat 4's pin entry (ScrollCamera's i===3 onUpdate) — this factor eases
    // the token/wedge/ring down to nothing across that same 0->0.2 window
    // instead of leaving them at full opacity right up to the frame
    // sightActive flips, which would just move the hard-cut later, not
    // remove it. 1 everywhere before beat 4 starts (trustT===0).
    const fadeT = 1 - Math.min(1, trustT / 0.2);

    const pos = pointAtT(PATH, PATH_CUM, sightT);
    // Door swings open across the middle third of the walk, shut before and after.
    const doorOpenT = THREE.MathUtils.clamp((sightT - 0.35) / 0.35, 0, 1);

    if (token) {
      token.visible = true;
      token.position.set(pos.x, TOKEN_LIFT, pos.z);
      applyTokenFade(token, fadeT);
    }

    if (door) {
      if (doorBaseX.current === null) doorBaseX.current = door.position.x;
      // ponytail: true hinge rotation needs a pivot group; a cheap top-down
      // stand-in — shrink toward the hinge end — reads as "swinging open"
      // without restructuring how Diorama parents its door meshes.
      door.scale.x = 1 - doorOpenT * 0.85;
      door.position.x = THREE.MathUtils.lerp(doorBaseX.current, DOOR_B.x, doorOpenT); // z is already DOOR_B.z — both endpoints share z=6
    }

    if (wedge) {
      // The door only blocks sight while it's still mostly shut — "doors
      // block until they swing open", performed with the same wall segments
      // the product's sweep uses.
      const segments = doorOpenT < 0.9 ? [...MAIN_WALL_SEGMENTS, DOOR_SEGMENT] : MAIN_WALL_SEGMENTS;
      const polygon = computeVisibilityPolygon(pos, segments, PARTY_SIGHT_RADIUS);

      const shape = new THREE.Shape();
      const r = PARTY_SIGHT_RADIUS + OUTER_PAD;
      shape.moveTo(pos.x - r, -(pos.z - r));
      shape.lineTo(pos.x + r, -(pos.z - r));
      shape.lineTo(pos.x + r, -(pos.z + r));
      shape.lineTo(pos.x - r, -(pos.z + r));
      shape.closePath();

      // Reversed: the sweep is angle-sorted CCW in (x,z), which the shape's
      // (x, -z) flip turns CW — same winding as the outer rect above. A hole
      // needs the opposite winding from its outer ring to cut cleanly.
      const hole = new THREE.Path();
      const holePoints = [...polygon].reverse();
      holePoints.forEach((p, i) => {
        if (i === 0) hole.moveTo(p.x, -p.z);
        else hole.lineTo(p.x, -p.z);
      });
      hole.closePath();
      shape.holes = [hole];

      const geometry = new THREE.ShapeGeometry(shape);
      geometry.rotateX(-Math.PI / 2);
      wedge.geometry.dispose();
      wedge.geometry = geometry;
      wedge.visible = true;
      (wedge.material as THREE.MeshBasicMaterial).opacity = WEDGE_OPACITY * fadeT;
    }
  });

  return (
    <>
      <Token
        ref={tokenRef}
        color="#b53a3a"
        emissive="#4a1512"
        position={[PATH[0].x, TOKEN_LIFT, PATH[0].z]}
        visible={false}
        sightRing
      />
      {/* y is above the torch pool quads (Diorama.tsx, y=0.03) so darkness
          always draws over an out-of-wedge pool instead of z-fighting it. */}
      <mesh ref={wedgeRef} position={[0, 0.05, 0]} visible={false}>
        <planeGeometry args={[0.01, 0.01]} />
        <meshBasicMaterial color="#080706" transparent opacity={WEDGE_OPACITY} depthWrite={false} />
      </mesh>
      {/* Issue 5, light deletion: this used to also mount a door-spill
          pointLight here, ramped in as the door swung open. Every material
          in the scene is unlit MeshBasicMaterial now, so it fed nothing —
          the door swinging open is itself the only "reveal" happening here.
          Verified live: removing it changed zero on-screen pixels through
          the whole door-swing scrub. */}
    </>
  );
}
