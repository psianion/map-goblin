// Owns the frame render for the whole canvas. A priority useFrame disables
// R3F's own auto-render (see https://r3f.docs.pmnd.rs — passing a priority
// hands you the render loop), so every beat's frame goes through here: the
// plain single render normally, or — only while beat 4 "Trust" is pinned —
// two scissored renders of the *same* scene and camera, one with the secret
// door visible (DM pane), one with it swapped for a fog quad (player pane).
// That's the "genuinely lacks the geometry" claim: the player pass simply
// never draws that mesh, it isn't styled out.
import { useFrame } from '@react-three/fiber';
import { useEffect, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { markLoad } from '../loadProgress';
import { fogHiddenRef, playerFogRef, trustTokenRefs } from './focalAccents';
import { createPostFX, type PostFX } from './PostFX';
import { sceneProgress } from './sceneProgress';

// Loader milestone (index.html): the first pass through EITHER render path
// below is the moment the scene is actually on the screen — the last thing the
// first-paint loader waits for. Module-level and ref-guarded so the useFrame
// stays allocation-free (see the W1 note further down) and the call is a dead
// branch on every frame after the first.
function markFirstFrame(seen: RefObject<boolean>) {
  if (seen.current) return;
  seen.current = true;
  markLoad('frame');
}

const GAP_PX = 56;
// D2 "the lit table": the world's rest-state field is deep wood-dark (board
// `.d2 .stage` gradient's own outer stop, --wood-deep) — TableScene.tsx's
// always-on wood table plane now covers most of the frame at every beat, so
// this only shows past its own edges (wide shots, FOV overshoot at the
// corners), reading as the table simply continuing into shadow rather than
// a mismatched flat field. Was the flat DOM parchment hex; that only worked
// while the table itself was a beat-7-only reveal (round-1 D2 fix) — with
// the table world always present (this round), matching the wood it's
// literally sitting on is the correct rest state, not the page's paper.
// THREE's ColorManagement (on by default, three ^0.185) converts this hex
// sRGB→linear on construction same as any other material color, and
// PostFX.ts's GradeShader manually re-encodes linear→sRGB as its last step
// (this scene's whole post chain renders into an offscreen target that
// three never auto-sRGB-encodes) — so the round trip reproduces this hex
// verbatim. Must match TableScene.tsx's own <color>/<fog> literal exactly
// (grep NORMAL_BG when touching either).
const NORMAL_BG = '#3a2717';
// Per-pane scene background, swapped in for each of beat 4's two renders.
// Phase C retune (docs/2026-08-07-landing-art-pass-d2-plan.md, phase C): the
// D2 promise is "the DM pane IS the lit table" — everything visible, nothing
// dimmed. DM_PANE_BG is therefore NORMAL_BG itself (not a separate dark
// hex): the lerp below still runs every frame (same mechanism, same
// trustGlow driver — see the two gl.render calls below), it just has nowhere
// to go, so the DM half never leaves the room's own lit wood tone. Only the
// player pane still lerps toward a dark stop — its fog quad genuinely
// removes the room's geometry, so the bg needs to read as absence to match.
// (Round-1 fix used a shared #241a10/#170f08 dark pair for both panes — a
// sane interim "dim warm room" landing spot before this retune, not a design
// intent to dim the DM side.)
const DM_PANE_BG = NORMAL_BG;
const PLAYER_PANE_BG = '#170f08';
const NORMAL_BG_COLOR = new THREE.Color(NORMAL_BG);
const DM_PANE_BG_COLOR = new THREE.Color(DM_PANE_BG);
const PLAYER_PANE_BG_COLOR = new THREE.Color(PLAYER_PANE_BG);
// D2 fix round (finding 7): the background never night-tinted at all — by
// beat 5 the surround (NORMAL_BG) was brighter than the dimmed table sitting
// inside it. Board `.d2n .stage`'s own darkest outer stop. Must match
// TableScene.tsx's own NIGHT_BG_TINT literal exactly (grep NIGHT_BG when
// touching either) — same "two literals, not an import" contract NORMAL_BG
// already has with that file.
const NIGHT_BG_COLOR = new THREE.Color('#0c0906');

// Beat 4 "Trust"'s warm-dark vignette, screen-space over the whole canvas.
// Z1 fix round: the split now renders through PostFX like every other beat,
// so it gets that pass's own symmetric vignette too — this overlay is no
// longer standing in for it, it carries the one thing the shader can't: the
// DM/player ASYMMETRY (0.04 vs 0.24 below), i.e. the withheld view. A plain
// DOM overlay: cheaper
// than a camera-child mesh, and (unlike one) actually appears — R3F never
// adds useThree()'s camera to the scene graph, so nothing portaled onto it
// as a child is ever in a render list. Created once and owned here, same
// pattern as paneTagsRef below; opacity rides trustGlow every frame (see
// useFrame below), in step with the pane tags, so it crossfades with the
// split instead of hard-cutting in.
// Two pane-confined radials, not one screen-centered one: a single centered
// radial puts its transparent core in the gap BETWEEN the panes, leaving
// each pane's own center ~36% black — 2-3.5x darker than PostFX's vignette.
// W3 fix round: "centered at 25%/75%" alone was NOT pane-confined — a CSS
// radial's default farthest-corner radius on a full-viewport element is
// ~1486px at 1905x815, so the 55% transparent core (817px) swallowed the
// gradient's OWN pane entirely and the ramp only ever bit on the OPPOSITE
// pane: the 0.24 "withheld view" wash landed on the DM side, under the
// beat's copy, and the player side got ~0.04 — the asymmetry below, exactly
// inverted. Each radial now paints into its own half via a 50%-width
// no-repeat background tile, circle closest-side (= the tile's half-height),
// so the core sits inside its own pane, the ramp completes within it, and
// beyond the circle the final stop fills only that tile's corners. Nothing
// paints across the divider.
// Phase C retune (intent unchanged, now actually delivered): asymmetric to
// match the pane-bg retune — DM (left) a bare 0.04 corner falloff, player
// (right) 0.24, carrying the whole beat's "withheld view" read; it stacks on
// PostFX's own symmetric vignette rather than replacing it.
const TRUST_VIGNETTE_GRADIENT =
  'radial-gradient(circle closest-side at center, rgba(18,12,6,0) 0%, rgba(18,12,6,0) 55%, rgba(18,12,6,0.04) 100%) left center / 50% 100% no-repeat, ' +
  'radial-gradient(circle closest-side at center, rgba(18,12,6,0) 0%, rgba(18,12,6,0) 55%, rgba(18,12,6,0.24) 100%) right center / 50% 100% no-repeat';

// X1 fix round: shared machinery for driving beat 4's DM/player CONTENT
// differences off trustGlow, same as the crop/background below already do —
// see the useFrame comment further down for why a hard per-pane `.visible`
// flip isn't enough. `fadeBase` captures each material's opacity as
// Diorama.tsx's OWN per-frame passes (rise/night-tint, riseT-driven prop
// fades — all of which run before this component's priority-1 useFrame)
// already left it for THIS frame, taken once before either pane renders so
// the DM pane can restate its own baseline (factor 1) and the player pane
// can scale toward 0 without either reading a value the OTHER pane already
// mutated earlier in the same frame.
type FadableMaterial = THREE.Material & { opacity: number };
const fadeBase = new Map<THREE.Material, number>();
// W1 fix round scratch (allocation-free useFrame):
const _logicalSize = new THREE.Vector2();
function forEachMaterial(obj: THREE.Object3D | null, fn: (mat: FadableMaterial) => void) {
  if (!obj) return;
  obj.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (const m of mats) fn(m as FadableMaterial);
  });
}
// Multiplies each material's CAPTURED baseline by `factor` — for content
// whose "on" value isn't a fixed literal (door/fogHidden opacity is
// riseT/stagger-driven, not always exactly 1, even though it settles there
// well before beat 4).
function fade(obj: THREE.Object3D | null, factor: number) {
  forEachMaterial(obj, (m) => {
    m.opacity = (fadeBase.get(m) ?? m.opacity) * factor;
  });
}
// Sets a literal opacity — for content with a fixed target and no external
// driver of its own: the badge, the door's wall-filler, the visibility-sweep
// fog, the blue token. Nothing else in this scene ever touches theirs.
function setOpacity(obj: THREE.Object3D | null, value: number) {
  forEachMaterial(obj, (m) => {
    m.opacity = value;
  });
}
// Issue-6 regression fix, on depth-write: nothing else is needed here. A
// transparent material still writes depth, so a half-concealed prop stamps
// its silhouette into the depth buffer and depth-rejects whatever the
// transparent pass draws after it — which is how a fade turns back into an
// x-ray. Measured against the live beat-4 draw order rather than assumed,
// both panes, at the mid-beat worst case: three sorts that pass back-to-
// front by object origin, and it puts the map floor, the PlayerFog quad
// (~35 draw calls ahead of the first prop body) and every torch pool
// BEFORE the props, with nothing left drawing underneath them afterwards.
// So the props blend over an already-painted fog wash and floor, and
// dropping depthWrite mid-fade would buy nothing while costing the one
// thing this beat cannot spend: a hard per-pane state difference that does
// not vanish as trustGlow -> 0 (finding X1). If a future prop lands under a
// LATER-drawn opaque-ish sibling, re-measure before reaching for
// depthWrite — it is a per-pane flag, and per-pane flags break the
// crossover.

export function SceneRenderer({
  secretDoorRef,
  secretBadgeRef,
  fogQuadRef,
}: {
  secretDoorRef: RefObject<THREE.Object3D | null>;
  secretBadgeRef: RefObject<THREE.Object3D | null>;
  fogQuadRef: RefObject<THREE.Object3D | null>;
}) {
  // One EffectComposer per gl context (never rebuilt — gl/scene/camera are
  // stable for the canvas' lifetime), lazily built on the first frame.
  const postFxRef = useRef<PostFX | null>(null);
  // Beat 4 "Trust": the YOUR VIEW / THEIR VIEW DOM tags — driven imperatively
  // off the exact same trustT that opens the canvas gap below, same pattern
  // ScrollCamera.tsx already uses for its own DOM pokes (scrub-fill/
  // scrub-thumb).
  // R6 fix round: this element used to live in App.tsx's JSX, inside the
  // "trust" section itself — which un-pins and scrolls away as soon as beat
  // 5's own pin starts, well before the split (still gated on trustGlow, not
  // that section's own pin) is done easing shut. Created here instead, same
  // as trustVignette below — parented to .canvas-mount, which is never
  // pinned/transformed by GSAP, so it stays put over the canvas for exactly
  // as long as the split does.
  const paneTagsRef = useRef<HTMLElement | null>(null);
  // R6 fix round: beat 5's scrub track (App.tsx/global.css, `.scrub`) used to
  // be driven to opacity 1 once by ScrollCamera.tsx and left there — fine
  // while the canvas gap died the instant trustActive flipped off, but now
  // that the split eases shut across trustGlow (see the gate below), the
  // scrub track needs to stay hidden until that close finishes instead of
  // arriving on top of the still-split canvas. Queried here, driven every
  // frame alongside paneTags/trustVignette below, off (1 - trustGlow) so it
  // fades in exactly as the split fades out.
  const scrubRef = useRef<HTMLElement | null>(null);
  // Owned here, not App.tsx/global.css — created once and styled entirely
  // inline (see TRUST_VIGNETTE_GRADIENT above) so this beat stays
  // self-contained the same way the pane tags' *styling* lives in
  // global.css but this element's does not need to.
  const trustVignetteRef = useRef<HTMLDivElement | null>(null);
  // Phase F: the molten crack inside beat 4's wood divider — the page's seam
  // passing between the two views (see global.css `.pane-divider`, styled in
  // the seam's own material family). Same lifecycle as trustVignette/paneTags
  // above; width tracks the canvas gap and opacity rides trustGlow per frame.
  const dividerRef = useRef<HTMLDivElement | null>(null);
  // Loader milestone: this component owns the frame, so its first pass IS the
  // moment the scene is on the screen — the last thing the loader waits for.
  const firstFrameRef = useRef(false);
  useEffect(() => {
    scrubRef.current = document.querySelector<HTMLElement>('.scrub');
    const mount = document.querySelector<HTMLElement>('.canvas-mount');
    if (mount) {
      const el = document.createElement('div');
      el.style.position = 'absolute';
      el.style.inset = '0';
      el.style.pointerEvents = 'none';
      el.style.opacity = '0';
      el.style.background = TRUST_VIGNETTE_GRADIENT;
      mount.appendChild(el);
      trustVignetteRef.current = el;
    }
    let dividerEl: HTMLDivElement | null = null;
    if (mount) {
      const el = document.createElement('div');
      el.className = 'pane-divider';
      el.setAttribute('aria-hidden', 'true');
      mount.appendChild(el);
      dividerEl = el;
      dividerRef.current = el;
    }
    // R6 fix round: markup/styling stay identical to the old App.tsx JSX
    // (global.css's .pane-tags/.pane-tag rules still own the visuals; keep
    // the aria-hidden semantics) — only the parent changed, from the
    // "trust" section to .canvas-mount, so GSAP's pin transform on that
    // section can no longer carry these tags away with it.
    let paneTagsEl: HTMLElement | null = null;
    if (mount) {
      const el = document.createElement('div');
      el.className = 'pane-tags';
      el.setAttribute('aria-hidden', 'true');
      const dm = document.createElement('span');
      dm.className = 'pane-tag dm';
      dm.textContent = 'YOUR VIEW';
      const pl = document.createElement('span');
      pl.className = 'pane-tag pl';
      pl.textContent = 'THEIR VIEW';
      el.append(dm, pl);
      mount.appendChild(el);
      paneTagsEl = el;
      paneTagsRef.current = el;
    }
    return () => {
      trustVignetteRef.current?.remove();
      trustVignetteRef.current = null;
      dividerEl?.remove();
      dividerRef.current = null;
      paneTagsEl?.remove();
      paneTagsRef.current = null;
    };
  }, []);

  useFrame(({ gl, scene, camera }, delta) => {
    // w/h are DEVICE pixels — correct for the pane/scissor math and
    // setViewOffset below (render-target rects take raw device px). But
    // THREE's renderer.setViewport takes LOGICAL pixels and multiplies by
    // the pixel ratio itself whenever the target is null — feeding it w/h
    // blew the final grade pass's viewport up by dpr, so every dpr>1
    // visitor saw a cropped zoom of the frame's bottom-left corner on
    // every non-split beat (W1 fix round). Viewport calls use `logical`.
    const w = gl.domElement.width;
    const h = gl.domElement.height;
    const logical = gl.getSize(_logicalSize);
    const door = secretDoorRef.current;
    const badge = secretBadgeRef.current;
    const fog = fogQuadRef.current;
    const sightFog = playerFogRef.current;
    const redToken = trustTokenRefs.red.current;
    const blueToken = trustTokenRefs.blue.current;
    const fogHidden = fogHiddenRef.current;
    const paneTags = paneTagsRef.current;
    const trustVignette = trustVignetteRef.current;
    const divider = dividerRef.current;
    const scrub = scrubRef.current;
    const bg = scene.background instanceof THREE.Color ? scene.background : null;
    // D2 fix round (finding 7): swap-gated the same as TableScene.tsx's own
    // nightT / Diorama.tsx's own nightT — see either's comment for why the
    // (1 - swapT) gate is needed (clockT alone never resets past beat 5).
    const nightT = sceneProgress.clockT * (1 - sceneProgress.swapT);
    if (bg) bg.copy(NORMAL_BG_COLOR).lerp(NIGHT_BG_COLOR, nightT);
    // Background-texture critique P2-9: expose nightT to the DOM. Originally
    // fed .stage-lamp's own dimming (retired — issue 4, see global.css's
    // comment at that rule's former location). Nothing in the stylesheet
    // consumes it today; it stays as the world clock's one DOM read-out,
    // which every verification pass on this beat measures scroll position
    // against. Swap-gated already, so any DOM consumer restores on the beat-6
    // swap exactly like the canvas does.
    document.documentElement.style.setProperty('--night-t', nightT.toFixed(3));
    // The companion `--night-t-copy` (a front-loaded cubic of nightT) is
    // GONE, and must not come back: it existed to ramp beat 5's ink toward
    // --text as the world darkened, which cannot work at any ramp shape —
    // the ink crosses the floor's own luminance on the way past it, and at
    // the crossing the ratio is 1:1. Front-loading only relocated the
    // crossing into the middle of the beat (h2 hit 1.08:1 at worldP 0.50).
    // The copy now carries its own parchment ground instead and never reads
    // the world's clock at all — full argument at global.css's
    // [data-beat='world-turns'] rule.

    // Crossfades continuously through the beat4->beat5 boundary instead of
    // hard-cutting there. trustT holds at 1 once beat 4's own pin ends (it's
    // never reset), so gating this on trustActive would drop it 1->0 the
    // instant the pin releases — clockT is still 0 at that exact moment, so
    // the cut would land right where this is trying to avoid one.
    // C2 fix round: this used to decay linearly across the ENTIRE clockT
    // range (all of beat 5's scrub), while the crop x-offsets and pane bg
    // lerp below rode trustT (pinned at 1 through all of beat 5) — two
    // different clocks driving one split, so the last frames of the close
    // kept drawing the SAME slice twice (crops still at their split
    // x-offsets) with a hard seam, then hard-cut once trustGlow finally hit
    // 0 near the end of beat 5. One clock now: trustGlow closes fully within
    // the FIRST 20% of beat 5's own clockT, and (below) the crop offsets and
    // pane bg both ride this same trustGlow instead of trustT — so the split
    // is fully closed (crops back to tiling the unsplit frame) well before
    // clockT ever reaches the values it's compared against here.
    // F1 fix round: reads worldP — beat 5's RAW pin progress — not clockT.
    // clockT is now re-windowed onto the part of that pin the viewer can
    // actually read (ScrollCamera.tsx, i === 4), and it is 0 for the whole
    // stretch this close runs over, which would have frozen the split open.
    // The split's timing on screen is therefore unchanged; only the day it
    // used to be sharing a clock with has moved.
    const trustGlow = sceneProgress.trustT * (1 - Math.min(1, sceneProgress.worldP / 0.2));
    if (paneTags) paneTags.style.opacity = String(trustGlow);
    if (trustVignette) trustVignette.style.opacity = String(trustGlow);
    if (divider) {
      // Width mirrors the canvas gap exactly: same rounded-device-px value as
      // `gap` below, converted back to logical px, so the glow column never
      // overhangs a pane by more than the split's own 1px AA overlap. Opacity
      // rides trustGlow like its siblings — fades with the split, no hard cut.
      const dpr = gl.getPixelRatio();
      divider.style.width = `${Math.round(GAP_PX * dpr * trustGlow) / dpr}px`;
      divider.style.opacity = String(trustGlow);
    }
    // R6 fix round: fades in as the split (below) fades out, so it never
    // arrives on top of the still-split canvas. Rides trustGlow, so it is on
    // worldP too — the widget still finishes appearing at the same scroll
    // position it always did, but its thumb (clockT) is now still at dawn
    // when it gets there rather than already past noon.
    if (scrub) scrub.style.opacity = String(1 - trustGlow);

    // R2 fix round: gated on trustGlow (not just trustActive) so the split
    // keeps rendering — and its gap keeps easing shut, see GAP_PX below —
    // through the start of beat 5 instead of snapping to a single render the
    // instant beat 4's own pin releases (trustActive flips off right there;
    // trustGlow doesn't reach 0 until clockT has climbed through beat 5's
    // own scrub).
    if (!postFxRef.current) postFxRef.current = createPostFX(gl, scene, camera);
    const postFx = postFxRef.current;
    if (!(sceneProgress.trustActive || trustGlow > 0) || !door || !fog || !sightFog) {
      gl.setScissorTest(false);
      gl.setViewport(0, 0, logical.width, logical.height);
      postFx.render(delta);
      markFirstFrame(firstFrameRef);
      return;
    }

    // R1+R5 fix round: the gap now eases off trustGlow (closes over beat 5's
    // first slice, not a hard snap — see the gate above) rather than trustT.
    const gap = Math.round(GAP_PX * gl.getPixelRatio() * trustGlow);
    const halfW = Math.max(1, Math.floor((w - gap) / 2));
    // THE DESIGN (binding, see the top of this file's own history/PR notes):
    // one camera, one crop shape, both panes at identical scale — the split
    // is ONLY a difference in which halfW-wide slice of the SAME frustum
    // each pane samples, mirrored around center, plus which objects are
    // visible. The old DM pane instead widened its OWN crop width toward the
    // full frame while rendering into the same halfW-pixel viewport — a
    // zoom-out relative to the player pane, so the two panes never agreed on
    // scale (the bug this replaces). Both crops now share the exact same
    // width (halfW) and height (h) via setViewOffset; only the x-offset
    // differs, and it differs symmetrically: player slides from the right
    // edge (w-halfW) to centerX as trustT climbs, DM slides from the left
    // edge (0) to that SAME centerX — a mirror image of the player's own
    // slide, so at trustT=0 the two crops tile the unsplit frame exactly,
    // and at trustT=1 they converge on the same centered slice (the panes
    // still differ there — by content, not by camera).
    const cam = camera as THREE.PerspectiveCamera;
    const centerX = (w - halfW) / 2;

    // X1 fix round: door/badge/fog/sightFog/blueToken/fogHidden used to be
    // hard visible=true/false swaps per pane — genuinely absent geometry for
    // the player pane's own sake, but it meant the two passes' CONTENT only
    // ever agreed exactly at trustGlow===0, never mid-decay, while the crop
    // and background above already rode trustGlow continuously. Right at the
    // trustGlow-hits-0 crossover (this useFrame's own early-return gate
    // above), a whole pane's worth of content popped across a 1-2px scroll
    // delta. Every one of those differences now rides the SAME trustGlow —
    // captured once, before either pane mutates anything, so neither pane's
    // opacity math ever reads a value the OTHER pane already wrote earlier
    // in this same frame.
    fadeBase.clear();
    forEachMaterial(door, (m) => fadeBase.set(m, m.opacity));
    forEachMaterial(fogHidden, (m) => fadeBase.set(m, m.opacity));
    // THE UNLIT-CONVERSION TRAP, in one place. `material.opacity` is inert on
    // a material with `transparent === false`: three uploads it as a uniform
    // but the fragment shader's blend equation never sees it, so every
    // opacity drive below is a silent no-op until this flag is on. That is
    // not a MeshBasicMaterial quirk — MeshToonMaterial defaulted to opaque
    // too — so ANY future material swap under one of these refs re-arms it.
    // Three groups need the flip, all for the same reason (their bodies are
    // opaque by construction, and nothing but this beat ever fades them):
    //   - the two trust tokens, whose DM/player difference IS the beat's
    //     claim (the player pane must never show the blue one);
    //   - fogHiddenRef's contents (issue 6): the prop reveal is a scale.y
    //     grow-in now, not an opacity fade, so the four prop bodies are
    //     opaque MeshBasicMaterial and the player pane's concealment fade
    //     below stopped concealing anything — the crate stack, the bone
    //     pile, the vault and both braziers stood in THEIR VIEW as solid,
    //     un-outlined, un-shadowed bodies inside the region the beat says
    //     the party cannot see.
    // Flipped here rather than at each material's construction site so the
    // one group toggle keeps its promise: anything later dropped inside
    // fogHiddenRef is concealed correctly without being wired up by hand.
    // Beats 1-3 keep the bodies genuinely opaque (this branch only runs at
    // beat 4), so the grow-in reveal is untouched by any of it, and at
    // opacity 1 with depth-write on a transparent material is pixel-
    // identical to an opaque one — only its queue changes.
    forEachMaterial(redToken, (m) => {
      if (!m.transparent) m.transparent = true;
    });
    forEachMaterial(blueToken, (m) => {
      if (!m.transparent) m.transparent = true;
    });
    forEachMaterial(fogHidden, (m) => {
      if (!m.transparent) m.transparent = true;
    });

    // Z1 fix round: both panes render into PostFX's OWN linear target (the
    // full-frame clear included) and the shared grade pass encodes the result
    // to sRGB once, so this beat's transparent content (fog quad, sight
    // wedge, torch pools, outlines) blends in exactly the same colorspace as
    // every other beat's — no step at either boundary. That non-null target
    // is also why renderer tonemapping needs no override here: three only
    // applies it when the target is null.
    // W4 fix round: renderSplit's full-frame clear is what paints the
    // inter-pane gap. At the default transparent clear the gap showed the
    // DOM parchment through the canvas — a bright cream column down the
    // centre of the beat's wood-and-shadow frame. The divider is the table
    // showing between the two views (the molten green lives in the DOM
    // `.pane-divider` overlay above, not here): clear opaque to the wood
    // field, passed INTO renderSplit so the clear colour is set with the
    // linear target already bound (set out here, three converts it to sRGB
    // against the still-bound canvas and the gap double-encodes — see
    // PostFX's renderSplit interface comment).
    postFx.renderSplit((pane) => {
      // DM pane — left: the secret door, marked, both tokens, whole plan
      // visible. Own baseline everywhere (factor/value = "fully on") — only
      // the badge eases IN with trustGlow (was an instant pop the instant the
      // beat activated, which the player pane — permanently at 0 — could never
      // match at trustGlow=0).
      door.visible = true;
      fade(door, 1);
      if (badge) {
        badge.visible = true;
        setOpacity(badge, trustGlow);
      }
      fog.visible = true;
      setOpacity(fog, 0);
      sightFog.visible = true;
      setOpacity(sightFog, 0);
      // C2 fix round: both rode trustT (pinned at 1 through beat 5) — now ride
      // trustGlow so the crop slides back to tiling the unsplit frame, and the
      // pane tint lerps back to NORMAL_BG_COLOR, exactly as the split closes.
      bg?.lerpColors(NORMAL_BG_COLOR, DM_PANE_BG_COLOR, trustGlow);
      cam.setViewOffset(w, h, THREE.MathUtils.lerp(0, centerX, trustGlow), 0, halfW, h);
      cam.updateMatrixWorld();
      // X1 fix round: both tokens are beat-4-exclusive dressing (same as
      // SightSweep's own walking token — see its sightActive gate — nothing
      // later in the scroll ever expects a token sitting on the table), so
      // besides the DM/player reveal difference below, BOTH also carry the
      // overall trustGlow envelope: opaque materials by default (verified
      // browser-tested — without this they popped OFF the instant the render
      // mode fell through to the single pass at trustGlow===0, the reset
      // block's own hidden state, even though DM and player already agreed
      // with EACH OTHER). DM shows the whole plan, no per-frame edge check
      // needed (see TRUST_TOKENS.red's own comment in mapData.ts for why the
      // old edge-hiding hack existed and is gone).
      if (redToken) {
        redToken.visible = true;
        setOpacity(redToken, trustGlow);
      }
      if (blueToken) {
        blueToken.visible = true;
        setOpacity(blueToken, trustGlow);
      }
      // R3 fix round: DM pane shows everything fogHiddenRef wraps (props,
      // torch pools, the SE-room glint that fall inside FOG_RECT) — same as
      // every other beat.
      if (fogHidden) {
        fogHidden.visible = true;
        fade(fogHidden, 1);
      }
      pane(0, 0, halfW, h);
      gl.render(scene, camera);

      // Player pane — right: the door leaf fades OUT (never hidden outright —
      // it's still genuinely there behind the wall-filler mid-decay, exactly
      // as much as the DM pane's own copy), the wall-filler quad and the real
      // visibility sweep from the corridor (focalAccents.tsx's PlayerFog)
      // stand in for the old whole-room blackout and fade IN, and only the red
      // token/DM-only dressing fades OUT — genuinely missing geometry and
      // hardware at trustGlow=1, not just the secret door, but real walls/
      // floor wherever the party can actually see — while every one of these
      // converges on the DM pane's own value as trustGlow -> 0.
      door.visible = true;
      fade(door, 1 - trustGlow);
      if (badge) {
        badge.visible = true;
        setOpacity(badge, 0);
      }
      fog.visible = true;
      setOpacity(fog, trustGlow);
      sightFog.visible = true;
      setOpacity(sightFog, 0.96 * trustGlow);
      bg?.lerpColors(NORMAL_BG_COLOR, PLAYER_PANE_BG_COLOR, trustGlow);
      cam.setViewOffset(w, h, THREE.MathUtils.lerp(w - halfW, centerX, trustGlow), 0, halfW, h);
      cam.updateMatrixWorld();
      if (redToken) {
        redToken.visible = true;
        setOpacity(redToken, trustGlow);
      }
      if (blueToken) {
        // DM-only, always (mapData's TRUST_TOKENS contract: player pane never
        // shows the blue token — the beat's whole claim). Opacity 0 still
        // converges with the DM pane at the trustGlow=0 crossover, since the
        // DM pane drives it to trustGlow (=0 there) and the reset block hides
        // it — the old trustGlow*(1-trustGlow) reveal term peaked at 0.25
        // mid-beat, leaking the secret token into THEIR VIEW.
        blueToken.visible = true;
        setOpacity(blueToken, 0);
      }
      // R3 fix round: one group toggle hides the vault, bones-b, crates-b, the
      // treasure glint, and every torch pool inside FOG_RECT in a single write
      // (see focalAccents.tsx's fogHiddenRef comment) — replaces the old
      // concealedPropsRef (vault only) + fogCoveredPoolRefs (pools only) pair,
      // which kept missing whichever sibling prop hadn't been wired into one
      // of the two by hand. X1 fix round: opacity-faded, not visibility-toggled
      // (see this useFrame's own top comment) — a hard `.visible = false` here
      // would flip a third of the canvas in one frame at the trustGlow=0
      // crossover, which is the bug X1 fixed; this converges on the DM pane's
      // own value instead. Issue-6 regression fix: that fade only means
      // anything because the capture block above flips `transparent` on the
      // group's opaque prop bodies first.
      if (fogHidden) {
        fogHidden.visible = true;
        fade(fogHidden, 1 - trustGlow);
      }
      // R7 fix round: the player pane's own scissor/viewport starts 1px to the
      // LEFT of its crop's true boundary (w-halfW-1, one wider) so it overlaps
      // the DM pane's own right edge by a pixel — at trustT~0 the two scissor
      // rects otherwise tile EXACTLY with no pixel written by both passes,
      // which left a dark hairline seam between them (neither renderer's own
      // edge sampling/AA agreed on that exact boundary column). The 1px-wider
      // destination stretches the same halfW-wide crop across halfW+1 pixels —
      // imperceptible.
      pane(w - halfW - 1, 0, halfW + 1, h);
      gl.render(scene, camera);
    }, delta, NORMAL_BG_COLOR);

    cam.clearViewOffset();
    gl.setScissorTest(false);
    gl.setViewport(0, 0, logical.width, logical.height);
    bg?.copy(NORMAL_BG_COLOR).lerp(NIGHT_BG_COLOR, nightT);
    // Leave the shared meshes in their normal (DM) state for other beats —
    // restored to each material's own captured baseline (fade(...,1)), not a
    // hardcoded 1, so the NEXT time beat 4 activates its own capture step
    // above starts from the true rest value again.
    door.visible = true;
    fade(door, 1);
    if (badge) {
      badge.visible = false;
      setOpacity(badge, 0);
    }
    fog.visible = false;
    setOpacity(fog, 0);
    sightFog.visible = false;
    setOpacity(sightFog, 0);
    // Tokens: opacity already converged to 0 in both passes above (the
    // trustGlow envelope) — visible=false here is a pure draw-call skip for
    // the single-pass path, not doing any of the actual hiding.
    if (redToken) redToken.visible = false;
    if (blueToken) blueToken.visible = false;
    if (fogHidden) {
      fogHidden.visible = true;
      fade(fogHidden, 1);
    }

    markFirstFrame(firstFrameRef);
  }, 1);

  return null;
}
