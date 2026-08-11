import { useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { markLoad } from '../loadProgress';
import { CAMERA_KEYFRAMES } from '../scene/cameraPath';
import { Composition } from '../scene/composition';
import { Diorama } from '../scene/Diorama';
import { FocalAccents } from '../scene/focalAccents';
import { MAIN_MAP, SWAP_MAP, SWAP_MAP_OFFSET } from '../scene/mapData';
import { SceneRenderer } from '../scene/SceneRenderer';
import { ScrollCamera } from '../scene/ScrollCamera';
import { SightSweep } from '../scene/SightSweep';
import { TableScene } from '../scene/TableScene';
import { createTimerClock } from '../scene/timerClock';
import { WorldTurns } from '../scene/WorldTurns';

// Fixed WebGL mount behind the DOM (z-index below page content). Toon-shaded,
// ink-outlined diorama (P4 art pass) + scroll-driven camera; beats 1-2 (ink
// draw, wall rise + torch ignition), 5 (WorldTurns' clock/rain), 6
// (swap-in-place, via each Diorama's swapOffsetY) and 7-8 (TableScene's
// table/props/door, revealed by the camera pulling back — no extra animation
// needed there) animate here. Gated on mount so SSR/prerender emits the empty
// (aria-hidden) shell rather than crashing on WebGL/DOM APIs that don't exist
// on the server.
export function Canvas3D() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const frontDoorRef = useRef<THREE.Mesh>(null);
  const secretDoorRef = useRef<THREE.Mesh>(null);
  const secretBadgeRef = useRef<THREE.Object3D>(null);
  const fogQuadRef = useRef<THREE.Mesh>(null);
  if (!mounted) return null;
  return (
    <div className="canvas-mount" aria-hidden="true">
      <Canvas
        frameloop="demand"
        dpr={[1, 1.5]}
        // Issue 5, light deletion: `shadows="percentage"` used to feed
        // WorldTurns' directional-light shadow camera. Every material in the
        // scene is unlit MeshBasicMaterial now (see Diorama.tsx/
        // TableScene.tsx/focalAccents.tsx's own issue-5 comments), so a
        // shadow-map pass ran every rendered frame for zero visible output —
        // deleted as a real per-frame cost, not just an appearance no-op.
        camera={{ position: CAMERA_KEYFRAMES[0].position, fov: 50, near: 0.1, far: 200 }}
        onCreated={(state) => {
          // Swap in a Timer-backed clock (see scene/timerClock.ts) — R3F
          // always builds its own THREE.Clock internally and that class is
          // deprecated.
          // Renderer tonemapping is deliberately left unset: PostFX's grade
          // pass owns the transfer curve site-wide (linear→sRGB in
          // GradeShader), and three only applies renderer.toneMapping when
          // the render target is null — no path here ever is, since every
          // beat, the beat-4 split included, renders into the composer's own
          // target. Setting it would be dead code, not a look.
          state.set({ clock: createTimerClock() });
          // Loader milestone: the scene exists; the procedural texture bakes
          // (scene/textures.ts) and the shader compile run between here and
          // SceneRenderer's first frame.
          markLoad('scene');
        }}
      >
        <WorldTurns />
        <TableScene />
        <Diorama
          map={MAIN_MAP}
          animated
          doorRefsById={{ 'front-door': frontDoorRef, 'west-secret': secretDoorRef }}
          secretExtras={{ badgeRef: secretBadgeRef, fogRef: fogQuadRef }}
          swapOffsetY={-3}
        />
        <Diorama map={SWAP_MAP} position={SWAP_MAP_OFFSET} swapOffsetY={3} />
        <FocalAccents />
        <Composition />
        <SightSweep frontDoorRef={frontDoorRef} />
        <ScrollCamera />
        <SceneRenderer
          secretDoorRef={secretDoorRef}
          secretBadgeRef={secretBadgeRef}
          fogQuadRef={fogQuadRef}
        />
      </Canvas>
    </div>
  );
}
