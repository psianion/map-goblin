// Camera path through all nine beats: a CatmullRom curve sampled by scroll
// progress (see ScrollCamera.tsx). Keyframes are greybox placeholders —
// framing gets tuned once the art pass (P4) shows what's actually on screen.
import * as THREE from 'three';

export interface CameraKeyframe {
  position: [number, number, number];
  lookAt: [number, number, number];
  /** Vertical FOV in degrees. Beats 2–6 (the rise through the swap) stay
   * true-nadir (lookAt.xz === position.xz, see KEY_QUATS below) AND tight,
   * telephoto-narrow — flattening perspective toward the board's flat
   * orthographic read without swapping camera types mid-scroll (art-brief
   * global defect: "camera is oblique/perspective ... Board is clean
   * top-down orthographic"). Whisper/kit/door stay wide — those beats are
   * contractually cinematic pull-backs, not top-down plan reads. */
  fov: number;
}

// One entry per DOM `.beat` section, in document order:
// 0 whisper, 1 ink, 2 the rise, 3 sight, 4 trust, 5 the world turns,
// 6 the swap, 7 the kit (table pull-back), 8 the door.
export const CAMERA_KEYFRAMES: CameraKeyframe[] = [
  // D2 whisper composition: MAIN_MAP is centered on world x=8, but the
  // board's hero has copy occupying the left ~8-50% of frame and the map
  // starting ~51% — a screen center at world x=8 puts the map dead-centered
  // behind the copy column instead. Recentering the (still true-nadir,
  // position.xz === lookAt.xz) camera on x=4.5 pushes that same map right on
  // screen without touching height/fov/tilt — a pure re-frame, not a new
  // camera move.
  // fov 50 -> 44: with the table plane enlarged past the frustum, the sheet
  // fell to ~10% of frame area — quiet-empty-table is the beat's intent, but
  // the subject still has to register. A mild tighten lifts it to ~13%
  // without losing the pre-dawn emptiness or the right-of-copy bias.
  { position: [4.5, 40, 3.5], lookAt: [4.5, 0, 3.5], fov: 44 }, // void — map a distant speck below, biased right of the copy column
  { position: [4, 13, 3], lookAt: [4, 0, 3], fov: 38 }, // top-down push over Room A
  { position: [4, 15, 3], lookAt: [4, 0, 3], fov: 34 }, // Room A, true nadir — no more forward-cheat tilt
  { position: [3.5, 15, 4.5], lookAt: [3.5, 0, 4.5], fov: 34 }, // over the token's walk + front door, true nadir
  // R1+R5 fix round: was centered on x=12.5 (Room B alone) — with beat 4's
  // dual-pane split now built from ONE camera/crop shared by both panes
  // (SceneRenderer.tsx), whichever room the camera favors is the room that
  // ends up split across both panes; Room A ran off the left edge entirely
  // and ~35% of the frame's right side was empty table. Recentered on x=8,
  // the full plan's own midpoint (Room A 0-8, Room B 10-16) — at this
  // fov/height the frame is ~20.6 world units wide, so the complete x=0..16
  // footprint fits with ~2.3 units of margin either side (Room A left of
  // center, Room B right of center — exactly the two halves each half-pane
  // ends up showing once the split opens). fov/height untouched: they
  // already had the width to spare, this was purely a re-aim.
  // C1 fix round: the reviewer had sized the previous [8,15,3.5]/fov34 framing
  // against the PANE frustum (post-crop), not the full pre-split frame — the
  // dual-pane split (SceneRenderer.tsx) only ever shows each pane a HALF-WIDTH
  // slice of this SAME frustum, so the full x=0..16 plan needs to fit inside
  // HALF the frame width, not the whole of it. It didn't: the pane only
  // framed ~9.4 of the plan's 16 world units. Raised straight up (same x/z
  // aim) to roughly double the frustum's world-space coverage — picked over
  // the fov46/height22 alternative by eye (this framing read the wall/prop
  // detail a touch cleaner at the pane's actual pixel scale).
  // X3 fix round: height 30 was itself only sized against a wide (>=~1.83)
  // aspect — at a 16:9/1.6-ish desktop the half-pane crop (SceneRenderer.tsx's
  // GAP_PX=56 split down the middle) clipped both rooms' outer walls. Solved
  // for the narrowest supported aspect (1.6, e.g. a 1280x800 viewport):
  // half-pane world-width = ((aspect*h - GAP_PX)/2)/h * 2*y*tan(fov/2), where
  // h is the canvas's pixel height (the GAP_PX/h term is what makes this
  // aspect-only formula height-dependent — negligible at typical desktop
  // heights, so h=800 stands in). Needs >=16.5 (plan spans x=0..16 plus
  // margin) at aspect 1.6: y ~= 35.3 clears it; 36 keeps a hair of margin.
  // That "negligible at typical desktop heights" is the part that was wrong —
  // it is what clips the walls on short windows. This 36 is now only the BASE
  // height (the signed-off 1600x1000 shape); setPathViewport, below, re-solves
  // the same formula against the live canvas size and rewrites this entry.
  { position: [8, 36, 3.5], lookAt: [8, 0, 3.5], fov: 34 }, // the full two-room plan, true nadir — sized for the half-pane crop at 1.6 aspect
  { position: [8, 22, 3.5], lookAt: [8, 0, 3.5], fov: 30 }, // pulled-up overview of the whole main map, with void margin
  { position: [8, 22, 3.5], lookAt: [8, 0, 3.5], fov: 30 }, // hold overhead through the swap (swap-in-place)
  // fov 50 -> 38: at 50 the incoming map (SWAP_MAP, a small single-room
  // footprint vs MAIN_MAP's two-room hold) covered so little of the frame
  // its baked grid/walls read as a blank warm wash — "legible map as the
  // hero object" failing at this distance (phase E's own named defect).
  // Narrowing the cone (not moving the camera) zooms uniformly onto the
  // lookAt point rather than re-biasing the oblique angle, so dice/mug/chair
  // stay exactly where their own hand-placed positions expect a satellite
  // frame around the map — just cropped in from the table's outer margin,
  // which the wide 120x64 table plane has plenty of to give up.
  { position: [8, 20, 14], lookAt: [8, 0, 3.5], fov: 38 }, // war-table pull-back — cinematic, oblique is correct here
  { position: [8, 24, 20], lookAt: [8, 1.8, 7], fov: 45 }, // recede into darkness, settling on TableScene's exit door (~8, 1.7, 8.5)
];

export const BEAT_COUNT = CAMERA_KEYFRAMES.length;

let positionCurve = new THREE.CatmullRomCurve3(CAMERA_KEYFRAMES.map((k) => new THREE.Vector3(...k.position)));

// Per-keyframe orientation, slerped between keyframes. Avoids camera.lookAt's
// nadir degeneracy (up=(0,1,0) is undefined straight down) which caused
// frame spin and 180-degree flips during top-down scrubs.
const NADIR = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
const KEY_QUATS = CAMERA_KEYFRAMES.map((k) => {
  const p = new THREE.Vector3(...k.position);
  const l = new THREE.Vector3(...k.lookAt);
  if (Math.hypot(l.x - p.x, l.z - p.z) < 1e-3) return NADIR.clone();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(p, l, new THREE.Vector3(0, 1, 0)));
});
for (let i = 1; i < KEY_QUATS.length; i++) {
  if (KEY_QUATS[i].dot(KEY_QUATS[i - 1]) < 0) KEY_QUATS[i].set(-KEY_QUATS[i].x, -KEY_QUATS[i].y, -KEY_QUATS[i].z, -KEY_QUATS[i].w);
}

// Issue 3 fix — keyframe 4's y=36 (see its own comment above) was solved for ONE viewport
// shape; on anything narrower the half-pane crop (SceneRenderer.tsx's GAP_PX split) clips
// both rooms' outer walls off-frame. positionCurve is built once at module scope from ALL
// nine keyframes, so a per-frame scale on the *sampled* y (the originally-proposed fix)
// would lift the whole path — every beat, including beats 7/8 whose lookAt targets are
// tuned against a fixed height. Rebuild keyframe 4's position instead, and only the curve
// built from it — the per-keyframe quaternions (KEY_QUATS, above) don't need rebuilding:
// this keyframe is nadir (position.xz === lookAt.xz) and NADIR is a fixed constant,
// independent of y's magnitude.
//
// THE DERIVATION (the first pass shipped `36 * max(1, 1.6/aspect)`, a pure ratio with no
// height term, and under-corrected on short-but-moderate windows — 1200x917 and 1184x815
// both measured clipped. The height term is not optional; here is where it comes from.)
//
//   The split renders BOTH panes from this one camera via
//   `cam.setViewOffset(w, h, offsetX, 0, halfW, h)` (SceneRenderer.tsx), with
//   `gap = round(GAP_PX * dpr * trustGlow)` and `halfW = floor((w - gap) / 2)` in DEVICE px.
//   At a fully open split (trustGlow === 1) both panes' offsetX converge on
//   `centerX = (w - halfW) / 2` — one halfW-wide slice centred on the camera, so the crop
//   is symmetric about world x = 8 and the two outer walls need the same margin.
//
//   A view offset scales the frustum's width by view.width / view.fullWidth, so:
//     full frame width at the board plane = 2*y*tan(fov/2) * aspect      (aspect = wCss/hCss)
//     halfW / w                           = (1 - GAP_PX/wCss) / 2        (dpr cancels: gap
//                                                                        and w both carry it)
//     half-pane world width  W(y)         = y * tan(fov/2) * (wCss - GAP_PX) / hCss
//
//   So the quantity the height must hold constant is (wCss - GAP_PX)/hCss — i.e.
//   `aspect - GAP_PX/hCss`, NOT the raw aspect. At a fixed aspect a shorter window carries a
//   proportionally fatter gap, which is exactly the case the ratio-only form missed. Measured
//   (projection math against the live wall meshes at the beat-4 pin, margin = table visible
//   outside the outer wall's footprint, per side): 1200x917 asked for y 44.0 where the
//   geometry needs 44.6 — 7.6 px of margin against an 8 px bar; 1184x815 39.7 vs 40.2 —
//   7.4 px; 932x847 52.4 vs 53.7 — 2.8 px. Inverting W(y) for the height:
//
//     y = W_TARGET * hCss / ((wCss - GAP_PX) * tan(fov/2))
//
//   W_TARGET is read straight off the signed-off 1600x1000 framing at y = 36 rather than
//   re-picked: W(36, 1600, 1000) = 16.99 world units, which is the plan's x = 0..16 footprint
//   plus the wall caps' +-0.1875 (Diorama.tsx's WALL_THICKNESS * WALL_CAP_THICKNESS_MULT) and
//   ~0.31 units — 14.9 CSS px, measured — of table margin either side. Holding W constant means
//   every corrected viewport reproduces the signed-off composition, only smaller: the wall
//   footprint keeps 8.4-11.0 px of margin from 932 px wide up. Defining the target from the base
//   height instead of from 16.5 makes the reference viewport reproduce y = 36 exactly (the
//   epsilon below then no-ops the rebuild outright), so aspect >= 1.6 is untouched by
//   construction, not by a coincidence of rounding.
const KEYFRAME4_BASE_Y = CAMERA_KEYFRAMES[4].position[1]; // 36, the signed-off 1600x1000 solve
// Mirrors SceneRenderer.tsx's own `GAP_PX = 56` (CSS px). Duplicated by contract rather than
// imported — same rule the file's NORMAL_BG/etc. constants follow. Frozen: if that value ever
// moves, this solve silently under-corrects and beat 4 starts clipping again, so grep both.
const KEYFRAME4_GAP_PX = 56;
const KEYFRAME4_TAN = Math.tan(THREE.MathUtils.degToRad(CAMERA_KEYFRAMES[4].fov) / 2);
/** Half-pane world width at height `y` on a `w` x `h` CSS-px canvas — see the derivation above. */
const halfPaneWorldWidth = (y: number, w: number, h: number) => (y * KEYFRAME4_TAN * (w - KEYFRAME4_GAP_PX)) / h;
const KEYFRAME4_TARGET_WIDTH = halfPaneWorldWidth(KEYFRAME4_BASE_Y, 1600, 1000); // 16.99 world units
// ponytail: [36, 56] ceiling, unchanged from the first pass — 56 is where the closed form lands
// at an effective (wCss - GAP_PX)/hCss of 0.99, i.e. ~1.05 real aspect on a 1000px-tall window
// and ~1.10 on a 700px-tall one. Everything the four acceptance aspects reach stays inside it
// (worst case measured: 53.2 at 1100x1000). Below the break-even the correction would need a
// violent vertical lunge through the neighbouring beats' framing — segments 3->4->5 run
// 15 -> y -> 22, so y = 56 is already a 41-unit climb — for a viewport shape this page barely
// targets (Hero.tsx gates the 3D path on width >= 900px, so a tall narrow window is the only
// way to reach it). Clip there instead of chasing it further.
export function setPathViewport(widthPx: number, heightPx: number) {
  if (!Number.isFinite(widthPx) || !Number.isFinite(heightPx) || widthPx <= KEYFRAME4_GAP_PX || heightPx <= 0) return;
  const y = THREE.MathUtils.clamp(
    (KEYFRAME4_TARGET_WIDTH * heightPx) / ((widthPx - KEYFRAME4_GAP_PX) * KEYFRAME4_TAN),
    36,
    56,
  );
  if (Math.abs(y - CAMERA_KEYFRAMES[4].position[1]) < 0.01) return; // memoise — no rebuild on an unchanged viewport
  CAMERA_KEYFRAMES[4].position[1] = y;
  positionCurve = new THREE.CatmullRomCurve3(CAMERA_KEYFRAMES.map((k) => new THREE.Vector3(...k.position)));
}

export function sampleCamera(t: number): { position: THREE.Vector3; quaternion: THREE.Quaternion; fov: number } {
  const clamped = THREE.MathUtils.clamp(t, 0, 1);
  const s = clamped * (KEY_QUATS.length - 1);
  const i = Math.min(Math.floor(s), KEY_QUATS.length - 2);
  const segT = s - i;
  return {
    position: positionCurve.getPoint(clamped),
    quaternion: KEY_QUATS[i].clone().slerp(KEY_QUATS[i + 1], segT),
    fov: THREE.MathUtils.lerp(CAMERA_KEYFRAMES[i].fov, CAMERA_KEYFRAMES[i + 1].fov, segT),
  };
}
