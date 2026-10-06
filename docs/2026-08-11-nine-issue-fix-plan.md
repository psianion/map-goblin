# Nine-issue fix plan — landing page (`site/`)

Date: 2026-08-11. Planning artifact only; no source was edited to produce it.

Scope: issues 1, 2, 3, 4, 5, 6, 7, 9, 10 from the landing backlog. Issues 8 and 11 are
deliberately out of scope.

Everything below is grounded in the files as they stand today. Where a claim comes from
reading rather than from a measurement, it says so in the text. Live measurements were taken
against the running dev server at `http://localhost:5179` in a foregrounded Chrome tab at
1484×775 CSS px, dpr 1, `document.hidden === false` asserted inside every measuring call.

Prior work that must not regress:

- `docs/2026-08-11-scroll-tick-analysis.md`, `docs/2026-08-11-scroll-fix-verification.md`
- `docs/2026-08-11-loader-verification.md`
- `docs/2026-08-08-background-texture-rescore.md`

---

## 0. Baseline measured today (healthy load)

Taken after a full reload at 1484×775, ~6 s settle:

| Probe | Value |
|---|---|
| `.pin-spacer` count | 9 |
| `main .beat` count | 9 |
| `documentElement.scrollHeight` | 10075 |
| maxScroll | 9300 |
| `window.__lenis.isStopped` | `false` |
| `window.__lenis.limit` | 9300 |
| `data-gg-loading` present | `false` (loader gone) |
| `.canvas-mount canvas` present | `true` |

So the rig initialises correctly on a healthy load. The issue-1 flake did not reproduce in
this session — see §1.

---

## 1. Scroll-rig init flake — the rig sometimes never initialises

### What is provable by reading

**Fact A — pin spacers are created synchronously inside `ScrollTrigger.create()`, not at
refresh time.** `node_modules/gsap/ScrollTrigger.js:1182-1209`: inside the trigger's `init`,
`pinCache.spacer = _doc.createElement('div')`, `spacer.classList.add('pin-spacer')`
(line 1193), then `_swapPinIn(pin, spacer, cs)` (line 1209), which inserts the spacer into
the DOM at `ScrollTrigger.js:667-668`. There is no deferral on that path.

Consequence, and this is the single most useful diagnostic in this whole document:

> `document.querySelectorAll('.pin-spacer').length === 0` cannot mean "the triggers exist but
> were never measured". It can only mean **`ScrollTrigger.create()` was never called**.

Which narrows the failure to three places in `site/src/scene/ScrollCamera.tsx`:

1. the effect never ran because the component never mounted;
2. the effect returned at `ScrollCamera.tsx:124` (`sections.length === 0`);
3. the effect took the reduced-motion branch at `ScrollCamera.tsx:126-168` (no pins there).

**Fact B — the mount path is gated on an idle callback with no timeout.**
`site/src/components/Hero.tsx:42-43`:

```ts
const idleId =
  typeof requestIdleCallback === 'function' ? requestIdleCallback(decide) : window.setTimeout(decide, 0);
```

`requestIdleCallback` is called with **no `{ timeout }` option**. Nothing else can mount
`Canvas3D` — `use3D` stays `null` and `Hero` returns `null` (`Hero.tsx:54`). The only other
caller of `decide` is `mq.addEventListener('change', decide)` (`Hero.tsx:44`), and a
`MediaQueryList` `change` event fires **only when the 900px match state flips** — a synthetic
`window.dispatchEvent(new Event('resize'))` does not fire it, and neither does a real resize
that stays on one side of 900px.

Meanwhile the newly-added loader runs an unbroken `requestAnimationFrame` chain for up to
`CAP_MS = 12000` ms (`site/index.html:391-392`, `612-647`), and each of those frames does
`getPointAtLength` on a live SVG path (`index.html:479`), ~20 attribute writes, and several
custom-property writes on `<html>` (`index.html:461`, `502`, `505`). On a cold load that runs
concurrently with the ~1 MB `Canvas3D` chunk download and parse and with font loading. An
idle callback with no timeout is only serviced when a frame has budget left over; a page that
paints every frame and blocks on script can starve it.

That is a real defect regardless of whether it is *the* cause of the reported flake, and the
fix is one argument.

**Fact C — the ScrollTriggers are always created while the loader still owns the scroll.**
Ordering, all from source:

- `markLoad('frame')` — the loader's last milestone — is emitted from `SceneRenderer`, i.e.
  after `ScrollCamera`'s effect has already run.
- After the last milestone the loader still runs `HOLD_MS = 220` plus `EXIT_MS = 1120`
  (`index.html:393`) before `clear()` (`index.html:548-574`) removes `data-gg-loading`.

So on every single load, `ScrollTrigger.create()` at `ScrollCamera.tsx:231` and `279` runs
while `html[data-gg-loading] { overflow: hidden; scrollbar-gutter: stable }`
(`index.html:51-54`) is in force, and **nothing ever calls `ScrollTrigger.refresh()` after the
lock is released**. The geometry usually survives because `scrollbar-gutter: stable` reserves
exactly the width the real scrollbar later takes, so no width changes — but the measurement is
taken against a document that is not yet scrollable, and there is no re-measure afterwards.

**Fact D — `clear()` calls `window.scrollTo(0, 0)` (`index.html:573`) after the triggers
exist.** If that produces a scroll event (it does whenever the browser restored a non-zero
position before `history.scrollRestoration = 'manual'` at `index.html:581` took effect), it
sets GSAP's `_lastScrollTime` (`ScrollTrigger.js:388`). Any **non-forced** `_refreshAll` after
that early-returns and waits for a `scrollEnd` (`ScrollTrigger.js:484-488`), and `scrollEnd` is
only dispatched from inside `_updateAll` at least 200 ms later (`ScrollTrigger.js:590-593`),
which itself only runs when another scroll arrives. On a just-loaded page sitting still, that
deferral can hold indefinitely. This is why the fix below must use `ScrollTrigger.refresh()`
and not a resize event: `ScrollTrigger.refresh()` routes to `_refreshAll(true)`
(`ScrollTrigger.js:2257`), which is **forced** and skips the `_lastScrollTime` guard;
`window.dispatchEvent(new Event('resize'))` routes to `_onResize` → `_resizeDelay` →
`_refreshAll()` **unforced** (`ScrollTrigger.js:397`, `2135`), which is exactly the call that
can be swallowed.

**Hypothesis, stated as such.** I could not reproduce the flake in this session (baseline in
§0 was healthy on the first try, 9 spacers). Fact B is the only mechanism I found that
produces *zero* pin spacers, and it is consistent with "a visitor hits a dead page". Fact C/D
produce a *mis-measured* rig, not a zero-spacer rig — a different, also-real failure that a
resize genuinely does repair. The reported symptom is stated as zero spacers, so Fact B is the
primary suspect and Fact C/D the secondary; the fix closes both, and the discriminator below
settles it the next time it happens.

**Hypotheses checked and rejected** (record them so nobody re-walks them):

- *Lenis is stopped by the loader's `overflow: hidden`.* Rejected. Lenis's `checkOverflow()`
  (`node_modules/lenis/dist/lenis.mjs:525-528`), which would call `internalStop()` on an
  `overflow: hidden` root, runs **only when `autoToggle: true`** (`lenis.mjs:484-487`).
  `ScrollCamera.tsx:170` does not set it. **Landmine to record:** if anyone ever adds
  `autoToggle: true`, the loader will permanently stop Lenis and wheel input will be
  `preventDefault`-ed and dropped (`lenis.mjs:613-616`).
- *Font loading blocks init.* Rejected — the loader consumes `document.fonts.ready`
  (`index.html:405-407`) but nothing in the mount path awaits fonts.
- *`sections.length === 0`.* Unlikely: the nine `.beat` sections are prerendered into
  `dist/index.html:370` and measured 9 in the live DOM.

### Fix

**Primary (mount path), `site/src/components/Hero.tsx`:** give the idle callback the timeout
it should always have had — `requestIdleCallback(decide, { timeout: 1500 })`. This is the
documented purpose of the option: it converts "run when convenient" into "run when convenient,
but never later than 1500 ms". One argument, no new code paths, and it makes the 3D decision
deterministic under exactly the main-thread pressure the loader creates.

**Primary (measurement path), `site/src/scene/ScrollCamera.tsx`:** after the triggers are
created, re-measure once when the loader actually hands back the scroll. Not a timer, not a
synthetic event — observe the state change that genuinely alters the document's scroll
geometry:

```ts
// The loader (index.html) holds html[data-gg-loading] { overflow:hidden } for its whole
// life, and every pin below is created while that lock is on — the loader's last milestone
// comes from SceneRenderer's first frame, i.e. after this effect. One forced re-measure at
// the moment the lock is released. ScrollTrigger.refresh() maps to _refreshAll(true), which
// is immune to the _lastScrollTime deferral that a resize-driven refresh is not.
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
```

Disconnect it in the existing cleanup at `ScrollCamera.tsx:420-429`. This is deterministic, it
fires exactly once, and it is a correct API call at a correct moment — not a band-aid.

**Explicitly not proposed:** `setTimeout` + `dispatchEvent(new Event('resize'))`. Beyond being
a band-aid, Fact D shows it is the *weaker* call — an unforced refresh that GSAP is entitled to
swallow.

### Files touched

`site/src/components/Hero.tsx`, `site/src/scene/ScrollCamera.tsx`.

### Acceptance test

1. **Deterministic mount.** Hard-reload with CPU throttling 6× and network throttled to
   Fast 3G, ten consecutive loads. After each, evaluate in one call:
   `[document.hidden, !!document.querySelector('.canvas-mount canvas'), document.querySelectorAll('.pin-spacer').length, document.documentElement.scrollHeight]`.
   Required: `document.hidden === false`, canvas `true`, spacers `9`, scrollHeight within ±2%
   of the unthrottled value, **10 / 10**. Zero loads may require any interaction to reach that
   state.
2. **Idle-timeout proof.** With the same throttling, log
   `performance.now()` at the top of `decide()` (temporary instrumentation, removed before
   ship) across ten loads. Required: max ≤ 1600 ms. Before the fix, record the same number —
   the plan is only settled if at least one pre-fix load exceeds 3000 ms or never fires.
3. **Post-loader re-measure is a no-op on a healthy load.** Capture
   `documentElement.scrollHeight` immediately before and 100 ms after `data-gg-loading` is
   removed. Required: identical (the `scrollbar-gutter: stable` contract). A non-zero delta
   here means the loader's gutter and the real scrollbar disagree, and *that* is the bug to
   fix instead.
4. **Discriminator for the next sighting.** If a dead page is ever caught again, capture in
   one call: `{canvas: !!document.querySelector('.canvas-mount canvas'), spacers: document.querySelectorAll('.pin-spacer').length, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, beats: document.querySelectorAll('main .beat').length}`.
   `canvas:false` ⇒ mount path (Fact B). `canvas:true, spacers:0` ⇒ reduced-motion branch or
   zero beats. `canvas:true, spacers:9` but frozen ⇒ measurement path (Fact C/D).

---

## 2. External scrolls bypass Lenis

### Finding: **not reproducible as reported.** The premise is false for lenis 1.3.26.

`node_modules/lenis/dist/lenis.mjs:651-674`, `onNativeScroll`: when `isScrolling` is `false`
or `'native'` — i.e. any scroll Lenis did not originate — it adopts it
(`this.animatedScroll = this.targetScroll = this.actualScroll`), recomputes velocity and
direction, and **calls `this.emit()` (line 667)**, which fires the `'scroll'` event that
`ScrollCamera.tsx:173-174` already forwards to `ScrollTrigger.update()`. The listener is
registered in the constructor at `lenis.mjs:475`.

Measured live, dev server, 1484×775, `document.hidden === false` in the same call:

| Input | Result |
|---|---|
| `window.scrollTo(0, 4200)` (programmatic/instant — the scrollbar-drag path) | `scrollY 4200`, `lenis.animatedScroll 4200`, pinned section index moved `0 → 3`, `--copy-v` set advanced from `1\|0\|0\|0\|0\|0\|0` to `0\|0\|1\|0\|0\|0\|0` |
| Real `PageDown` ×3 via OS-level key events | `scrollY 0 → 2034` over 12 native scroll events; `lenis.isScrolling === 'native'` throughout with `animatedScroll` tracking `scrollY` exactly at every sample; end state identical to `window.scrollTo(0, 2034)` (verified by round-trip: `2034 → 0 → 2034` produced identical pin/copy state) |

So keyboard scrolling works and drives the scene, and scrollbar drag takes the same code path
(continuous native scroll events). No accessibility failure was found.

### Specified action: **verify and close; change nothing.**

Adding a "re-sync Lenis on native scroll" listener would duplicate `onNativeScroll` and risk a
feedback loop with the `_resetVelocityTimeout` at `lenis.mjs:668-673`. `syncTouch` is a
touch-only option and is irrelevant to keyboard or scrollbar. The correct output of this issue
is a regression test plus the landmine record.

Two things to write down rather than fix:

- Keyboard and scrollbar scrolls run **unsmoothed** — Lenis adopts the position rather than
  easing to it. That is Lenis's design and matches native expectation; do not "fix" it.
- The `autoToggle` landmine from §1 lives here too: `autoToggle: true` would make the loader's
  `overflow: hidden` permanently stop Lenis, and *that* would produce exactly the reported
  symptom. If the reporter can reproduce, capture `window.__lenis.isStopped` and
  `window.__lenis.isScrolling` while `scrollY` changes; `isStopped === true`, or `isScrolling`
  staying `false` while `scrollY` moves, re-opens this issue with a real cause.

### Files touched

None. (If the builder disagrees after re-testing, any change lands in `ScrollCamera.tsx`,
which scope A already owns.)

### Acceptance test

At 1484×775, from `scrollY = 0`, in one measuring call each:

1. Real `PageDown` ×3 (OS key events, not synthetic `KeyboardEvent`). Required:
   `scrollY > 1900`, `window.__lenis.animatedScroll === scrollY` (±2), and the pinned-section
   index / `--copy-v` vector identical to the same `scrollY` reached by `window.scrollTo`.
2. `End` then `Home`. Required: `scrollY` reaches maxScroll then 0, and the `--copy-v` vector
   at each end matches the `window.scrollTo` equivalent exactly.
3. Scrollbar drag from top to ~60% via a real `left_click_drag` on the scrollbar track.
   Required: same equality as (1) at the landing position.
4. All three repeated at dpr 1.25.

---

## 3. Aspect < 1.6 clips the beat-4 plan

### Root cause, confirmed

`site/src/scene/cameraPath.ts:67` — keyframe 4 is `{ position: [8, 36, 3.5], fov: 34 }`, and
the comment at `cameraPath.ts:58-66` states the height was solved for aspect 1.6 exactly:

```
half-pane world width = ((aspect*h - GAP_PX)/2)/h * 2*y*tan(fov/2)
```

with `GAP_PX = 56` (`site/src/scene/SceneRenderer.tsx:28`), `h` = canvas CSS pixel height, and
a requirement of ≥ 16.5 world units (plan spans x = 0..16 plus margin). Substituting
aspect 1.6, h 800, fov 34 gives y ≥ 35.28 — which is where their "y ≈ 35.3; 36 keeps a hair of
margin" came from. Below aspect 1.6 the term falls linearly and the outer walls of both rooms
clip out of the half-pane crop.

### Validation of the prior reviewer's proposal

The proposal was a per-frame `max(1, 1.6/aspect)` height scale on keyframe 4.

**The number is adequate.** Solving the closed form
`y_needed = 16.5 / ((aspect − GAP_PX/h) · tan(fov/2))` against `36 · max(1, 1.6/aspect)`:

| aspect | h | y needed | reviewer's y | verdict |
|---|---|---|---|---|
| 1.60 | 800 | 35.3 | 36.0 | ok |
| 1.40 | 900 | 40.4 | 41.1 | ok |
| 1.20 | 1000 | 47.2 | 48.0 | ok |
| 1.05 | 1100 | 54.0 | 54.9 | ok |
| 0.90 | 1200 | 63.9 | 64.0 | ok on width, but see below |

The ratio form under-corrects for the `GAP_PX/h` term, and the base of 36 rather than 35.28
over-corrects by ~2%; the two cancel. Adopt the formula.

**The mechanism as described is wrong and must be replaced.** `sampleCamera`
(`cameraPath.ts:101-111`) reads `positionCurve.getPoint(clamped)` from a
`THREE.CatmullRomCurve3` built once at module scope from all nine keyframe positions
(`cameraPath.ts:85`). A per-frame scale applied to the **sampled** y would lift the entire
path — every beat, including the beats 7/8 oblique framings whose `lookAt` targets are tuned
against a fixed height. The scale has to be applied to **keyframe 4's position before the
curve is built**, and the curve rebuilt when the aspect changes.

**Two further corrections the proposal did not carry:**

- *A clamp.* `Hero.tsx` gates 3D on viewport **width** ≥ 900px only, so a 900×1200 window
  reaches the 3D scene at aspect 0.75 and the formula asks for y ≈ 77 — a spike from
  keyframe 3's y=15 to 77 and back to keyframe 5's y=22, which deforms segments 3→4 and 4→5
  into a violent vertical lunge. Clamp to `[36, 56]` (aspect ≈ 1.02 is the break-even) and
  accept clipping below that with a `ponytail:` comment naming the ceiling.
- *A resize hook.* `ScrollCamera`'s `useFrame` (`ScrollCamera.tsx:432-443`) only re-samples
  when `target.current.dirty`, and `dirty` is set only by `setT` (`ScrollCamera.tsx:117-121`).
  A window resize would therefore not apply the new height until the next scroll tick. The
  effect needs a `resize` listener that sets `dirty` and calls `invalidate()`.

**Alternative considered and rejected:** widen keyframe 4's `fov` instead of raising it
(world width ∝ `2·y·tan(fov/2)`, so either lever works, and `fov` is lerped per-sample at
`cameraPath.ts:109` so no curve rebuild would be needed). Rejected because `cameraPath.ts:9-15`
makes "beats 2–6 stay true-nadir AND tight, telephoto-narrow — flattening perspective toward
the board's flat orthographic read" a contract; going from 34° to ~40° at aspect 1.35 fights
it. Raising the height preserves the telephoto read. Also rejected: shrinking `GAP_PX` at
narrow aspects — the gap is a fixed design element and `SceneRenderer` derives the DOM divider
width from it (`SceneRenderer.tsx:309`).

### Fix

`site/src/scene/cameraPath.ts`: export `setPathAspect(aspect: number, canvasHeightPx: number)`
(or fold the arguments into `sampleCamera`) that recomputes keyframe 4's y, rebuilds
`positionCurve` when the value changes by more than a small epsilon, and memoises. Keep
`CAMERA_KEYFRAMES[4].position[1] = 36` as the wide-aspect base so nothing changes at
aspect ≥ 1.6. `site/src/scene/ScrollCamera.tsx`: call it on mount and on `resize`, then mark
`dirty` and `invalidate()`.

### Files touched

`site/src/scene/cameraPath.ts`, `site/src/scene/ScrollCamera.tsx`.

### Acceptance test

At each of 1600×1000 (aspect 1.60), 1400×1000 (1.40), 1200×1000 (1.20), 1100×1050 (1.05),
scroll to the beat-4 pin at progress 1.0 (`trustGlow` at maximum, split fully open) and
screenshot:

- Both rooms' outer walls (world x = 0 and x = 16) must be inside each half-pane, with ≥ 8 px
  of floor/table visible outside each outer wall at every aspect. Measured by locating the
  outermost wall edge in the PNG.
- At aspect 1.60 the frame must be **pixel-identical** to the pre-change build (same seed, same
  scroll position) — the wide path is untouched.
- Camera-path smoothness: sample `camera.position.y` at 60 evenly-spaced `t` across segments
  3→4→5 at aspect 1.20 and assert the maximum frame-to-frame delta is under 3 world units, so
  the correction reads as a taller framing and not a lunge.
- Repeat the 1200×1000 case at dpr 1.25 — `GAP_PX` is multiplied by dpr in
  `SceneRenderer.tsx:309` and `337`, so the crop arithmetic is dpr-sensitive.

---

## 4. The lamp isn't in the world

### Root cause, confirmed by arithmetic

The table's baked "lamp" is a canvas-space radial in
`site/src/scene/textures.ts:448-456` (`paintTableWoodRadial`):

```ts
const cx = size * 0.26;
const cy = size * 0.12;
const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 1.05);
```

The texture is applied un-tiled across the whole table plane
(`textures.ts:462-466`), which is `PlaneGeometry(120, 64)` rotated to horizontal at world
`[8, -0.18, 3.5]` (`site/src/scene/TableScene.tsx:132-134`, `365`).

Mapping UV → world: `u = 0.26` → world x = `−60 + 0.26·120 + 8 = −20.8`. With `flipY` the
canvas `cy = 0.12` is texture `v = 0.88` → world z = `3.5 − (0.88 − 0.5)·64 = −20.8`.

**Pool centre = world (−20.8, −20.8). Distance from the map centre (8, 3.5) = 37.7 world
units** — matching the rescore doc's "~38 units off-stage" exactly.

The falloff radius is worse than the offset. `size * 1.05` in canvas space is 1.05 of the
texture's full extent, which stretches to **126 world units in x and 67 in z**. Everything the
camera ever frames sits inside the first few percent of that ramp, which is why the total
modulation across the framed area measured only ~12.6/255.

So the "lit table" a viewer actually perceives is entirely
`site/src/styles/global.css:102-129`'s `.stage-lamp` — a `position: fixed; inset: 0` DOM
radial at `26% 12%` of the **viewport**, which by construction cannot parallax, cannot be
occluded, and lands in the same screen corner at every beat.

Two more bakes hard-code the same off-stage lamp position and would drift if only the wood
texture were fixed:

- `textures.ts:838-846` — the sheet's warm 2px "paper thickness" strip on "the lamp-facing
  edges (canvas left = world −x, canvas top = world −z — the table lamp bakes at canvas
  (0.26, 0.12))".
- `textures.ts:854-896` — `getSheetShadowTexture`'s directional cast, weighted 0.08 on the
  lamp-facing rims and 1.0 on the far ones, from the same assumed corner.

### Fix

Introduce a single `LAMP_WORLD` constant (world x/z plus a world-unit falloff radius) and
derive every bake from it. Recommended home: `site/src/scene/textures.ts`, exported, with
`TableScene.tsx` passing the table plane's own centre/size so the UV conversion is done once
in one place rather than re-derived per bake.

**Placement spec (this is the number, not "somewhere plausible").** The composition the page
already commits to — the loader's `#gg-lamp` (`site/index.html:99-110`) and `.stage-lamp`
(`global.css:117-122`) both use `radial-gradient(75% 90% at 26% 12%, …)` — puts the pool at
26% / 12% of the viewport. Place `LAMP_WORLD` so that **at camera keyframe 0 the pool's screen
centroid lands at (26%, 12%) of the frame.** Keyframe 0 is `[4.5, 40, 3.5]`, nadir, fov 44
(`cameraPath.ts:34`), so half-height = `40·tan(22°) = 16.16` world units:

- world z = `3.5 + (0.12 − 0.5)·2·16.16 = −8.8`
- world x = `4.5 + (0.26 − 0.5)·2·16.16·aspect` → **−7.9 at aspect 1.6, −10.4 at aspect 1.92**

Take `LAMP_WORLD = (−9, −8.8)` (the aspect-1.75 midpoint; the pool is soft enough that the
±1.3 units of aspect spread is invisible). That is off the sheet
(sheet spans x −2.5..18.5, z −3..10, `TableScene.tsx:44-46`) and on the wood — physically a
lamp standing beside the table, which is what the composition implies.

**Falloff spec.** Radius must be world-sized, not UV-sized: pick `LAMP_RADIUS` so the map
footprint (x 0..16, z 0..7) sits inside the pool's bright half and the table's far corners
fall off. Start at 30 world units and tune to hit the acceptance number below. Because the
plane is 120×64, the canvas gradient is an **ellipse** — `rx = LAMP_RADIUS/120`,
`ry = LAMP_RADIUS/64` in UV — so that it is circular in world space. The current code's single
`size * 1.05` radius is the bug that makes the pool a flat wash.

**Retire `.stage-lamp`.** Once the pool is in the world, keeping a viewport-pinned copy is two
light stories, which violates the art guide's one-light-source rule and is exactly what this
issue exists to remove. Delete `.stage-lamp` from `global.css:102-129` and the
`<div className="stage-lamp">` from `site/src/App.tsx:107`. Its `--night-t` dimming
(`global.css:128`) is replaced for free: the pool is baked into the table albedo, which the
existing `TABLE_NIGHT_TINT` multiply (`TableScene.tsx:102`) already dims with `clockT`.

**Loader hand-off — this is a cross-scope contract, see §Sequencing.** `index.html:95-98`
states that `#gg-lamp`'s end-of-exit value *is* `.stage-lamp`'s rest value, "and the swap is
invisible". Deleting `.stage-lamp` changes what the loader hands off to: the loader's lamp must
now hand off to the **canvas's own pool at keyframe 0**. That is precisely why the placement
spec above targets 26% / 12% — the two land in the same screen region and the exit crossfade
still reads as one continuous light. `#gg-loader`'s own CSS does not change.

### Files touched

`site/src/scene/textures.ts`, `site/src/scene/TableScene.tsx`, `site/src/styles/global.css`,
`site/src/App.tsx`.

### Acceptance test

1. **The pool exists in the world.** At keyframe 7 (beat "the kit", the widest table shot,
   `cameraPath.ts:79`), sample the rendered frame at the pool centroid and at the four frame
   corners. Required: **peak-to-corner luminance delta ≥ 40/255**, replacing the measured
   12.6/255. Sample from a PNG screenshot with the DOM copy hidden
   (`document.querySelectorAll('.copy-scrub').forEach(e => e.style.opacity = 0)`).
2. **The pool parallaxes.** Screenshot beats 0, 4, and 7. Locate the pool centroid in each as a
   fraction of frame width/height. Required: the centroid moves by **≥ 15% of frame width**
   between beat 0 and beat 7. Today it is fixed at 26% / 12% at every beat by construction; any
   movement at all proves it left the viewport.
3. **Beat-0 hand-off.** Centroid at beat 0 must be within **±6% of frame width and ±6% of
   frame height** of (26%, 12%), at aspect 1.6 and at aspect 1.92.
4. **Night ladder stays coherent.** At beat 5, `clockT = 1`: the pool's peak-to-corner delta
   must fall to ≤ 8/255 (the lamp goes down with the sun, as `global.css:123-127` promised) and
   the frame must contain no warm region brighter than the torch pools — i.e. the torch pools
   remain the brightest thing on screen at full night. Measure the max luminance inside a torch
   pool vs. the max inside the lamp region.
5. **The exit is still seamless.** Capture the frame immediately before `clear()` and 200 ms
   after. Required: no step ≥ 10/255 in the top-left quadrant's mean luminance.
6. **Nine-beat sweep for regressions.** One screenshot per beat before and after; no beat may
   change mean frame luminance by more than 12/255 except beats 0 and 7 (the two the fix is
   supposed to change).

---

## 5. Split unlit/toon value system

### Root cause, confirmed

Two value systems coexist:

- **Unlit** — `MeshBasicMaterial` with `toneMapped: false`, final values baked into canvas
  textures. On-screen value = baked albedo, exactly (PostFX owns the linear→sRGB encode at
  `site/src/scene/PostFX.ts:85`, and renderer tone mapping is deliberately unset,
  `Canvas3D.tsx:42-49`).
- **Toon** — `MeshToonMaterial` with the 4-step ramp from `textures.ts:202-218`:
  `['#3c3c3c', '#828282', '#bebebe', '#ffffff']`, i.e. linear multipliers
  **0.045 / 0.223 / 0.515 / 1.000**. A typical face lands on band 2 or 3, which brackets the
  rescore doc's measured ~0.35× and the ~3× gap.

So the same hex renders ~3× apart depending on which material carries it — which is why a
texture authored against the unlit ladder and dropped on a toon mesh lands ~0.35× dark.

The codebase has already resolved this the same way four separate times, always toward unlit:
the floor and wall faces (`Diorama.tsx:101-117`), the door top and side faces
(`Diorama.tsx:533-580`), the brazier bowl (`Diorama.tsx:237-254`), the table plane
(`TableScene.tsx:61-70`), and the dice and mug (`TableScene.tsx:159-210`). Doctrine is settled;
this issue is finishing the job.

### Inventory — every surviving toon / lit surface

**`site/src/scene/Diorama.tsx`**

| Line | Surface | Day tint | Night tint |
|---|---|---|---|
| 524-529 | door frame parts (jambs / lintel) | `WALL_TINT` | — (opacity only) |
| 1048-1057 | wall caps | `WALL_CAP_TINT` | `CAP_NIGHT_TINT` (IIFE, `:220-224`) |
| 1184 | secret-door wall filler | `WALL_TINT` | — |
| 1480, 1490 | crate stack base + top | `PROP_WOOD_TINT` | `PROP_WOOD_NIGHT_TINT` (literal, `:236`) |
| 1541-1546 | bone shafts | `BONE_TINT` | `BONE_NIGHT_TINT` (IIFE, `:291-295`) |
| 1560 | skull | `BONE_TINT` | `BONE_NIGHT_TINT` |
| 1628 | vault base | `VAULT_BASE_TINT` | `VAULT_BASE_NIGHT_TINT` (IIFE, `:273-277`) |
| 1638 | vault lid | `VAULT_LID_TINT` | `VAULT_LID_NIGHT_TINT` (IIFE, `:280-284`) |

**`site/src/scene/focalAccents.tsx`**

| Line | Surface |
|---|---|
| 168-170 | torch cap material (`MeshToonMaterial` built in a `useMemo`) |
| 181 | torch rim (`material-0`, `rimColor`) |

**`site/src/scene/TableScene.tsx`**

| Line | Surface | Tint | Night |
|---|---|---|---|
| 219 | DM chair (seat + back) | `CHAIR_TINT` | — |
| 226 | exit-door stone frame / arch | `STONE_TINT` | — |
| 230 | hinge straps | `#1c1c1a` | — |
| 471-476 | exit door leaf | `DOOR_WOOD_TINT` | — |

**Lights that exist only to feed those materials**

| File:line | Light |
|---|---|
| `WorldTurns.tsx:149` | `ambientLight`, day↔night colour + intensity ramp (`:120-126`) |
| `WorldTurns.tsx:150` | `directionalLight` (the sun), `castShadow`, wheels across the sky (`:128-135`) |
| `Diorama.tsx:936`, `1282-1289` | torch `pointLight`s, `TORCH_DISTANCE 3.2` |
| `SightSweep.tsx:187-191` | door-spill `pointLight` |
| `TableScene.tsx:358` | table overhead `pointLight`, `TABLE_LIGHT_INTENSITY 4.5` |

**Shadow machinery** — `Canvas3D.tsx:38` `shadows="percentage"`; `castShadow` at
`Diorama.tsx:1016`, `1072`, `TableScene.tsx:406, 415, 426, 435, 446, 455, 470, 501`;
`receiveShadow` at `Diorama.tsx:1017`, `1073`.

### Fix — convert every remaining toon surface to unlit, then delete what becomes dead

For each material above:

1. Swap `MeshToonMaterial` → `MeshBasicMaterial`, drop `gradientMap`, add
   `toneMapped: false`.
2. **Re-derive the day albedo** so nothing changes appearance where it is already correct.
   The conversion multiplies on-screen value by `1 / f`, where `f` is the linear factor the
   surface's toon shading was landing on. Do not guess `f` — **measure it per material**:
   screenshot the surface at its representative beat before the change, sample its mean
   on-screen linear value, and set the new albedo so the post-change sample matches. Record
   the measured `f` per material in a comment next to the new literal, the same way every
   existing tint in these files documents its own derivation.
3. **Re-derive the night ratio.** Every `*_NIGHT_TINT` here is `night_linear / day_linear`.
   The IIFE-built ones (`CAP_`, `BONE_`, `VAULT_BASE_`, `VAULT_LID_`, `BRAZIER_*`,
   `BORDER_`, `WALL_`) recompute automatically once the day literal changes — that is exactly
   why the IIFE pattern exists. The **hand-computed literals must be recomputed by hand**:
   `PROP_WOOD_NIGHT_TINT` (`Diorama.tsx:236`), `FLOOR_NIGHT_TINT` (`:188`),
   `WOOD_NIGHT_TINT` (`:205`), `TABLE_NIGHT_TINT` / `SHEET_NIGHT_TINT`
   (`TableScene.tsx:102-103`). The last four are already unlit and only need touching if their
   day albedo moves.
4. **Guard against the blow-out this conversion invites.** `Diorama.tsx:237-248` already
   documents the trap: `CAP_NIGHT_TINT`'s ratios are **> 1** per channel (they lift a dark cap
   toward a pale moonlit blue), which is only survivable because the toon ramp was clamping
   the product. On an unlit surface a > 1 ratio multiplies a full-strength albedo and clips
   past white.

   Add a build-time assertion — one small check, no framework — over the whole tint table:
   for every `(day_tint, night_tint)` pair, `night_tint[c] · srgbToLinear(day_tint)[c] ≤ 1.0`
   for `c` in r/g/b. Any pair that fails means the night target must be re-picked, not the
   ratio clamped.
5. **Relief is lost on conversion, knowingly.** `withRelief` (`textures.ts:183-197`) bundles
   `map` + `normalMap` + `aoMap`; `MeshBasicMaterial` ignores `normalMap` (it keeps `aoMap`).
   The already-converted floor and wall faces accepted this. Note it per converted surface so
   nobody later reports "the vault lost its bevel" as a new bug.
6. **Then delete the dead chain.** Once no lit material remains: the ambient and directional
   lights, the four `pointLight`s, `WorldTurns`'s sun-position/intensity ramp
   (`WorldTurns.tsx:120-135`, keeping the rain block), every `castShadow` / `receiveShadow`,
   and `shadows="percentage"` on `<Canvas>`. This is a real per-frame saving — a shadow-map
   pass every rendered frame for zero visible output — and it is deletion, not addition. Do it
   as a **separate, independently revertible commit** after the conversion is verified, so a
   regression can be bisected to the right half.

   Caveat to check before deleting, not assume: `WorldTurns`'s ambient colour ramp is currently
   the only thing giving the *lit* surfaces their day→night hue shift. After conversion every
   surface gets its night shift from its own `*_NIGHT_TINT` instead, so the ramp is genuinely
   redundant — confirm on the beat-5 sweep before removing.

### Files touched

`site/src/scene/Diorama.tsx`, `site/src/scene/TableScene.tsx`,
`site/src/scene/focalAccents.tsx`, `site/src/scene/WorldTurns.tsx`,
`site/src/scene/textures.ts`, `site/src/components/Canvas3D.tsx`,
`site/src/scene/SightSweep.tsx`.

### Acceptance test

1. **No lit materials remain.** In the console:
   `let n = 0; window.__scene?.traverse(o => { if (o.material) [].concat(o.material).forEach(m => { if (m.isMeshToonMaterial || m.isMeshStandardMaterial || m.isMeshPhongMaterial || m.isMeshLambertMaterial) n++; }); }); n` must be `0`.
   (If no scene handle is exposed, grep instead: zero matches for
   `meshToonMaterial|MeshToonMaterial|gradientMap|meshStandardMaterial` under `site/src`.)
2. **One value system.** Pick five representative surfaces (wall cap, crate, vault lid, chair,
   exit door). For each, sample the on-screen sRGB value at its representative beat and compare
   to its authored day tint. Required: **|on-screen − authored| ≤ 4/255 per channel** for all
   five. Today the toon ones land ~0.35× — this is the number that proves the systems merged.
3. **Nothing moved where it was already right.** Before/after screenshot at all nine beats,
   copy hidden, identical scroll positions and window size. Required: **per-beat mean frame
   luminance within ±6/255**, and no individual surface shifting by more than 10/255. Beat 5 at
   `clockT = 1` is the highest-risk frame — check it at `clockT` 0.25 / 0.5 / 0.75 / 1.0 too.
4. **No blow-out.** The assertion from step 4 above must pass, and at `clockT = 1` no pixel on
   any converted surface may be clipped (all three channels at 255) except inside a torch pool.
5. **Perf, after the light deletion.** With the R3F profiler or
   `gl.info.render`, compare `calls` and `triangles` per frame at beat 7 before and after.
   Required: `calls` strictly lower (the shadow pass is gone), rendered output unchanged per
   test 3.
6. Run test 3 at dpr 1.25 as well.

---

## 6. X-ray ghosting on crates mid-fade

### Root cause, confirmed by direct observation

Captured live: beat "the rise" pin at 50% progress (`scrollY 2713`, hero pin top 2325,
viewport 1484×775, dpr 1), zoomed 4× on `crates-a` at world (6.8, 4.8). The crate renders as a
**heavy stochastic dither** — a moth-eaten speckle patch roughly 60×50 device px — through
which the floor grid line and the base box's own silhouette are both plainly visible.

The mechanism, from `site/src/scene/Diorama.tsx:1471-1498`:

- The two box bodies use `alphaHash` with `opacity` driven by `riseT`
  (`Diorama.tsx:1480`, `1490`, driven by `fadeAndNight` at `:1329-1334`). `alphaHash` keeps the
  material in the **opaque, depth-writing** pass and stochastically discards fragments — the
  previous fix, and it did work as designed.
- But the discard leaves **holes in the depth buffer**, and the crate's ink outline hull is a
  *separate* object in the **transparent** pass: `Outline` hardcodes `transparent` at
  `site/src/scene/Outline.tsx:37`, and `Diorama.tsx:1460-1461` drives
  `baseOutlineRef.opacity = riseT`. So at `riseT ≈ 0.5` the far box's back-side hull, the floor,
  and the torch pool all draw through ~50% of the near box's pixels.
- And the technique cannot converge here even in principle. Stochastic alpha needs either
  sub-pixel noise or temporal accumulation. `<Canvas frameloop="demand">`
  (`Canvas3D.tsx:36`) means **there is no temporal accumulation at all** — the dither is frozen
  per rendered frame — and at ~60 px across, a 50%-coverage hash reads as static, not as a
  dissolve. Two ghosts were traded for one.

The same alpha-blend regime is on `BonePile` (`Diorama.tsx:1541`, `1560`) and `Vault`
(`:1628`, `:1638`), which have the same latent defect. Per the fix-at-the-shared-site rule,
treat all four props, not just the one the ticket names.

### Fix

**Stop fading solid props; grow them.** This is the mechanism the codebase already proves for
exactly this problem: walls and doors reveal by `scale.y` growing from 0, and `Outline.tsx:1-9`
documents that the hull is a JSX child which "automatically inherits the parent's transform —
including the scroll-driven scale.y". No transparency is involved, so no ghost of any kind is
possible.

Concretely, in `Diorama.tsx`:

- Give `CrateStack`, `BonePile`, `Vault`, and `Brazier` a `riseT`-driven `scale` on their
  group (from 0, anchored at the base so they grow out of the floor like the walls do), reusing
  the existing `staggered` / `easeSettle` helpers (`Diorama.tsx:316-329`) so the props share the
  walls' settle character rather than inventing a second one.
- Make the body materials fully opaque: drop `alphaHash`, drop `transparent`, drop the
  `opacity` drive. `fadeAndNight` (`Diorama.tsx:1329-1334`) keeps its night-tint half and loses
  its `mat.opacity = riseT` line — rename it to reflect that.
- Drop the outline `matRef` opacity drives at `Diorama.tsx:1460-1461`, `1483-1486`,
  `1493-1496` and their siblings in `BonePile` / `Vault`. `Outline.tsx:37` keeps
  `transparent` (other callers rely on it) and simply renders at opacity 1, which
  `Outline.tsx:31-33` already documents as identical to the old behaviour.
- Keep the contact-shadow decals' opacity fade (`Diorama.tsx:1469`, `1537`, `1625`). They are
  flat ground decals with `depthWrite: false`; a flat decal on the floor cannot x-ray anything.

This is a net deletion: it removes `alphaHash`, four `transparent` flags, and six outline
opacity refs.

**Fallback if a grow-in is rejected on choreography grounds** (the art brief says props "fade
in with riseT"): make the outline hull share the body's regime by adding an `alphaHash` prop to
`Outline` and dropping `transparent` for those callers, so the whole prop is one opaque
depth-writing dissolve. This closes the hull ghost but not the "static at 60 px" problem, so
it must then pass the bimodality test below on its own merits.

### Files touched

`site/src/scene/Diorama.tsx`, `site/src/scene/Outline.tsx`.

### Acceptance test

At 1484×775, dpr 1, beat "the rise" pin at exactly 0.50 progress, zoom 4× on `crates-a`
(world 6.8, 4.8):

1. **Histogram bimodality.** Extract the crate's bounding footprint from the PNG and histogram
   its luminance. A **blend** produces one mode near the midpoint of crate-value and
   background-value. A **solid grow-in** produces one mode at the crate value with no
   background pixels inside the silhouette. Required: **≥ 92% of pixels inside the silhouette
   within ±10/255 of the crate's `riseT = 1` value**, and zero pixels matching the floor-grid
   line's value inside the silhouette. Today the same measurement finds the floor grid clearly
   present inside both boxes.
2. **No see-through of the far box.** The base box's silhouette edge must not be detectable
   anywhere inside the top box's footprint (edge-detect the region; no interior edge above the
   texture's own contrast).
3. **Same test on the other three props**: `bones-a`, `bones-b`, the vault, and the brazier, at
   the same progress.
4. **Choreography did not regress.** Video-frame the rise beat at progress 0.0 / 0.25 / 0.50 /
   0.75 / 1.0. The last grower must still finish exactly at `riseT = 1` (the
   `GROW_SPAN` / `staggered` contract at `Diorama.tsx:309-319`), and no prop may be visible at
   `riseT = 0`.
5. **Repeat 1 and 2 at dpr 1.25** — dither density is a device-pixel phenomenon and this is
   precisely the class of bug the dpr-1.25 rule exists for.

---

## 7. Night heading contrast on beat 5

### Root cause, measured

Measured live at `scrollY 6123` (beat-5 pin, `--night-t = 0.858`):

| Element | Computed colour | Size / weight |
|---|---|---|
| `h2` "Night falls on schedule…" | `rgb(22, 24, 15)` = `#16180f` (`--ink`) | 48px / 500 → **large text** |
| `.sub` | `rgb(74, 68, 51)` = `#4a4433` (`--ink-mut`) | body |
| `.voice` | `rgb(77, 100, 16)` = `#4d6410` (`--goblin-ink`) | body |
| `.stage-lamp` computed opacity | `0.1849` | |

There is no night-aware colour anywhere in the copy chain: `global.css:19`/`:28` sets
`color: var(--ink)` on the body and `.feature-room h2` (`:331`) inherits it. The tokens are
authored against the parchment day field — `tokens.css:27-41` documents ratios "computed
against `--parchment`" (`--ink` 13.5:1). At beat 5 the field behind them is not parchment.

Contrast against what is actually behind the copy at beat 5:

- Surround: `NORMAL_BG #3a2717` lerped toward `NIGHT_BG #0c0906` by `nightT`
  (`SceneRenderer.tsx:271`, `:512`). At `nightT 0.858` that is ≈ `#120b08`.
  **`#16180f` on `#120b08` = 1.08 : 1.**
- Night floor, `#232838` (`Diorama.tsx:180-188`). **`#16180f` on `#232838` = 1.24 : 1.**
- Worst case is mid-scrub: at `worldP 0.8` (`--copy-v` still 1, `clockT 0.714`) the surround is
  ≈ `#19100a` → **1.04 : 1**.

So the beat-5 heading sits between **1.04 : 1 and 1.24 : 1**. The `.sub` and `.voice`
(body-size) are in the same band. This is not a near-miss; the copy is effectively invisible
against the night grade, and `.stage-lamp` dropping to 0.18 removes the last thing lifting the
field.

### Target

- `h2` at 48px / weight 500 is **large text** → WCAG AA floor **3 : 1**. Target **≥ 4.5 : 1**,
  because the background is a *live, moving* render whose local value varies by beat position
  and by whatever torch pool drifts under the copy column — a heading measured at exactly 3:1
  against a mean background will drop below it against a dark patch. 4.5:1 buys the margin the
  page's own `PRODUCT.md` accessibility line ("text contrast ≥ 4.5:1 on the chrome") already
  assumes.
- `.sub` and `.voice` at body size → **≥ 4.5 : 1**, non-negotiable, same reasoning as
  `tokens.css:35-37`'s own fix round.
- Measured against the **darkest** background sampled under the copy column across the whole
  beat-5 scrub, not the mean.

### Fix

Ride the mechanism that already exists rather than inventing one. `SceneRenderer.tsx:276`
already writes `--night-t` onto `document.documentElement` once per frame, swap-gated, and
`.stage-lamp` already consumes it (`global.css:128`). Let the copy consume it too: interpolate
the beat-5 copy's ink tokens toward their existing light-ground counterparts as night comes on.

```css
/* The night grade takes the field out from under this beat's ink. --night-t is
   already written per frame by SceneRenderer; the copy rides the same clock the
   world does, so there is one light story, not a second one. Neutral only — the
   ramp ends on --text/--text-2, never on the accent (overlays neutral, accent
   themeable). */
.feature-room[data-beat='world-turns'] h2 {
  color: color-mix(in oklab, var(--ink), var(--text) calc(var(--night-t, 0) * 100%));
}
.feature-room[data-beat='world-turns'] .sub {
  color: color-mix(in oklab, var(--ink-mut), var(--text-2) calc(var(--night-t, 0) * 100%));
}
```

`--text` is `#e6e1d3` and `--text-2` is `#b5af9e` (`tokens.css:15`, `:20`) — both already in
the system, both neutral, neither is the accent. Against `#120b08` at full night, `#e6e1d3`
gives **≈ 15.4 : 1** and `#b5af9e` **≈ 9.4 : 1**; the crossover mid-ramp is the value to verify
rather than assume, which is what the acceptance test does.

`.voice` is `--goblin-ink` — a brand hue used as text. Do **not** ramp it toward the raw
`--goblin`: `docs` doctrine is that the raw brand hues stay fills-only, and the accent must not
become the thing carrying legibility. Ramp it to `--text-2` like `.sub`, or drop the voice line
from this beat. Recommend the former.

Scoping needs a hook, since `--night-t` is global and only this beat is on screen while it is
non-zero: add `data-beat={room.id}` to the `<section>` in `site/src/App.tsx:65`. That is one
attribute, and it is more honest than a `:nth-of-type` selector that silently breaks when a
beat is inserted.

**Rules respected.** No overlay, no scrim, no backdrop-filter, no text-shadow — matte
discipline holds and the accent is untouched. `color-mix` is a plain colour computation with no
compositing cost and no new layer. Reduced motion is unaffected (the ramp is driven by scroll
position, not by an animation). No-JS is unaffected: `--night-t` is absent, the `var()` falls
back to `0`, and the copy stays at `--ink` on the parchment prerender — exactly today's
behaviour.

### Files touched

`site/src/styles/global.css`, `site/src/App.tsx`.

### Acceptance test

Sample at `worldP` = 0.30 / 0.50 / 0.65 / 0.80 (the last is peak night with `--copy-v` still
1.0), at 1484×775 and again at 1280×800:

1. For each sample, screenshot with copy visible, then take the **darkest 10th-percentile
   background luminance** inside the heading's bounding box (screenshot the same frame with the
   copy hidden to get the clean background). Compute the contrast ratio of the computed text
   colour against that value.
   Required: **h2 ≥ 4.5 : 1 at every sample**, `.sub` and `.voice` **≥ 4.5 : 1 at every
   sample**. Record the actual numbers; today's baseline for the same measurement is
   1.04–1.24 : 1.
2. **Day beats are untouched.** Beats 1–4 and 6–8 must render the copy at exactly `#16180f` /
   `#4a4433` / `#4d6410` — assert `getComputedStyle(el).color` string-equal to the pre-change
   value at every one.
3. **No accent creep.** No sampled text colour at any point in the ramp may have chroma above
   the `--text`/`--text-2` neutrals. Assert the ramp endpoints are the two neutral tokens.
4. **No-JS path.** Load with JavaScript disabled; `.feature-room` copy must compute to `--ink`.
5. Repeat sample 4 (`worldP 0.80`) at dpr 1.25.

---

## 9. Remove the `window.__lenis` QA hook

### Root cause

`site/src/scene/ScrollCamera.tsx:171-172`:

```ts
// @ts-expect-error QA hook only — remove before ship.
window.__lenis = lenis;
```

It ships in the production bundle today.

### The sequencing hazard, and the answer to it

Every browser verification agent in this batch drives the page with
`window.__lenis.scrollTo(y, { immediate: true })`. Deleting the hook outright breaks every
verification step in this document.

**Confirmed from code and from measurement: native `window.scrollTo(0, y)` is already a valid
verification tool, today, with no dependency on issue 2.** Lenis 1.3.26 adopts native scrolls
in `onNativeScroll` (`node_modules/lenis/dist/lenis.mjs:651-674`) and emits `'scroll'` at
line 667, which `ScrollCamera.tsx:173-174` forwards to `ScrollTrigger.update()`. Measured
today: `window.scrollTo(0, 4200)` moved `lenis.animatedScroll` to 4200, moved the pinned
section index from 0 to 3, and advanced the `--copy-v` vector — and a `2034 → 0 → 2034`
round-trip via `window.scrollTo` reproduced the exact state a real `PageDown` sequence had
produced. So the answer to the question posed in the brief is **confirm**: native
`window.scrollTo` is a valid driver, and it was already valid before issue 2 was looked at.

### Fix

`site/src/scene/ScrollCamera.tsx`: gate on the build flag, so it survives in dev and vanishes
from the production bundle under Vite's dead-code elimination:

```ts
if (import.meta.env.DEV) {
  // @ts-expect-error dev-only QA hook; tree-shaken from the production build.
  window.__lenis = lenis;
}
```

Add the matching teardown inside the same guard in the cleanup at `ScrollCamera.tsx:420-429`.

### Verification steps that must change

**All of them must move to native scroll now, not later** — otherwise the built-bundle checks
(§10, §9 itself, and the built-bundle repeats in §3/§5/§6) silently fall back to a `__lenis`
that no longer exists and the agent reports a false pass on a page it never actually moved.

Replacement recipes:

- **Positional scrub** (used by §3, §4, §5, §6, §7): `window.scrollTo(0, y)` followed by a
  400–600 ms settle before measuring. Measured settle at 600 ms was sufficient today. Every
  measuring call must still assert `document.hidden === false` in the same call.
- **Motion quality / smoothing** (used by §1 test 1, and any "does the wheel feel right"
  check): must use **real wheel events** via the `computer` tool's `scroll` action.
  `window.scrollTo` is instant and never exercises Lenis's eased path, so it cannot detect a
  broken smoothing chain.
- **Keyboard and scrollbar** (§2): real OS key events / real drag, as already specified.
- **Sanity guard**: any script that references `window.__lenis` must first assert it exists and
  **fail loudly** if it does not, rather than silently no-op:
  `if (!window.__lenis) throw new Error('no __lenis — use window.scrollTo on the built bundle')`.

### Files touched

`site/src/scene/ScrollCamera.tsx`.

### Acceptance test

1. `npm run build` in `site/`, then
   `grep -R "__lenis" site/dist/assets/` → **zero matches**.
2. Serve `site/dist` (`npm run preview`) and confirm `typeof window.__lenis === 'undefined'`.
3. On that same built page, `window.scrollTo(0, 4200)`, settle 600 ms, and assert the pinned
   section index and `--copy-v` vector match what the dev server produces at the same `y` and
   the same window size.
4. On the dev server, `typeof window.__lenis === 'object'` — the hook is still there for
   iteration.

---

## 10. Defer the render-blocking CSS `<link>`

### The stated premise is false — verified

The brief says "the page beneath the loader is hidden, so deferring is believed free". It is
not. Checked against the loader's own critical CSS:

- `#gg-loader` is `position: fixed; inset: 0; z-index: 50` (`site/index.html:82-93`) but has
  **no background of its own**. Its children `#gg-lamp` (`:99-110`) and `#gg-stage`
  (`:121-128`) are a semi-transparent radial and a `position: relative` wrapper. The only
  opaque layer is `html { background: #e8dfc6 }` (`:45-47`), which paints *behind* `#root`.
- The `html[data-gg-loading]` rules hide exactly five things: `.canvas-mount`, `.stage-lamp`,
  `.grain` (`:64-68`), `.brand` and `.beat-whisper .copy-scrub` (`:72-75`).

Today that is sufficient **only because the external stylesheet is render-blocking**: by the
time anything paints, `#root` is fully styled, every `.beat` is `min-height: 100svh`, and the
only beat in the first viewport is the whisper — whose copy is one of the five hidden things.

Defer the sheet and that collapses. The prerendered markup (`site/dist/index.html:370` — nine
sections, all headings, the sub copy, the waitlist form) renders **unstyled**, stacking into
the first couple of viewport heights as raw black-on-parchment text, plainly visible through
the transparent loader for the whole duration of the CSS fetch. That is a worse first
impression than the round trip it saves.

### The current shape, verified

`site/dist/index.html`:

```
242: <script>            (the head script that sets data-gg-loading)
245: <script type="module" crossorigin src="/assets/index-CqvdUBv0.js"></script>
246: <link rel="stylesheet" crossorigin href="/assets/index-Bi4jYRKg.css">
247: </head>
```

`dist/assets/index-Bi4jYRKg.css` is **23.2 kB**. It is injected by Vite; `site/index.html` has
no `<link rel="stylesheet">` of its own, so **this issue is invisible on the dev server** —
in dev the CSS arrives through the JS module graph and there is no link tag at all. Every check
here must run against the built bundle.

### Fix — inline the sheet, do not defer it

The deferral route (`media="print" onload="this.media='all'"`, or
`rel="preload" as="style" onload="this.rel='stylesheet'"`) needs, to be correct:

- a `<noscript><link rel="stylesheet">` fallback, because the no-JS visitor gets the
  prerendered page with no loader (`index.html:77-81`) and must still be styled;
- `visibility: hidden` on `#root` in the critical CSS, plus `visibility: visible` overrides on
  the three elements the exit stages in (`.canvas-mount`, `.brand`,
  `.beat-whisper .copy-scrub`), because `opacity` cannot hide the rest of the tree and an
  opaque loader background would break the exit's "the scene fades up UNDER the soaking ink"
  design (`index.html:510-514`);
- a release of that `visibility` at the *start* of the exit rather than at `clear()`, which
  means a second attribute and a second CSS state;
- a gate so `clear()` cannot fire before the sheet has landed.

That is four moving parts to save one round trip.

**Inlining the sheet into the HTML saves the whole request instead of one round trip, and needs
none of them.** 23.2 kB raw is roughly 5 kB gzipped onto a document that is already ~40 kB and
is the very first response on the wire; there is no second connection, no second RTT, no
sequencing, no FOUC window at any point, and the no-JS and reduced-motion paths are untouched
because nothing about the ordering changes.

Mechanism: a build-only Vite plugin in `site/vite.config.ts`:

```ts
{
  name: 'gg-inline-css',
  apply: 'build',
  enforce: 'post',
  transformIndexHtml(html, ctx) {
    // Replace Vite's injected <link rel=stylesheet> with the sheet itself. The
    // loader's critical CSS is already inline right above it; making the page's
    // own sheet inline too means first paint costs exactly one response.
    // ponytail: the sheet is no longer separately cacheable across visits —
    // correct trade for a single-document cold-visit-dominated landing page.
    // If this page ever grows a second route, go back to a linked sheet.
  },
}
```

The emitted CSS asset is available on `ctx.bundle`; read it, swap the `<link>` for a `<style>`,
and delete the now-unreferenced asset from the bundle so `dist/assets` has no dead 23 kB. Font
`url()`s inside the sheet are Vite-rewritten to absolute `/assets/...` paths, so they resolve
identically when inlined — **verify this rather than assume it** (acceptance test 4).

`site/prerender.mjs` is not a good home: it runs after `vite build` and would be a second
string-munging site on the same document, competing with its existing
`<div id="root">` replacement (`prerender.mjs:9`).

**If the reviewer insists on a linked-and-deferred sheet**, the fallback is the four-part
recipe above, spelled out; it is strictly more work for strictly less benefit, and it is the
only variant that needs the loader's critical CSS edited.

### Files touched

`site/vite.config.ts`. (`site/index.html` and `site/prerender.mjs` are assigned to this scope
as reserve but should not need edits under the inline route.)

### Acceptance test

Against the **built bundle** served by `npm run preview`, network throttled to Fast 3G, cache
disabled, five cold loads each before and after:

1. **No render-blocking stylesheet.** `document.querySelectorAll('link[rel="stylesheet"]').length === 0`
   and `document.querySelectorAll('style').length >= 2` (the loader's + the inlined sheet).
2. **First paint no longer waits on a CSS response.** From
   `performance.getEntriesByType('paint')` and `performance.getEntriesByType('resource')`:
   `first-contentful-paint` must be **≤ the pre-change FCP minus one RTT**, and after the
   change there must be **no CSS resource entry at all**. Report the five-load medians.
3. **No FOUC at any moment.** Record a video of a throttled cold load. Frame-by-frame, there
   must be **zero frames** containing unstyled `#root` text — specifically, no frame in which
   more than one `.beat`'s heading is visible simultaneously, and no frame in which the
   waitlist form is visible before the loader clears.
4. **Fonts still resolve.** After load, `document.fonts.check('500 48px Newsreader')` is `true`
   and `document.fonts.status === 'loaded'`; network panel shows the woff2 requests resolving
   200 from `/assets/`. Zero 404s.
5. **No-JS path.** Load with JavaScript disabled. The prerendered page must be **fully styled**
   (`.beat` computed `min-height` is the viewport height, `.cta` has its background) and
   `#gg-loader` must compute to `display: none` (`index.html:79-81`).
6. **Reduced-motion path.** With `prefers-reduced-motion: reduce`, the loader must take its
   still-frame branch (`index.html:591-609`) and clear normally; measure the same FCP delta.
7. **Prerender integrity.** `dist/index.html` still contains the SSR markup at the
   `<div id="root">` site, and `dist/assets/` contains **no orphaned CSS file**.
8. **Byte check.** `dist/index.html` grows by ~23 kB raw; confirm the gzipped document is under
   20 kB.

---

## Builder split — three parallel Sonnet scopes, disjoint file ownership

The proposed split (A = scroll rig 1/2/3/9, B = scene light/value 4/5/6/7, C = build shell 10)
holds, with one correction and one caveat.

**Correction:** issue 7 must sit with B, not with C. Issue 7 edits
`site/src/styles/global.css` and issue 4 edits the same file (deleting `.stage-lamp`). Issue 7
also edits `site/src/App.tsx`, which issue 4 edits too (removing the `.stage-lamp` div). Two
scopes cannot own one file, so 7 goes where 4 already is. That leaves C with issue 10 alone —
genuinely thin, and that is fine: the build shell is three files and splitting further would
put `global.css` in two hands.

**Caveat:** `site/index.html` is claimed by C as reserve even though the recommended fix for
both issue 1 and issue 10 avoids editing it. If either builder concludes it must be edited, C
makes the edit; A and B file a request rather than reaching in.

### Scope A — scroll rig (issues 1, 2, 3, 9)

Owns, exclusively:

- `site/src/scene/ScrollCamera.tsx`
- `site/src/scene/cameraPath.ts`
- `site/src/components/Hero.tsx`

Does **not** touch `index.html`, `global.css`, `App.tsx`, or anything under `src/scene/`
other than the two files listed.

### Scope B — scene light and value system (issues 4, 5, 6, 7)

Owns, exclusively:

- `site/src/scene/Diorama.tsx`
- `site/src/scene/TableScene.tsx`
- `site/src/scene/textures.ts`
- `site/src/scene/focalAccents.tsx`
- `site/src/scene/WorldTurns.tsx`
- `site/src/scene/SightSweep.tsx`
- `site/src/scene/Outline.tsx`
- `site/src/scene/SceneRenderer.tsx`
- `site/src/components/Canvas3D.tsx`
- `site/src/styles/global.css`
- `site/src/App.tsx`

`SceneRenderer.tsx` is listed for B because issue 4's night ladder and issue 5's material
inventory both read from it (`NORMAL_BG` / `NIGHT_BG` / `--night-t` at `:45`, `:69`, `:276`);
issue 3 only *reads* `GAP_PX` from it, and scope A must copy the constant's value into a
comment rather than import or edit that file — `GAP_PX` is already duplicated by contract in
this codebase ("grep NORMAL_BG when touching either" is the established pattern).

`Canvas3D.tsx` is B's because of the `shadows="percentage"` deletion in issue 5. `Hero.tsx`
lazy-imports `Canvas3D` but does not edit it, so there is no overlap with A.

### Scope C — build shell (issue 10)

Owns, exclusively:

- `site/vite.config.ts`
- `site/index.html`
- `site/prerender.mjs`

No file appears in two scopes.

---

## Sequencing hazards

1. **Issue 9 before every browser verification pass, and announced.** The moment
   `window.__lenis` is gated on `import.meta.env.DEV`, every built-bundle verification step
   that used `__lenis.scrollTo` becomes a silent no-op. Land issue 9 **first** within scope A,
   and update the verification recipes in the same change (native `window.scrollTo` + 600 ms
   settle; real wheel events for motion quality). Every verification script must assert
   `window.__lenis` exists before using it and throw if it does not.

2. **Issue 4 changes what the loader hands off to — B before C, with a named contract.**
   `index.html:95-98` asserts that `#gg-lamp`'s end-of-exit value **is** `.stage-lamp`'s rest
   value. Issue 4 deletes `.stage-lamp`. B must land the world lamp first and verify §4 test 3
   (beat-0 centroid within ±6% of 26%/12%); only then does C re-verify the exit seam (§4
   test 5). If B's placement drifts off 26%/12%, `#gg-lamp`'s stops in `index.html:102-107` must
   move to match — and that edit belongs to C, not B.

3. **Issue 3 depends on `GAP_PX = 56`, which lives in a file scope B owns.** If B ever changes
   `GAP_PX` (it has no reason to), A's aspect solve silently under-corrects and the beat-4
   clipping test starts failing for a reason A cannot see. Freeze `GAP_PX` for this batch and
   state so in both scopes.

4. **Issue 5's light deletion can silently break issue 6's verification.** Removing the torch
   `pointLight`s and the ambient/directional pair changes the on-screen value of every prop.
   If the crate acceptance test (§6 test 1, "within ±10/255 of the crate's `riseT = 1` value")
   is captured **before** the light deletion and re-run after, it will fail for the wrong
   reason. Land issue 6 first, verify it, then the issue-5 conversion, then **re-baseline** §6
   test 1 against the post-conversion `riseT = 1` value.

5. **Issue 5's conversion changes every screenshot baseline in the batch.** Issues 3, 4, 6 and
   7 all use before/after screenshot comparisons. Capture **all** "before" baselines in one
   session, on one machine, at one window size, before any builder lands anything — otherwise
   two scopes' baselines disagree and every comparison is noise.

6. **Issue 1's `ScrollTrigger.refresh()` observes an attribute C owns.** If C ever renames or
   removes `data-gg-loading`, A's MutationObserver silently never fires and the belt-and-braces
   quietly disappears. Name the attribute as a cross-scope contract in both files' comments.

7. **Issue 7's ramp reads `--night-t`, which scope B writes from `SceneRenderer.tsx:276`.**
   Both are inside scope B, so there is no cross-scope hazard — but if the issue-5 conversion
   changes when `nightT` is computed or gated, the copy ramp changes with it. Verify §7 in the
   same pass as §5's beat-5 sweep.

8. **Issue 10 is invisible on the dev server.** A builder verifying it against
   `localhost:5179` will find no `<link rel="stylesheet">` and may conclude the work is already
   done. C's verification must run `npm run build && npm run preview` exclusively.

---

## Risk register

| Risk | What it would break | Specific check that catches it |
|---|---|---|
| Issue 1's `ScrollTrigger.refresh()` fires while a beat is pinned mid-scrub | The just-shipped `clockT`/`worldP` rework: a refresh reverts and re-swaps every pin, and a mid-scrub refresh can reset `--copy-v` or jump the camera | The observer only fires when `data-gg-loading` is removed, which the loader guarantees happens at `scrollY 0` (`index.html:573`). Assert it: log `scrollY` inside the observer across 10 loads — must be 0 every time. Plus §1 test 3 (scrollHeight delta = 0). |
| Issue 1's `requestIdleCallback` timeout makes the 3D decision fire *before* the loader is ready | The loader's `scene-code`/`scene`/`frame` milestone ordering; a too-early decision could land the WebGL context creation inside the loader's tightest frames | Loader milestone ordering must be unchanged: log the `__ggMark` sequence across 10 loads — must always be `fonts, react, scene-code, scene, frame`, never reordered, and the loader's total life must not exceed its pre-change median by more than 15% |
| Issue 3's curve rebuild fires on every resize tick | Frame drops during a window drag; worse, a rebuild mid-scrub jumps the camera | Memoise on aspect rounded to 2 dp and rebuild only on change. Check: instrument the rebuild counter, drag-resize the window for 5 s, assert the counter is under 30 |
| Issue 3's height clamp is hit on a common desktop size | Beat-4 clipping "fixed" only on paper | Enumerate aspects 0.9 → 2.4 in 0.05 steps, log `y4` and whether it is clamped; assert no aspect ≥ 1.05 is clamped |
| Issue 4 deletes `.stage-lamp` and the exit seam becomes visible | The just-shipped loader's "invisible swap" (`index.html:95-98`) | §4 test 5: frame before `clear()` vs 200 ms after; no step ≥ 10/255 in the top-left quadrant |
| Issue 5's night ratios blow past white on unlit surfaces | The night ladder — the exact failure `Diorama.tsx:237-248` documents for the brazier | The `night_tint · day_albedo_linear ≤ 1.0` assertion, plus §5 test 4 (no clipped pixels at `clockT = 1` outside torch pools) |
| Issue 5 deletes lights that something still needs | Silent flattening of a surface nobody screenshotted | §5 test 3 requires all nine beats within ±6/255 mean luminance; land the deletion as its own commit so it bisects cleanly |
| Issue 6's grow-in breaks the `GROW_SPAN` stagger contract | The beat-2 "last torch catches" timing that the headline is synced to (`Diorama.tsx:309-313`) | §6 test 4: no prop visible at `riseT = 0`; last grower finishes exactly at `riseT = 1` |
| Issue 7's `color-mix` ramps a day beat | Every other beat's typography | §7 test 2: computed colours on beats 1–4 and 6–8 string-equal to pre-change values |
| Issue 10's inlining orphans or breaks font URLs | Fonts silently fall back to Georgia/system-ui site-wide | §10 test 4 (`document.fonts.check`, zero 404s) |
| Issue 10 changes the prerendered document | The no-JS/SEO floor `prerender.mjs` exists for | §10 tests 5 and 7 |
| Any builder edits a file outside their scope | Two builders' verifications disagree with no visible cause | Before each builder's hand-off, diff the working tree and assert every changed path is in that scope's list |

---

## Verification plan — what the follow-up browser pass must measure

### Standing rules for every measurement

- Assert `document.hidden === false` **inside the same `javascript_tool` call** as the
  measurement. A hidden tab has frozen `requestAnimationFrame` and every scroll-driven value
  will be stale.
- Chrome page zoom at 100%.
- PNG screenshots only.
- Foreground the tab via PowerShell UI Automation `SelectionItemPattern.Select()` on the tab
  item (`AppActivate` is not sufficient); close the tab when the pass ends.
- After any `window.scrollTo`, settle **600 ms** before measuring. Measured sufficient today.
- Capture **all** "before" baselines in one session before any builder lands anything
  (sequencing hazard 5).

### Per issue

| Issue | Measurement | dpr 1.25 required | Built bundle required |
|---|---|---|---|
| 1 | 10 throttled cold loads: `[hidden, canvas present, .pin-spacer count, scrollHeight]`; `decide()` timing; scrollHeight delta across the loader release | **Yes** — `scrollbar-gutter: stable` reserves a device-pixel-rounded gutter, and the pin geometry is measured against it | **Yes** — the dev server's module graph makes `scene-code` mean something different, and cold-load timing is only meaningful against the real chunk |
| 2 | Real `PageDown`/`End`/`Home`, real scrollbar drag; `animatedScroll === scrollY`; pin/copy state equality vs `window.scrollTo` | **Yes** | No |
| 3 | Four aspects × beat-4 pin at progress 1.0; outer-wall margins ≥ 8 px per half-pane; `camera.position.y` sample across segments 3→4→5 | **Yes** — `GAP_PX` is multiplied by dpr in `SceneRenderer.tsx:309`, `337` | No |
| 4 | Peak-to-corner luminance delta at beat 7 (≥ 40/255); pool centroid at beats 0/4/7; beat-0 centroid within ±6% of (26%, 12%); night delta ≤ 8/255; exit seam step < 10/255 | No | No, but re-check the exit seam once, in the build, because the loader's timing differs |
| 5 | Zero lit materials; five surfaces within 4/255 of authored tint; nine-beat luminance within ±6/255; blow-out assertion; `gl.info.render.calls` before/after | **Yes** | Once, for the shader-define path |
| 6 | Crate footprint histogram bimodality at `riseT 0.50`; no interior edge; same on bones/vault/brazier; rise choreography frames | **Yes — mandatory.** Dither density is a device-pixel phenomenon; at dpr 1 the pattern is coarse and at 1.25 it changes character entirely | No |
| 7 | Contrast ratio at `worldP` 0.30/0.50/0.65/0.80 against the darkest 10th-percentile background under the heading box, at 1484×775 and 1280×800; day-beat colours unchanged; no-JS colour | **Yes**, for the `worldP 0.80` sample | No, except the no-JS check |
| 9 | `grep __lenis site/dist/assets/` → 0; `typeof window.__lenis === 'undefined'` on preview; native-scroll state parity dev vs build | No | **Yes — this is the whole point** |
| 10 | Zero stylesheet links; FCP median across 5 throttled cold loads before/after; no CSS resource entry; frame-by-frame FOUC scan; font checks; no-JS styled; reduced-motion path; document gzip size | No | **Yes — the `<link>` does not exist in dev** |

### Order of the verification pass

1. Capture every "before" baseline (all issues, one session, one window size, dpr 1 and 1.25).
2. Scope A lands issue 9 and publishes the native-scroll recipe.
3. Scope A: issues 1, 3; issue 2 verified-and-closed.
4. Scope B: issue 6 verified; then issue 5 conversion; then issue 5 light deletion as a
   separate commit; then re-baseline and re-verify issue 6; then issues 4 and 7.
5. Scope C: issue 10, built-bundle only.
6. Full nine-beat sweep at dpr 1 and dpr 1.25, on the built bundle, zero console errors, zero
   failed network requests.
