// Drives the diorama camera from scroll: each `.beat` section pins while its
// segment of the CatmullRom path scrubs. Lenis smooths the wheel; GSAP
// ScrollTrigger owns the pins. `prefers-reduced-motion` bypasses both —
// camera snaps once per section via IntersectionObserver instead.
import { invalidate, useFrame, useThree } from '@react-three/fiber';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { BEAT_COUNT, sampleCamera, setPathViewport } from './cameraPath';
import { sceneProgress, writeCopyV, type BeatProgressKey } from './sceneProgress';

gsap.registerPlugin(ScrollTrigger);

// Progress key each `main .beat` section's copy FADES IN on, in DOM order
// (see cameraPath.ts's CAMERA_KEYFRAMES comment for what's at each index).
// null means "no own picture to establish" — the whisper is already at rest
// when the page loads, so its copy starts fully visible (see useBeatCopy).
// The hero and the door are exempted from scroll-gating entirely (F6/F7 —
// the hero H1+CTA and the closing CTA are never hidden), so they carry no
// `.copy-scrub` wrapper for this to find in the first place; their null
// entries are placeholders keeping this array in DOM order.
// The fade OUT is no longer keyed to the next beat's picture — every beat's
// copy now dissolves over the tail of its own pin's raw progress (see rawP
// and updateCopy below, and sceneProgress.ts's EXIT_* window).
const COPY_OWN: ReadonlyArray<BeatProgressKey | null> = [
  null, // whisper
  'inkT', // ink
  null, // the rise (hero) — exempt
  'sightT', // sight
  'trustT', // trust
  'worldP', // the world turns — the RAW pin progress, not the re-windowed clockT
  'swapT', // the swap
  'kitT', // the kit
  null, // the door — never gated
];

// Fraction of a camera segment handed to the scroll that runs BEFORE the
// beat's own pin — the whisper pin for segment 0, and the leftover 1vh
// handoff gap for the sections that still keep a pin spacer (see the
// `keepSpacer` / lead-trigger blocks below). The pin itself still finishes
// exactly on its own keyframe, so the "a beat's pin ends AT that beat's
// keyframe" contract documented below is untouched; only the start of the
// camera's travel moves earlier, into scroll that previously drove nothing.
// 0.5 because every lead is exactly as long as the pin that follows it
// (both are 1vh), so an even split is also a constant camera velocity
// across the pair — the alternative to today's dash-then-freeze.
const LEAD_SHARE = 0.5;

export function ScrollCamera() {
  const { camera, size } = useThree();
  const target = useRef({ t: 0, dirty: true });

  // Issue 3 fix: keyframe 4's framing (cameraPath.ts) is solved against the half-pane crop,
  // so it has to be re-derived whenever the canvas's CSS size changes — not just at mount.
  // Width AND height both go in, not their ratio: the split's GAP_PX is a fixed pixel gap, so
  // it eats a bigger share of a short window's half-pane than of a tall one at the same
  // aspect (see cameraPath.ts's derivation — that dropped term is what clipped beat 4 at
  // 1200x917). `size` here is R3F's own tracked size for the `.canvas-mount` container
  // (fixed, inset:0), which R3F already re-measures via ResizeObserver on every window
  // resize, so no separate `window.addEventListener('resize', ...)` is needed. This effect
  // only re-runs when width/height actually change (React's dependency array), and
  // setPathViewport itself no-ops unless the derived y moved — so the curve is never rebuilt
  // per frame, only on a genuine viewport-shape change. Marking dirty + invalidate() applies
  // the new path on the very next render instead of waiting for the next scroll tick
  // (useFrame below only resamples when target.current.dirty is set).
  useEffect(() => {
    setPathViewport(size.width, size.height);
    target.current.dirty = true;
    invalidate();
  }, [size.width, size.height]);

  useEffect(() => {
    // The scene exists and is about to drive scroll progress — see
    // sceneProgress.ts's `live` doc comment. Set unconditionally (before the
    // reduced-motion branch below) since reduced motion still drives these
    // fields, just via hard cuts instead of a scrub.
    sceneProgress.live = true;

    const sections = Array.from(document.querySelectorAll<HTMLElement>('main .beat'));
    if (sections.length !== BEAT_COUNT) {
      console.warn(`ScrollCamera: expected ${BEAT_COUNT} beat sections, found ${sections.length}`);
    }
    const segments = Math.max(sections.length - 1, 1);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Beat copy (App.tsx, useBeatCopy.ts) — same imperative DOM-poke pattern
    // as scrubFill/scrubThumb below, keyed off COPY_OWN by section index.
    // Skipped under reduced motion: CSS forces full opacity there instead.
    const copyEls = sections.map((section) => section.querySelector<HTMLElement>('.copy-scrub'));
    // Raw ScrollTrigger progress of each section's OWN pin, kept here rather
    // than in sceneProgress because it isn't scene state — it's the only
    // honest clock for a beat's copy exit. The shaped picture vars can't do
    // it: clockT is re-windowed (i === 4 below) and swapT saturates at 45%
    // of its pin, so both hit 1 long before their pin releases.
    const rawP = sections.map(() => 0);
    const updateCopy = () => {
      for (let i = 0; i < copyEls.length; i++) {
        const el = copyEls[i];
        if (!el) continue;
        const ownKey = COPY_OWN[i];
        writeCopyV(el, ownKey ? sceneProgress[ownKey] : 1, rawP[i]);
      }
    };
    // Undoes updateCopy's writes on unmount (both cleanups below) — without
    // this, narrowing past 900px (Canvas3D/this component unmount, MobileHero
    // mounts) leaves whatever --copy-v/data-copy-hidden was last written in
    // place, which can be a faded-out beat stuck permanently
    // visibility:hidden with no scene left to un-hide it.
    const clearCopy = () => {
      for (const el of copyEls) {
        if (!el) continue;
        el.style.removeProperty('--copy-v');
        el.removeAttribute('data-copy-hidden');
      }
    };

    // Beat 5's scrub UI (App.tsx) — plain DOM, driven imperatively off the
    // same clockT this effect already computes, same pattern as the
    // `main .beat` query above.
    const scrubFill = document.querySelector<HTMLElement>('.scrub-fill');
    const scrubThumb = document.querySelector<HTMLElement>('.scrub-thumb');
    const setScrub = (t: number) => {
      if (scrubFill) scrubFill.style.width = `${t * 100}%`;
      if (scrubThumb) scrubThumb.style.left = `${t * 100}%`;
    };
    // .scrub itself defaults to opacity:0 (global.css) so it doesn't show a
    // dead track on mobile/no-WebGL or before this component has mounted —
    // once it's live (this effect is running at all), the track has a real
    // scene behind it, so show it unconditionally rather than tracking it
    // through the pin lifecycle the way pane-tags rides trustT.
    const scrubEl = document.querySelector<HTMLElement>('.scrub');
    if (scrubEl) scrubEl.style.opacity = '1';

    const setT = (t: number) => {
      target.current.t = t;
      target.current.dirty = true;
      invalidate();
    };
    setT(0);

    if (sections.length === 0) return;

    if (reduced) {
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const i = sections.indexOf(entry.target as HTMLElement);
            if (i === -1) continue;
            // Hard cut: land on the composed target state for whichever
            // beats are behind us, no tween — beat 1 "Ink" is index 1,
            // beat 2 "The rise" is index 2, beat 3 "Sight" is index 3,
            // beat 4 "Trust" is index 4, beat 5 "The world turns" is index 5,
            // beat 6 "The swap" is index 6. Sight/Trust's "active" flags are
            // scoped to their own section only — composed stills, not
            // lingering state once scrolled past.
            sceneProgress.inkT = i >= 1 ? 1 : 0;
            sceneProgress.riseT = i >= 2 ? 1 : 0;
            sceneProgress.sightT = i >= 3 ? 1 : 0;
            sceneProgress.sightActive = i === 3;
            sceneProgress.trustT = i >= 4 ? 1 : 0;
            sceneProgress.trustActive = i === 4;
            sceneProgress.clockT = i >= 5 ? 1 : 0;
            // Raw and re-windowed clocks land on the same hard cut here —
            // there's no scrub to re-window (see i === 4 below).
            sceneProgress.worldP = sceneProgress.clockT;
            setScrub(sceneProgress.clockT);
            sceneProgress.worldActive = i === 5;
            sceneProgress.swapT = i >= 6 ? 1 : 0;
            // >=7 (not >=6): keyframe 6 is still the overhead hold, same FOV-
            // overshoot risk as earlier beats — the table only clears to fully
            // visible once the camera has actually pulled back to keyframe 7.
            sceneProgress.kitT = i >= 7 ? 1 : 0;
            setT(i / segments);
          }
        },
        { threshold: 0.5 },
      );
      sections.forEach((section) => observer.observe(section));
      return () => {
        sceneProgress.live = false;
        observer.disconnect();
        clearCopy();
      };
    }

    // Issue 1 fix (measurement path): every pin created below runs while the loader's
    // html[data-gg-loading] { overflow: hidden } (index.html) is still in force —
    // SceneRenderer's first frame, the loader's last milestone, comes from a component
    // that mounts and renders AFTER this effect, and the loader itself still holds the
    // lock for HOLD_MS + EXIT_MS past that. GSAP measures pin geometry synchronously
    // inside ScrollTrigger.create(), so every pin below is measured against a document
    // that isn't scrollable yet. One forced re-measure the instant the lock lifts:
    // ScrollTrigger.refresh() maps to _refreshAll(true), which is immune to the
    // _lastScrollTime deferral a resize-driven refresh is not (see the nine-issue fix
    // plan §1 for why a resize event is the weaker, swallowable call). Fires at most once
    // — disconnects itself the moment it fires, and the effect cleanup below disconnects
    // it too in case the component unmounts first, so it can neither double-fire nor leak.
    let loaderObserver: MutationObserver | null = null;
    if (document.documentElement.hasAttribute('data-gg-loading')) {
      loaderObserver = new MutationObserver(() => {
        if (document.documentElement.hasAttribute('data-gg-loading')) return;
        loaderObserver?.disconnect();
        loaderObserver = null;
        ScrollTrigger.refresh();
      });
      loaderObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-gg-loading'] });
    }

    const lenis = new Lenis({ smoothWheel: true, anchors: true });
    // Issue 2 finding, confirmed by reading node_modules/lenis/dist/lenis.mjs: external
    // scrolls (keyboard, scrollbar drag) do NOT bypass Lenis. onNativeScroll
    // (lenis.mjs:651-674) adopts any scroll it didn't originate (isScrolling false or
    // 'native'), sets animatedScroll = targetScroll = actualScroll, recomputes
    // velocity/direction, and calls this.emit() (lenis.mjs:667) — which fires the
    // 'scroll' event onLenisScroll below forwards to ScrollTrigger.update(). Measured
    // live: a real PageDown ×3 sequence and the equivalent window.scrollTo(0, y) landed on
    // identical pin/copy state. Nothing to fix here, and no "resync on native scroll"
    // listener should be added — it would duplicate onNativeScroll and fight its own
    // _resetVelocityTimeout (lenis.mjs:668-673).
    // Landmine: do NOT set autoToggle here. autoToggle makes the constructor call
    // checkOverflow() (lenis.mjs:484-487), which calls internalStop() the instant it sees
    // the loader's html[data-gg-loading] overflow:hidden — Lenis would come up
    // permanently stopped and wheel input would be preventDefault-ed and dropped
    // (lenis.mjs:613-616) forever after. If this bug is ever reported again for real,
    // capture window.__lenis.isStopped / isScrolling while scrollY changes — isStopped
    // true, or isScrolling stuck false while scrollY moves, is the real signature and
    // reopens this with an actual cause.
    if (import.meta.env.DEV) {
      // @ts-expect-error dev-only QA hook; tree-shaken from the production build (Vite
      // dead-code-eliminates the whole `if` under import.meta.env.DEV === false).
      window.__lenis = lenis;
    }
    const onLenisScroll = () => ScrollTrigger.update();
    lenis.on('scroll', onLenisScroll);
    const onTick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(onTick);
    gsap.ticker.lagSmoothing(0);

    // Sync copy to the actual (likely all-zero) scroll position now that the
    // scene is live — otherwise every beat below the fold would sit at
    // useBeatCopy's pre-scene default (--copy-v:1, fully visible) until the
    // user scrolls far enough to trigger that beat's own onUpdate.
    updateCopy();

    // A section's copy is scroll-gated iff it has a `.copy-scrub` wrapper
    // (the hero and the door don't — see COPY_OWN).
    const gated = copyEls.map((el) => el !== null);
    // F3 fix round: every pin used to run with default `pinSpacing`, so each
    // spacer was `sectionHeight + pinDuration` = 2vh tall while its trigger
    // owned only the first half — 8 × 1vh of page that belonged to no
    // trigger at all, rendered zero frames under frameloop="demand", and
    // added up to 52.9% of the whole scroll. Collapsing a spacer makes the
    // NEXT section slide up over the pinned one instead of after it, which
    // is only invisible (and so only safe) when both sections' copy is
    // scroll-gated: the incoming copy sits at --copy-v 0 until its own pin
    // starts, and the outgoing copy now fades out on its own pin's tail
    // (sceneProgress.ts's EXIT_* window) instead of popping when the pin
    // releases. The hero and the door are never hidden, so they'd slide
    // their live H1/CTA straight across the pinned beat behind them — the
    // pins on either side of those two keep their spacer and hand off by
    // scrolling, exactly as before. The gaps that survive get a lead
    // trigger (below) so they still drive the camera.
    const keepSpacer = sections.map((_, i) => !(gated[i] && gated[i + 1]));
    // Segment i (keyframe i → i+1) is scrubbed by the pin on section i+1.
    // It gets a lead-in whenever the scroll immediately before that pin
    // isn't already owned by another pin: segment 0's lead is the whisper
    // pin itself, and later segments have one only where section i kept its
    // spacer and therefore still has a 1vh gap after it.
    const hasLead = (i: number) => i === 0 || keepSpacer[i];

    // Section 0 ("whisper") has no picture of its own — the camera used to
    // just hold at keyframe 0 here — but it still needs a pin. Every
    // section is `min-height: 100svh` in normal flow; left unpinned,
    // section 1's box starts peeking up from the bottom of the viewport as
    // soon as you've scrolled past (sectionHeight - viewportHeight), long
    // before whisper's own 100vh has scrolled by — its headline visibly
    // bleeds backward into what should still read as a held, ~empty void.
    // Pinning holds section 0 fixed at the top of the viewport for its own
    // full scroll allocation, same as every other beat, so section 1 can't
    // enter the frame until whisper's pin actually releases.
    // F2 fix round: that pin had no `scrub` and no `onUpdate`, so 1vh of
    // scroll — the first 8-9 wheel ticks a first-time visitor spends
    // testing whether the page responds at all — drove nothing, wrote no
    // progress, and rendered not one frame. It now owns LEAD_SHARE of
    // segment 0 (the long descent from keyframe 0's y=40 void toward
    // keyframe 1), so wheel tick one moves the camera, plus its own copy's
    // exit. Beat 1's pin picks the segment up from exactly where this
    // leaves it (`tStart` below), so keyframe 1 still lands precisely at
    // the end of the ink pin.
    const whisperTrigger = sections[0]
      ? ScrollTrigger.create({
          trigger: sections[0],
          start: 'top top',
          end: '+=100%',
          pin: true,
          pinSpacing: keepSpacer[0],
          scrub: true,
          onUpdate: (self) => {
            // Mildly front-loaded, unlike the gap leads below, and for a
            // perceptual reason rather than a compositional one: segment 0
            // is a 27-world-unit descent out of a y=40 void onto a map
            // that's a ~13%-of-frame speck up there, so a LINEAR share of it
            // grows the subject only ~5% on wheel tick one — a real frame,
            // but close enough to "nothing happened" to be worth biasing.
            // p*(3-p)/2 is the halfway blend between linear and a full
            // ease-out: ~8% on tick one, and it still crosses into beat 1's
            // pin at half speed rather than the dead stop a full ease-out
            // would hand off at. Same endpoint either way (LEAD_SHARE of the
            // segment), so this only shapes the opening — it's the knob if
            // the void reads too eager or too dead.
            const eased = (self.progress * (3 - self.progress)) / 2;
            setT((LEAD_SHARE * eased) / segments);
            rawP[0] = self.progress;
            updateCopy();
          },
        })
      : null;

    // Trigger i pins sections[i + 1] (section 0, "whisper", is pinned above,
    // where it also leads segment 0) and scrubs the camera to keyframe
    // i + 1 — so the pin for e.g. the "sight" section always finishes
    // with the camera *at* sight's own keyframe, and that section's own
    // progress var rides the same range. The previous version pinned
    // section i while scrubbing keyframe i→i+1, which drove each beat's
    // reveal (torches igniting, the token walking, the table fading in)
    // during the *previous* section's pin — walls were already rising
    // during "Ink", the table was already lit during "the swap", etc.
    // 0 = ink, 1 = the rise, 2 = sight, 3 = trust, 4 = the world turns,
    // 5 = the swap, 6 = the kit.
    const pinSections = sections.slice(1);
    const triggers = pinSections.map((section, i) => {
      // Camera t this pin starts from: its own segment's keyframe, unless a
      // lead (the whisper pin for segment 0, a gap trigger below otherwise)
      // already scrubbed the segment's first LEAD_SHARE during the handoff
      // before it. tEnd is always the segment's far keyframe — the pin
      // finishes on it either way.
      const tStart = (i + (hasLead(i) ? LEAD_SHARE : 0)) / segments;
      const tEnd = (i + 1) / segments;
      return ScrollTrigger.create({
        trigger: section,
        start: 'top top',
        end: '+=100%',
        pin: true,
        pinSpacing: keepSpacer[i + 1],
        scrub: true,
        onUpdate: (self) => {
          setT(tStart + (tEnd - tStart) * self.progress);
          rawP[i + 1] = self.progress;
          if (i === 0) sceneProgress.inkT = self.progress;
          if (i === 1) sceneProgress.riseT = self.progress;
          if (i === 2) sceneProgress.sightT = self.progress;
          if (i === 3) {
            sceneProgress.trustT = self.progress;
            // Y4 fix round: was cleared as a hard cut on this pin's own
            // onEnter (progress===0), which vanished the walking token +
            // sight wedge in one frame right as beat 4 started. Riding
            // progress instead eases it out over the pin's own first 20% —
            // same envelope pattern the trust system already uses elsewhere
            // — by which point SightSweep's own opacity factor (see that
            // file) has it fully faded and trustT-driven pane machinery has
            // taken over the frame.
            sceneProgress.sightActive = self.progress < 0.2;
          }
          if (i === 4) {
            // F1 fix round: clockT WAS this pin's raw progress, so the day
            // started at the top of the pin — but the pin's first 20% is
            // spent closing beat 4's dual-pane split over the frame, the
            // clock widget only finishes fading in at the end of that (both
            // ride trustGlow, SceneRenderer.tsx), and this beat's headline
            // isn't legible until a little after. Dawn through noon
            // therefore played behind a closing split on a screen with no
            // headline on it — the reported "the clock starts at midday".
            // The raw progress now lives in worldP (the split close, the
            // widget reveal and this beat's own copy fade all read that),
            // and the visible day is re-windowed onto the readable
            // remainder — same remap shape swapT uses below. Net effect:
            // the widget appears with its thumb still at dawn and the whole
            // dawn→23:40 sweep, floor grade included, plays on a screen the
            // viewer can actually read.
            sceneProgress.worldP = self.progress;
            sceneProgress.clockT = THREE.MathUtils.clamp((self.progress - 0.3) / 0.7, 0, 1);
            setScrub(sceneProgress.clockT);
            // N1 fix round: releasing trustActive partway through THIS pin
            // (progress<0.5) let beat 5's own scrub render as a dual-pane
            // split for its first half, then hard-cut to single-pane
            // mid-scrub — a visible seam right under "Night falls on
            // schedule". trustActive now flips off the instant this pin
            // STARTS (onEnter, below) and back on when it's left backward
            // (onLeaveBack, below) — beat 4's own pin (i===3) still owns
            // turning it on going forward.
          }
          // Swap-in-place finishes early in its own pin (camera is still
          // near-overhead through ~0.45 thanks to the duplicated 5/6
          // keyframe) so it reads as complete before beat 7's pull-back.
          if (i === 5) sceneProgress.swapT = THREE.MathUtils.clamp(self.progress / 0.45, 0, 1);
          // The *next* trigger (i === 6, pinned on the "kit" section itself,
          // scrubbing keyframe 6 → 7 — overhead hold to war-table pull-back)
          // is what should fade TableScene's props in, not the swap's own
          // pin (see sceneProgress.ts's kitT doc comment).
          if (i === 6) sceneProgress.kitT = self.progress;
          updateCopy();
        },
        onEnter: () => {
          if (i === 2) sceneProgress.sightActive = true;
          if (i === 3) sceneProgress.trustActive = true;
          if (i === 4) sceneProgress.worldActive = true;
          // N1 fix round: the split now dies exactly as beat 5's own pin
          // starts, not partway through its scrub (see onUpdate's comment).
          if (i === 4) sceneProgress.trustActive = false;
          // C5 fix round: sight's copy holds until the NEXT beat's own
          // progress passes 50% (same contract every other beat's copy has),
          // so sightActive can't clear here either — copy would outlive it.
          // Y4 fix round: sightActive itself no longer clears here at all —
          // this pin's own onUpdate (i===3) now eases it out over the first
          // 20% of progress instead of a hard cut right at entry.
          invalidate();
        },
        onEnterBack: () => {
          if (i === 2) sceneProgress.sightActive = true;
          if (i === 3) sceneProgress.trustActive = true;
          if (i === 4) sceneProgress.worldActive = true;
          invalidate();
        },
        onLeave: () => {
          // C5 fix round: NOT cleared here anymore — see onEnter's (i===3)
          // comment above; same "own onLeave outlives the copy" bug trustActive
          // already had (see F2 below), same fix.
          // F2: NOT cleared here — clearing on trust's own onLeave killed the
          // dual-pane split while the trust headline was still fading out
          // over it (the copy holds until clockT>0.5, well after this pin
          // ends). The world pin (i===4 onUpdate, above) now owns releasing
          // trustActive partway through its own scrub instead.
          if (i === 4) sceneProgress.worldActive = false;
          invalidate();
        },
        onLeaveBack: () => {
          if (i === 2) sceneProgress.sightActive = false;
          if (i === 3) sceneProgress.trustActive = false;
          if (i === 4) sceneProgress.worldActive = false;
          // N1 fix round: re-arm the split scrolling back up out of beat 5,
          // symmetric with onEnter above clearing it going forward.
          if (i === 4) sceneProgress.trustActive = true;
          // C5 fix round: re-arm sight's copy scrolling back up out of trust,
          // symmetric with onEnter's (i===3) clear going forward.
          if (i === 3) sceneProgress.sightActive = true;
          invalidate();
        },
      });
    });

    // The pins that had to keep their spacer (see `keepSpacer`) still hand
    // off across 1vh of scroll that belongs to no pin — three of them, after
    // ink, after the hero and after the kit; the door's trailing half is the
    // final resting viewport, past max scroll, and needs nothing. A non-pinning
    // scrub over exactly that gap keeps the camera alive through it: the
    // incoming section's top travels from the viewport bottom to the
    // viewport top over precisely the spacer's unowned second half, so
    // `top bottom` → `top top` on that section IS the gap, measured rather
    // than hard-coded. It hands the camera the first LEAD_SHARE of the
    // segment the incoming pin is about to finish. Deliberately camera-only:
    // the beat's own picture var still starts at 0 on its own pin, so the
    // reveal-timing contract documented above (no beat's reveal plays during
    // someone else's scroll) is untouched — all that moves earlier is the
    // travel between keyframes, which is what a handoff should be doing.
    const leadTriggers: ScrollTrigger[] = [];
    for (let i = 1; i < segments; i++) {
      const section = sections[i + 1];
      if (!hasLead(i) || !section) continue;
      leadTriggers.push(
        ScrollTrigger.create({
          trigger: section,
          start: 'top bottom',
          end: 'top top',
          scrub: true,
          onUpdate: (self) => setT((i + LEAD_SHARE * self.progress) / segments),
        }),
      );
    }

    return () => {
      sceneProgress.live = false;
      loaderObserver?.disconnect();
      whisperTrigger?.kill();
      triggers.forEach((trigger) => trigger.kill());
      leadTriggers.forEach((trigger) => trigger.kill());
      gsap.ticker.remove(onTick);
      lenis.off('scroll', onLenisScroll);
      lenis.destroy();
      if (import.meta.env.DEV) {
        // @ts-expect-error dev-only QA hook — see the mount-time guard above.
        delete window.__lenis;
      }
      clearCopy();
    };
  }, []);

  useFrame(() => {
    if (!target.current.dirty) return;
    const { position, quaternion, fov } = sampleCamera(target.current.t);
    camera.position.copy(position);
    camera.quaternion.copy(quaternion);
    const persp = camera as THREE.PerspectiveCamera;
    if (persp.isPerspectiveCamera) {
      persp.fov = fov;
      persp.updateProjectionMatrix();
    }
    target.current.dirty = false;
  });

  return null;
}
