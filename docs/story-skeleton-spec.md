# Good Goblin story site — pencil skeleton spec

Milestone 1+2 of the brand story site: the ENTIRE film as a black-pencil previz — white paper, black line-work, no colors, no textures — with final scroll pacing and camera choreography. Art/texture/color come later; this milestone locks structure and motion.

This spec is the contract. `world.ts` exposes exactly the interface below; `timeline.ts` animates exactly those refs per the beat sheet. Do not rename fields or invent extra scenes. Plain code comments only — no attribution, no tool mentions.

## Package

Standalone npm app at `story/` (NOT part of the pnpm workspace — like `site/`, it has its own lockfile). Dev port **5180** (strict).

```
story/
  package.json
  index.html
  vite.config.ts
  tsconfig.json
  src/main.tsx
  src/styles.css
  src/App.tsx
  src/film/world.ts
  src/film/timeline.ts
  src/film/Film.tsx
```

package.json — name `good-goblin-story`, private, type module. Scripts: `dev` = `vite --port 5180 --strictPort`, `build` = `tsc --noEmit && vite build`, `preview` = `vite preview --port 5180 --strictPort`. Dependencies (pin these):

- react ^19.2.8, react-dom ^19.2.8
- three ^0.185.1, @react-three/fiber ^9.7.0
- gsap ^3.15.0, lenis ^1.3.26

Dev deps: @types/react ^19.2.17, @types/react-dom ^19.2.3, @types/three ^0.185.0, @vitejs/plugin-react ^6.0.4, typescript ~6.0.2, vite ^8.2.0.

vite.config.ts: just the react plugin. tsconfig: target ES2022, lib ES2022+DOM+DOM.Iterable, module ESNext, moduleResolution bundler, jsx react-jsx, strict true, noEmit true, skipLibCheck true, types ["vite/client"], include ["src"].

## Visual language

- `PAPER = 0xf7f5f0` — scene background AND fill color. `LINE = 0x222222`.
- Scene fog: `new THREE.FogExp2(PAPER, 0.012)` so distant line-work fades like pencil.
- Every solid is drawn by one helper:

```ts
function sketch(geom: THREE.BufferGeometry, threshold = 25): THREE.Group
// group of:
//  - Mesh(geom, MeshBasicMaterial({ color: PAPER, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }))
//  - LineSegments(new EdgesGeometry(geom, threshold), LineBasicMaterial({ color: LINE }))
```

Share the two materials across all sketches. White fill occludes what's behind (real sketch look), black edges draw the form.

- "Light" in pencil language = a **ray burst**: `rays(n = 10, r0 = 0.25, r1 = 0.55)` returns a LineSegments star of n radial spokes (LINE color). Used for lit campfires, lanterns, candles, and the natural-20 moment. Bursts pop in via scale (timeline) and slowly rotate via world clock (ambient).
- Ground: one big plane (fill, no edge lines) at y=0, e.g. 600×300 centered near x=90. A hand-drawn path under chapter 2 as a `THREE.Line` through a few gently curving points from x≈2 to x≈36 at y=0.01.

## Clocks — the freeze grammar in skeleton form

Two clocks, both plain mutable numbers advanced in `useFrame`:

- `world.t += delta * world.timeScale` — the WORLD clock. `timeScale` is tweened by the timeline (1 → 0 = time freeze). Everything ambient (fire flicker, ray-burst rotation) reads `world.t`, so a freeze visibly stops the world.
- `world.gobT += delta` — ALWAYS advances. The goblin's gait and the die's frozen-wobble read `gobT`: the goblin (and the wobbling die) stay alive while the world is frozen. This is the behind-the-curtain grammar, pencil edition.

## World interface (world.ts exports exactly this)

```ts
import * as THREE from 'three';

export interface Goblin {
  root: THREE.Group;              // position/rotation tweened by timeline
  torso: THREE.Group;             // bob target
  head: THREE.Group;              // look beats tween head.rotation
  armL: { pose: THREE.Group; swing: THREE.Group };  // timeline poses `pose`, gait writes `swing.rotation.x`
  armR: { pose: THREE.Group; swing: THREE.Group };
  legL: THREE.Group;              // gait writes rotation.x
  legR: THREE.Group;
  speed: number;                  // 0..1 gait amplitude, tweened by timeline
}

export interface World {
  root: THREE.Group;              // add to scene
  look: THREE.Vector3;            // camera lookAt target, tweened by timeline
  timeScale: number;              // world clock scale (freeze = 0)
  t: number;                      // world clock (useFrame advances)
  gobT: number;                   // goblin clock (useFrame advances)
  goblin: Goblin;

  // chapter 1 — ambush
  ambushFlames: THREE.Group;      // campfire flames, userData.lit starts at 1
  adventurers: THREE.Group[];     // 3 figures

  // chapter 2 — lighting the world (props in +x order)
  fire2Flames: THREE.Group;       // userData.lit starts at 0
  fire2Rays: THREE.Group;         // scale starts 0
  lanternRays: THREE.Group;       // scale starts 0
  caveDoor: THREE.Group;          // pivot at hinge; rotation.y 0 = closed
  chestLid: THREE.Group;          // pivot at back edge; rotation.x 0 = closed
  chestCoins: THREE.Group;        // scale starts 0
  ravens: THREE.Group[];          // 3, perched on a branch
  mushrooms: THREE.Group[];       // 3, scale start 0
  signBoard: THREE.Group;         // rotation.z starts at 0.5 (crooked)

  // chapter 3 — theatre set
  stageDisc: THREE.Group;         // giant disc; forest half + snowy-mountain half (mountain at +PI)
  rope: THREE.Group;              // hangs at disc edge

  // chapter 4 — tavern / dice
  die: THREE.Group;               // OUTER wobble wrapper — useFrame writes its rotation.z
  dieInner: THREE.Group;          // icosahedron inside; timeline tweens THIS position/rotation
  dieWobble: number;              // 0..1, tweened by timeline (frozen mid-wobble)

  // chapter 5 — montage vignettes (index 0..5, world positions below)
  roadLine: THREE.Group;          // scale.x starts 0 (road being drawn)
  monster: THREE.Group;           // scale starts 0
  tavernSign: THREE.Group;        // starts 1.2 above its bracket; drops into place
  trees5: THREE.Group[];          // 3, scale start 0
  chest5Lid: THREE.Group;         // like chestLid
  chest5Coins: THREE.Group;       // scale starts 0
  candleRays: THREE.Group;        // scale starts 0

  // chapter 6 — cliff + miniature world
  miniWorld: THREE.Group[];       // every miniature (houses, trees, mountain) — flatten tweens scale.y
  cliff: THREE.Group;

  // chapter 7 — the throw
  die2: THREE.Group;              // second d20, starts hidden (scale 0) at the cliff
  board: THREE.Group;             // pencil game board (grid), materials transparent, opacity starts 0
}

export function buildWorld(): World;
```

## Goblin rig (~0.9 units tall)

All parts `sketch()` primitives, origin at feet:

- legs: pivot groups at hip height y=0.30; each contains a cylinder (r 0.05, h 0.30) offset y=-0.15.
- torso group at y=0.30 containing a box (0.28, 0.34, 0.16) offset y=+0.17 — bob writes `torso.position.y` (base 0.30).
- head group at y=0.76: sphere r 0.16; nose = small cone (r 0.035, h 0.10) pointing +z; ears = two cones (r 0.05, h 0.26) sticking out sideways-up from the sphere — big goblin ears, unmistakable in silhouette.
- arms: `pose` group at shoulder (±0.17, 0.62, 0), containing `swing` group, containing cylinder (r 0.04, h 0.28) offset y=-0.14.
- Goblin faces +x when running (rotate root as needed per beat).

Adventurer figure (for c1 + minis): capsule-ish body = cylinder (r 0.14, h 0.5) + sphere head r 0.13 + cone hat; one thin box sword in hand. Height ~1.1 (taller than the goblin).

## Set layout (ground y=0 unless noted)

- **C1 ambush, around origin:** big rock (dodecahedron r 0.9, squashed y×0.6) at (0,0,0); goblin starts hidden behind it at (0.5, 0, 0.9), `root.position.y = -0.7` (risen to 0 when he peeks); campfire with `ambushFlames` at (-2.2, 0, 0.6); 3 adventurers around (-3.2..-1.8, 0, -0.8..1.0) facing +x, swords raised.
- **C2 path props at z≈0, in +x order:** campfire2 x=6 · lantern-on-post x=10 (rays at lamp height 1.1) · cave face (few big rocks) at x=14, z=-2, `caveDoor` plane 1.2×1.6 hinged at its left edge · chest x=18 · branch with 3 ravens x=22, height 1.6 · mushrooms x=26, z=-1.2 · signpost x=30 (post + arrow board, `signBoard` crooked at rotation.z 0.5).
- **C3 theatre at (44, 0, -2):** `stageDisc` = cylinder r 7, h 0.3, top at y=0.3. Forest half: ~8 pine trees (cone r 0.5–0.8, h 1.6–2.4 on stub trunks) scattered on the −x half of the disc. Mountain half: big cone (r 3.2, h 4.5) + two smaller cones, positioned on the +x half BUT the whole disc group starts rotated so the FOREST faces the path/camera; `rotation.y += PI` brings the mountain around. `rope` hangs from y=2.2 to 0.4 at (38.5, 0, 1).
- **C4 tavern interior at (80, 0, 0):** floor plane 12×9 (its own fill plane at y=0.01); back wall plane at z=-4 with a window hole suggestion (just a square line frame); table = cylinder top r 1.6 h 0.12 at y=0.85 + center leg; `die`(wrapper)+`dieInner` (icosahedron r 0.35) resting at (80, 1.26, 0) after landing — starts at (78.6, 1.7, 0.6); DM = one big adventurer figure (×1.3) at (80, 0, -2.4); two players seated at (78.3, 0, 1.6) and (81.7, 0, 1.6); 2 mugs (small cylinders) on the table; door frame (line rectangle) at (83.8, 0, 1.5) rotated to face the room.
- **C5 montage vignettes at z=-40, y=0, x = 0 / 8 / 16 / 24 / 32 / 40**, each on a platform disc r 2.5 h 0.2: (0) map table with `roadLine` — a long thin box 3×0.02×0.12 at table height, scale.x 0, anchored at its −x end (offset geometry or nested group so it grows from one end) · (8) `monster` — sphere r 0.7 with 6 cone spikes + horns · (16) tavern wall fragment with bracket; `tavernSign` board hanging 1.2 too high · (24) `trees5` 3 pines · (32) chest with `chest5Lid`/`chest5Coins` · (40) table with 3 candles (thin cylinders) + `candleRays`.
- **C6 cliff at (120, 0, 0):** `cliff` = tall box platform 6×6 footprint, top at y=6, with a few rock chunks; miniature world spread over x 130–170, z −18..18: ~8 houses (box + 4-segment cone roof, ~0.8 tall), ~12 mini pines, one mini mountain cone (h 3), road = 2 long THREE.Line polylines on the ground, river = one more line. Every miniature group goes into `miniWorld`.
- **C7:** `die2` (icosahedron r 0.5) at (122.8, 6.8, 0), scale 0. `board` = at (145, 35.4, 0): a 24×24 line grid (build from LineSegments — 25+25 segments, or GridHelper with both colors LINE), plus an outer border square, lying flat (facing +y); all its line materials `transparent: true, opacity: 0`.

## App shell (App.tsx + styles.css + index.html)

- `<div id="track">` height **1800vh** — scroll driver, empty.
- `<Canvas>` fixed inset-0 (fov 42, near 0.1, far 600, initial position [0, 2.2, 7]). Inside: `<Film caps={caps} />`.
- Fixed, pointer-events-none overlay layer with:
  - `#blackout` — full-screen black, opacity 1 initially.
  - Captions — absolutely centered text divs, opacity 0, registered into `caps: Record<string, HTMLElement>` via ref callbacks. Georgia/serif italic, #f7f5f0 on blackout / #222 on paper, ~clamp(1.4rem, 3.2vw, 2.4rem), letter-spacing 0.04em. IDs and texts:
    - `open1` — "Every campaign begins the same way…" (white — sits on the blackout)
    - `open2` — "…and one goblin always gets away."
    - `me1` — "That was me."
    - `me2` — "You thought I ran away."
    - `me3` — "I did."
    - `me4` — "Straight to work."
    - `nat1` — "Natural 1."
    - `nat20` — "Natural 20."
    - `welcome` — "You're welcome."
    - `endcard` — "GOOD GOBLIN" (not italic; letter-spacing 0.35em; ~clamp(2rem, 6vw, 4.5rem))
  - `#hint` — "scroll" + ↓, bottom-center, subtle, opacity 1 initially.
- Lenis in a `useEffect`:

```ts
const lenis = new Lenis();
lenis.on('scroll', ScrollTrigger.update);
const tick = (time: number) => lenis.raf(time * 1000);
gsap.ticker.add(tick);
gsap.ticker.lagSmoothing(0);
// cleanup: gsap.ticker.remove(tick); lenis.destroy();
```

- styles.css: margin 0, background PAPER, `overflow-x: hidden`, canvas/overlay layering (canvas z-0, overlays z-10), caption base class.

## Film.tsx

- `const world = useMemo(buildWorld, [])`; render `<primitive object={world.root} />`; set `scene.background = new Color(PAPER)` and `scene.fog = new FogExp2(PAPER, 0.012)` (via useThree, in an effect).
- `useFrame((state, delta)`:
  - `world.t += delta * world.timeScale; world.gobT += delta;`
  - camera.lookAt(world.look) every frame.
  - Flames (`ambushFlames`, `fire2Flames`): `const lit = flame.userData.lit; const s = lit * (1 + 0.18 * Math.sin(world.t * 9 + i)); flame.scale.set(s, lit * (1 + 0.3 * Math.abs(Math.sin(world.t * 13 + i))), s)` — flame groups are 2–3 cones; lit 0 → invisible.
  - Ray bursts (all of them): `rotation.z = world.t * 0.5` (scale is timeline-owned).
  - Goblin gait: `const sw = Math.sin(world.gobT * 11) * goblin.speed;` legL.rotation.x = sw*0.8, legR = −sw*0.8, armL.swing.rotation.x = −sw*0.6, armR.swing = sw*0.6, torso.position.y = 0.30 + 0.025*Math.abs(Math.sin(world.gobT*22))*goblin.speed.
  - Die wobble: `world.die.rotation.z = 0.02 * Math.sin(world.gobT * 6) * world.dieWobble`.
- `useEffect`: `const tl = buildTimeline(world, camera, caps); return () => { tl.scrollTrigger?.kill(); tl.kill(); }`.

## timeline.ts — the beat sheet

`export function buildTimeline(world: World, camera: THREE.Camera, caps: Record<string, HTMLElement>): gsap.core.Timeline`

Register ScrollTrigger. One `gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: { trigger: '#track', start: 'top top', end: 'bottom bottom', scrub: 0.8 } })`. Use eased sub-tweens freely (`power2.inOut` for camera, `back.out` for pops); absolute `tl.to(target, {...}, at)` positioning with the times below (timeline unit = 1; total 66). Caption helper: `cap(id, at, hold)` = fade opacity to 1 over 0.4 at `at`, back to 0 at `at + hold`. Camera helper: `cam(at, dur, pos, lookPos, ease?)` tweens camera.position and world.look together. Hard cut: `cut(at, pos, lookPos)` = `tl.set` both.

| t | what happens |
|---|---|
| 0–4 | Blackout up. cap open1 at 0.5, hold 2.5. `#hint` fades out over 0.3 at 0.6. |
| 4–5.5 | Blackout opacity→0. Camera drifts (0,2.2,7)→(0,2.0,6.2), look (0,0.8,0). Ambush tableau: fire flickering (lit=1), adventurers frozen mid-advance (static poses are fine — arms already raised). |
| 5–6 | Goblin peeks: root.position.y −0.7→0 (power2.out). |
| 6–8.5 | cap open2 at 6, hold 2. |
| 8.5–9.5 | Goblin turns +x (root.rotation.y→PI/2 …whatever faces +x), speed→1, root.x 0.5→2.5: he bolts. |
| 9.5–10 | **FREEZE**: timeScale→0 over 0.2. speed→0 (he halts mid-frame). Camera pushes in: cam(9.5, 1, (2.5,1.1,3.2), (2.5,0.7,0.9), power2.inOut). |
| 10.2–11 | Head turns to camera: head.rotation.y → −2.2 (over 0.5). |
| 10.8 | cap me1 hold 1.6 |
| 12.8 | cap me2 hold 1.4 · 14.4: cap me3 hold 1.0 · 15.6: cap me4 hold 1.4 |
| 16.5–17 | Head back (rotation.y→0), timeScale→1, speed→1. |
| 17–30 | **C2 run.** Goblin root.x runs 2.5→34 in 7 piecewise segments, one per prop; camera tracks alongside in matching piecewise tweens: for prop at x=P over its segment, camera → (P, 2.3, 6), look (P, 0.8, 0), linear. Per prop, the pattern within its ~1.85 window: run in (0.9) · speed→0, armR.pose.rotation.x→−2.0 reach (0.3) · prop action (0.5) · arm back + speed→1 (0.15). Prop actions: fire2 `userData.lit`→1 + fire2Rays scale 0→1 back.out · lanternRays 0→1 · caveDoor rotation.y→−1.9 · chestLid rotation.x→−1.3 + chestCoins scale→1 · ravens: each tweens position += (±1.5, 2.5–3.5, ±1) stagger 0.1 (they scatter) · mushrooms scale→1 stagger 0.12 · signBoard rotation.z 0.5→0. |
| 30–31.5 | Goblin runs 34→38.5 (to the rope); camera settles wide: cam(30, 1.5, (44, 3.5, 14), (44, 1.4, −2)). |
| 31.5–35 | Rope pull: speed→0; both arm poses rotation.x→−2.4 grab (0.4); goblin leans (root.rotation.z→0.15); **stageDisc rotation.y += PI over 2.5 (power2.inOut)** — forest rotates away, mountain swings in; rope y-jiggle ±0.15 during. Arms back, lean back. |
| 35–36 | Wave: armR.pose.rotation.z → −2.6, wiggle ±0.3 ×2, back. |
| 36–38 | speed→1, root.x 38.5→54; camera hands off to HIM: cam(36, 2, (50, 1.6, 5), (52, 0.7, 0)) — lower, closer, personal. |
| 38 | **C4 hard cut**: cut to (80, 2.1, 6.2), look (80, 1.0, 0). Goblin off-set (set root at (84.5, 0, 1.5) by the door, speed 0). |
| 38–40 | Die tumbles: dieInner position (78.6,1.7,0.6)→(80.4,1.21,0.1)→settle (80,1.21,0) with two y-bounces (1.7→1.45→1.28→1.21), rotation.x += 9, rotation.y += 5.5 decelerating (power3.out on the last leg). |
| 40.2 | cap nat1 hold 1.4. |
| 40.6–41 | **tick. FREEZE**: timeScale→0 (0.15 — abrupt). dieWobble→1 (set). Camera creeps: cam(40.6, 3, (80.9, 1.7, 3.4), (80, 1.2, 0), power1.inOut). |
| 41–42.6 | Goblin strolls in: root.rotation.y to face −x, speed→0.7, root (84.5,0,1.5)→(81.1,0,0.9), then speed→0. |
| 42.6–43.2 | Looks at die (head.rotation.y→0.6), then at US: head.rotation.y→−1.8 (0.4). |
| 43.4–44 | Shrug: both arm poses rotation.z → ±0.9 out and back (0.6). |
| 44–44.8 | Nudge: armR.pose.rotation.x→−1.6; dieInner rotation.z −0.35, position.x −0.12 (the tiny push); dieWobble→0. |
| 44.8–45.4 | Dust-off: armL/armR pose.rotation.x quick alternate ±0.5 ×2. |
| 45.4–46.6 | Walks off (speed→0.7, root→(84.5,0,1.5), speed→0); die re-rolls: dieInner rotation.x += 6.5, y += 4, position small drift, settling power3.out at 46.6. |
| 46.8 | cap nat20 hold 1.3; timeScale→1 at 47 (the cheer resumes — flames flicker again). |
| 48.4 | cap welcome hold 1.6. |
| 50–57.5 | **C5 montage**, six cuts, 1.25 each, vignette i at x=Vi, z=−40: `cut(50 + i*1.25, (Vi, 1.9, −35.6), (Vi, 0.7, −40))`; action in the first 0.9 of each: roadLine scale.x→1 · monster scale→1 back.out · tavernSign position.y −1.2 (drops onto bracket, bounce ease) · trees5 scale→1 stagger 0.15 · chest5Lid open + chest5Coins→1 · candleRays 0→1. Goblin: `tl.set` him into each vignette at its cut (position at platform edge, facing the action, speed 0, armR raised −1.2) — he's mid-job in every frame. |
| 57.5 | **C6 hard cut**: goblin set at cliff edge (122.6, 6, 0) facing +x; cut to (117.5, 7.4, 3.2), look (123, 6.6, 0) — over-the-shoulder, world beyond. |
| 58.5–62 | Camera rises: cam(58.5, 3.5, (128, 26, 8), (146, 2, 0), power2.inOut) then continues cam(62, 2.5, (145, 40, 0.01), (145, 0, 0)) — dead top-down. |
| 60–62 | **Flatten** during the rise: every group in miniWorld scale.y→0.02, stagger 0.05, power2.in. |
| 62.5–64.5 | The throw: die2 scale 0→1 (0.3); position (122.8,6.8,0)→arc→(145, 35.2, 0): x/z linear, y up via keyframe (6.8→30 at 63.5→35.2); rotation.x += 12, rotation.y += 8 decelerating; it flies INTO the top-down camera. |
| 64.5–65.5 | Board fades in: all board line materials opacity→1; die2 settles (tiny bounce); cap nat20 REUSE — instead add separate hold via cap('nat20', 64.7, 1.2) only if the element is free by then (it is). |
| 65.5–66 | cap endcard: opacity→1 and STAYS (no fade-out). Hint of rays: candleRays not reused — skip. End. |

Numbers are previz targets, not sacred — if a beat physically can't read (camera clips a set, goblin outruns the camera), adjust locally and keep the order and total length.

## Acceptance (integrator runs this)

1. `npm install` then `npm run build` clean in `story/` (tsc + vite, zero errors).
2. `npm run dev` on 5180; scrub the full scroll: every chapter beat occurs in order; no console errors or warnings.
3. Screenshots at ~each chapter (blackout text, ambush, a C2 prop moment, theatre mid-rotation, frozen die + goblin, one montage cut, the flatten, the board + endcard) saved to the scratchpad for review.
4. The freeze reads: ambush fire visibly flickers before t=9.5 and holds still during the freeze while the goblin still moves.
