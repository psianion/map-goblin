// Beat 5 "The world turns": scroll scrubs the clock across the pinned
// section. A field of instanced rain quads fades in, driven off
// sceneProgress.clockT, read once per rendered frame like every other beat
// here — reduced motion's hard cut (ScrollCamera) just sets clockT to its
// final value, no separate branch.
//
// Issue 5 (split unlit/toon value system), light deletion: this component
// used to also own the scene's only ambient + directional light — day/night
// color and intensity ramp, the sun wheeling across the sky, a shared shadow
// camera. Every material in the scene is unlit MeshBasicMaterial now (see
// Diorama.tsx/TableScene.tsx/focalAccents.tsx's own issue-5 comments), so
// those lights fed nothing: deleted as a real per-frame saving (a shadow-map
// pass every rendered frame for zero visible output), landed as its own
// change after the conversion was verified so a regression bisects to the
// right half (docs/2026-08-11-nine-issue-fix-plan.md, issue 5 step 6).
// Verified live: deleting them changed zero on-screen pixels at the sight
// beat, both beat-4 panes, and beat 5's own full-night end. Every surface's
// day->night shift now comes entirely from its own *_NIGHT_TINT multiply —
// this rig's ambient color ramp was already fully redundant with that, per
// the fix plan's own "confirm on the beat-5 sweep before removing" caveat.
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { sceneProgress } from './sceneProgress';

const RAIN_COUNT = 90;
// Art-brief: "rgb(190 210 235) at ~5-8% opacity" — was 0.5, ten times over,
// which is why it read as chalky white dashes instead of a subtle wash.
const RAIN_MAX_OPACITY = 0.07;
// The mockup's rain reads at a 112deg diagonal; every streak shares this
// yaw (only a small jitter) so the field reads as one falling direction
// instead of criss-crossed scratches.
const RAIN_YAW = THREE.MathUtils.degToRad(112);

// Scatter streaks over MAIN_MAP's actual footprint (x: 0-16, z: 0-7) — was
// -1..18 / -1..9, spilling past the map's edges into the void margin the
// art-brief explicitly calls out as wrong ("confined to the map footprint").
function buildRainMatrices(): THREE.Matrix4[] {
  const matrices: THREE.Matrix4[] = [];
  for (let i = 0; i < RAIN_COUNT; i++) {
    const m = new THREE.Matrix4();
    const position = new THREE.Vector3(Math.random() * 16, 2 + Math.random() * 4, Math.random() * 7);
    const quaternion = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(-0.35 + Math.random() * 0.06, RAIN_YAW + (Math.random() - 0.5) * 0.08, 0.25 + (Math.random() - 0.5) * 0.06),
    );
    const scale = new THREE.Vector3(1, 0.32 + Math.random() * 0.2, 1); // short streaks, not long scratch-lines
    m.compose(position, quaternion, scale);
    matrices.push(m);
  }
  return matrices;
}

export function WorldTurns() {
  const rainRef = useRef<THREE.InstancedMesh>(null);
  const rainMatrices = useMemo(buildRainMatrices, []);

  useEffect(() => {
    const rain = rainRef.current;
    if (!rain) return;
    rainMatrices.forEach((m, i) => rain.setMatrixAt(i, m));
    rain.instanceMatrix.needsUpdate = true;
  }, [rainMatrices]);

  useFrame(() => {
    const t = sceneProgress.clockT;
    const rain = rainRef.current;
    if (rain) {
      (rain.material as THREE.MeshBasicMaterial).opacity = t * RAIN_MAX_OPACITY;
      // Gated to the beat-5 pin, not `t > 0` — clockT never resets once
      // scrolled past, so that check kept rain falling through every later
      // beat (the swap, the table pull-back, the waitlist door).
      rain.visible = sceneProgress.worldActive;
    }
  });

  return (
    <instancedMesh ref={rainRef} args={[undefined, undefined, RAIN_COUNT]} visible={false}>
      <planeGeometry args={[0.03, 1]} />
      <meshBasicMaterial color="#bed2e8" transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
    </instancedMesh>
  );
}
