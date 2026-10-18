# Nine-issue fix batch — verification pass

Date: 2026-08-11. Verify-only pass (no source edits, no git). Ran against the dev server at
`http://localhost:5179` (PID 6616, left running) and against a build served at
`http://localhost:5180` (`npx vite preview --port 5180 --strictPort`, PID 10564, stopped at the
end of this pass). The impeccable skill's design lens (contrast, motion, layout rules) was
applied qualitatively to issues 4, 5, 6, 7 rather than run as a full audit command flow — this
is a numeric-acceptance-test verification pass, not a fresh design review.

**Environment limitations hit immediately, and how they shaped the method below:**

- The browser automation extension's screenshot tools in this install only produce **JPEG**,
  never PNG. The plan mandates PNG-only evidence. No format override was exposed.
- The WebGL canvas (`frameloop="demand"`, no `preserveDrawingBuffer`) cannot be read back via
  `canvas.toDataURL()`/`getImageData()` from a separate JS turn — the browser clears the
  drawing buffer before the read, confirmed by both an immediate-post-load capture (worked once)
  and six `requestAnimationFrame`-synchronized retries after a forced re-render (all zero).
- OS-level screen capture (`System.Drawing.Graphics.CopyFromScreen` via PowerShell) was tried as
  a PNG-producing fallback. It **could not be reliably aligned** to the actual browser viewport:
  three independent coordinate derivations (`window.screenX/outerWidth` math, Win32
  `GetWindowRect`, Win32 `GetClientRect`+`ClientToScreen`, the last re-tried after explicitly
  setting `PROCESS_PER_MONITOR_DPI_AWARE_V2`) each produced captures that were letterboxed with
  black bars or bled in pixels from an unrelated window, at inconsistent offsets between
  attempts. This points to the automation sandbox's screen-capture path not sharing a coordinate
  space with the UI Automation path used to foreground/resize the window, not to a fixable DPI
  setting. I stopped chasing it after four calibration rounds.

Net effect: every acceptance number that requires true pixel colour (issue 3's wall-margin
pixels, issue 4's luminance deltas, issue 6's histogram bimodality, issue 5's per-surface tint
match, issue 10's frame-by-frame FOUC scan) **could not be captured to the letter of the plan**.
Where a test could be re-derived from DOM/CSS state instead (issue 7's contrast — text colour
and background colour are both fully determined by CSS custom properties, no pixels needed) I
did that exactly and got real numbers. Elsewhere I fell back to structural code verification
(grep/read, which is exact) plus qualitative JPEG screenshots (flagged as JPEG, used only for
gross composition/clipping judgments, never for colour numbers). This is spelled out per issue
below rather than glossed over.

---

## Issue 1 — scroll-rig init flake

**Code**: `Hero.tsx:51` — `requestIdleCallback(decide, { timeout: 1500 })`. Confirmed.
`ScrollCamera.tsx:198-206` — `MutationObserver` on `data-gg-loading` removal calling
`ScrollTrigger.refresh()` once, self-disconnecting. Confirmed, matches the plan exactly.

**Test 1 (reload determinism)**: 5 consecutive unthrottled reloads on the dev server (CPU 6× /
Fast 3G throttling was **not reachable** — no CDP throttling API exposed by the browser
automation tool set, and I did not find a UI path to it either). All 5/5: `hidden:false`,
`canvas:true`, `spacers:9`, `scrollHeight:7777` (identical every time). **PASS on the
sub-sample I could run; the throttled 10/10 requirement is UNTESTED** — no throttling
capability in this environment.

**Test 3 (post-loader re-measure no-op)**: captured `scrollHeight` immediately before and 100 ms
after `data-gg-loading` removal via a `MutationObserver` in the same call. Result: `7777` → `7777`,
delta 0. **PASS.**

**Test 2 (idle-timeout proof)**: UNTESTED — requires temporary instrumentation inside `decide()`
which is out of scope for a verify-only pass (no source edits).

## Issue 2 — external scrolls bypass Lenis (regression only)

Real OS-level key events via the `computer` tool (`key` action; note **`"PageDown"`, not
`"Page_Down"`** — the underscore form is silently swallowed by Chrome and produced zero scroll
on first attempt, a tooling gotcha worth recording).

- `PageDown` ×3 from `scrollY=0`: landed at `scrollY=1548`, `lenis.animatedScroll=1548`,
  `lenis.isScrolling=false` (settled). `--copy-v` vector `[0,0,0,0,0,0,0]`.
  Reset to 0, `window.scrollTo(0,1548)`, settle 600 ms: **identical** `--copy-v` vector and
  `scrollY`. **PASS — exact equality**, matching the plan's own "not reproducible as reported"
  finding.
- `End` → `scrollY=7187` (`=== lenis.limit` exactly), `Home` → `scrollY=0`, `--copy-v`
  `[1,0,0,0,0,0,0]` matching the top-of-page baseline exactly. **PASS.**
- Scrollbar-drag equality (test 3): attempted a real `left_click_drag` on the scrollbar track at
  the visible thumb position; it did not move `scrollY` (0 → 0 across two tries, likely missed
  the actual thumb hitbox with a custom-styled or narrow native scrollbar). **UNTESTED** — not
  worth burning further tool calls chasing pixel-precise drag coordinates given tests 1 and 2
  already demonstrate native-scroll-to-Lenis adoption holds.
- dpr 1.25 repeat: not run for issue 2 specifically (time budget went to issue 7's dpr 1.25
  repeat instead, which is the one the plan flags as most likely to regress). **UNTESTED.**

## Issue 3 — aspect < 1.6 clips the beat-4 plan — **FAIL**

**Code**: `cameraPath.ts:117-121` —
`setPathAspect(aspect)` computes
`y = clamp(KEYFRAME4_BASE_Y * max(1, 1.6/aspect), 36, 56)` and memoises on a 0.01 epsilon.
**This is a single-argument function** — it does not take `canvasHeightPx` as the plan's own
recommended signature specifies, and the `GAP_PX/h` correction term from the plan's closed-form
solve is dropped entirely. The plan's own validation table only checked this simplified ratio
formula against a specific set of (aspect, h) pairs where h happened to grow as aspect shrank
(1.6/800, 1.4/900, 1.2/1000, 1.05/1100, 0.9/1200) — real windows don't obey that correlation.
`ScrollCamera.tsx:58-68` wires it to R3F's `useThree().size` with `invalidate()`, confirmed present
and correctly triggering on live resize (verified — the composition visibly changed on resize
without a reload).

**Live reproduction, dev server, beat-4 ("trust") pin at raw progress 1.0** (screenshots are
JPEG — flagged per the environment-limitation note above; used here only to judge whether a wall
is present in frame at all, not for pixel-margin measurement):

| Window (actual, JS-reported) | Aspect | Result |
|---|---|---|
| 1584 × 815 | 1.94 | Outer walls visible with visible margin on both panes. Looks correct. |
| 1200 × 917 | 1.31 | **Outer walls clipped.** Left pane's outer torch is cut by the pane edge (rendered as a half-circle at x=0); right pane's outer wall is entirely absent — floor runs to the pane's right edge with an off-frame prop bleeding in. **Zero margin, not ≥8px.** |
| 1184 × 815 | 1.45 | **Same clipping.** No wall visible on either pane's outer edge; floor tiles run edge-to-edge. |

Both narrow-aspect reproductions are well inside the range the fix claims to cover (down to
"aspect ≈ 1.05" per the acceptance table), and both show full wall loss, not a marginal
under-8px miss. This reproduces from source: my test window at aspect 1.31 has height 917px,
noticeably shorter than the plan's own validated 1000px assumption for a similar aspect — and
because the shipped formula has zero height dependency, a short-but-moderate-aspect window gets
exactly the same `y` as a tall one at the same aspect, under-correcting relative to what the
plan's own math says is needed. **This reads as a real, reproducible regression of the target
behavior, not a measurement artifact** — I'd recommend the orchestrator re-open this with scope A
before shipping.

Untested for the same reason as above (no PNG/pixel path): the pixel-identical-at-1.6 check, and
the 60-sample `camera.position.y` smoothness sweep (no scene/camera handle is exposed on
`window`, confirmed via `Object.keys` on the canvas element — only React fiber internals are
attached, no `__r3f` store).

## Issue 4 — the lamp isn't in the world

**Code**: `textures.ts:461` `LAMP_WORLD = [-9, -8.8]`, `:468` `LAMP_RADIUS = 20` — match the plan's
placement/falloff spec exactly. `.stage-lamp` fully removed from `global.css`/`App.tsx` (grep
confirms only retirement comments remain, no live rule or JSX). `TableScene.tsx`,
`textures.ts:838-896` region re-derive from `LAMP_WORLD` per their own comments.

**Qualitative check only** (no pixel path — see environment note): at the "kit" beat (widest
table shot), a warm glow is visibly baked onto the table wood near the sheet's edge in the JPEG
screenshot, plausibly positioned per `LAMP_WORLD=(-9,-8.8)` being just off the sheet's negative-x
edge. I could not get the required numeric peak-to-corner delta (≥40/255), centroid-parallax
percentage, or night-ladder delta (≤8/255) — **all UNTESTED, pixel path unavailable.** The
"pool exists and looks plausibly placed" qualitative read is a **PASS on vibes only**; I would
not treat this as closing the issue's actual acceptance criteria.

## Issue 5 — split unlit/toon value system

**Structural check (exact, code-based)**:
`grep -rn "MeshToonMaterial|meshToonMaterial|gradientMap|MeshStandardMaterial|MeshPhongMaterial|MeshLambertMaterial"`
across `site/src` returns **zero live usages** — only historical comments documenting the old
bug (`Diorama.tsx:123,279,619,647`, `TableScene.tsx:67`). **PASS**, matches the plan's fallback
test exactly (no `window.__scene` handle exists to run the live-traverse variant either — same
grep fallback the plan itself anticipates).

`assertNightRatiosDoNotBlowOut` exists at `Diorama.tsx:360` as a module-scope IIFE. It runs at
import time; since the app renders correctly with zero console errors across a full 9-beat walk
(see cross-cutting section), it did not throw. **PASS by non-crash**, not by inspecting its
actual computed ratios (would need to read the tint tables and hand-verify, not done — time
budget).

Remaining lights: exactly one `<pointLight>` JSX element remains in the whole `src/scene` tree
(`Diorama.tsx:1046`, `swapRiseLightRef`). `SightSweep.tsx` and `TableScene.tsx` both carry
comments confirming their former point lights were deleted. `ambientLight`/`directionalLight`:
zero matches. `shadows="percentage"` and `castShadow`/`receiveShadow`: zero live matches (only a
removal comment in `Canvas3D.tsx:38`). **PASS**, matches "ALL dead lights deleted" from the
build summary.

Per-surface tint match (5 surfaces within 4/255), nine-beat luminance stability, blow-out
pixel check, and `gl.info.render.calls` before/after: **all UNTESTED** — pixel/scene-handle
path unavailable.

## Issue 6 — x-ray ghosting on crates

**Structural check (exact)**: `Diorama.tsx` shows the exact mechanism the plan specifies at all
four prop sites (crate stack, bone pile, vault, brazier) —
`groupRef.current.visible = riseT > 0; groupRef.current.scale.y = easeSettle(riseT);`
— and `alphaHash`/`transparent`/`mat.opacity = riseT` on body materials are gone from those
call sites (only present on the ground-decal contact-shadows, which the plan explicitly says to
leave alone). This is a clean, correct implementation of the documented fix. **PASS by code
reading.**

**Qualitative screenshot** at the beat-hero pin, `riseT≈0.5` (found by reverse-engineering the
raw-progress-to-riseT windowing from the plan's own stated baseline `scrollY=2713` — riseT is
front-loaded to reach 1 well before the pin's raw progress does, not a linear 1:1 with scroll):
visible crate/chest props in frame read as solid, opaque brown shapes, not speckled/dithered.
No obvious x-ray artifact on what's in frame. Some peripheral geometry in an adjacent,
not-yet-active room reads as flat translucent gray — I could not determine from a JPEG whether
that is a genuine residual issue or just normal unlit shading on geometry outside the current
beat's spotlight (plausible given issue 5 deleted all lights, so anything not specifically
tinted now renders flat). **Flagging as a CONCERN worth a follow-up look with real pixel
access, not a confirmed defect.**

Histogram bimodality, interior-edge detection, and the dpr-1.25-mandatory repeat: **all
UNTESTED** — pixel path unavailable, and this is the one test the plan calls "mandatory" at dpr
1.25, so this is a real gap, not a minor omission.

## Issue 7 — night heading contrast on beat 5

This is the one issue fully verifiable without pixel capture — text colour and background
colour are both deterministic functions of CSS custom properties, read via `getComputedStyle`
and cross-checked against the source formulas (`SceneRenderer.tsx:270-291`).

**Deviation from the plan, intentional and documented**: the shipped fix does **not** ramp on
raw `--night-t`. It introduces a second, front-loaded variable `--night-t-copy = 1-(1-nightT)^3`
(cubic ease-out) specifically because a linear ramp under-shot 4.5:1 at mid-scrub (documented in
`global.css:330-341` and `SceneRenderer.tsx:280-289`, with the builder's own measured numbers:
"a linear mix under-shot 4.5:1 at mid-scrub... 1.79:1/3.69:1"). This is a reasonable, well-argued
change of mechanism that still respects every rule in the plan (neutral endpoints only, no
accent, `data-beat` scoping via `App.tsx:65`).

**Measured** (scrolled to the exact `worldP` positions via each pin's own raw-progress offset,
`--night-t`/`--night-t-copy` and `getComputedStyle(...).color` read live in the same call, then
OKLab→sRGB→WCAG-contrast computed in a local Node script — verified to reproduce the plan's own
cited baseline numbers to within rounding):

| worldP | nightT | h2 contrast | .sub contrast | .voice contrast |
|---|---|---|---|---|
| 0.30 | 0.001 | 1.27 : 1 | 1.46 : 1 | 2.12 : 1 |
| 0.50 | 0.287 | 5.07 : 1 | **4.43 : 1** | 5.06 : 1 |
| 0.65 | 0.500 | 10.05 : 1 | 6.74 : 1 | 7.02 : 1 |
| 0.80 | 0.714 | 13.53 : 1 | 8.18 : 1 | 8.25 : 1 |

h2 numbers match the builder's claimed 1.27 / 5.01 / 10.06 / 13.53 essentially exactly (my
independent OKLab math reproduces theirs to within ~0.06, the expected size of rounding
differences between two independent conversions).

**Finding — `.sub` at worldP=0.50 measures 4.43:1, under the plan's own non-negotiable 4.5:1
floor.** It's a small miss (0.07 short) and inside my own cross-check's rounding tolerance, but
the plan states the 4.5:1 bar is "non-negotiable" for `.sub`/`.voice` and the builder's own report
did not surface this sample (only h2 numbers were quoted). Worth a second, pixel-exact
measurement before calling issue 7 fully closed — **CONCERN, not outright FAIL**, given the
margin is within my measurement's own uncertainty band.

**worldP=0.30 (the known, accepted fail)**: measured exactly as predicted —
`nightT=0.001`, both night variables pinned near 0 by the pre-existing `clockT` re-windowing
(`clamp((worldP-0.3)/0.7, 0, 1)`, which is 0 at worldP=0.30 by construction). h2 1.27:1, sub
1.46:1, voice 2.12:1 — all far below 4.5:1, confirming no night-ramp can lift this sample, as the
task brief already stated. **What a reader actually experiences**: `--copy-v` was `1` at this
sample (copy fully visible, not mid-fade), so the heading is on-screen and rendered but reads at
near-invisible contrast against the dark scene for the portion of the beat-5 scrub between
worldP 0 and ~0.3 (raw pin progress ≈0–0.3 of a 775px-tall pin at the tested window size, i.e.
roughly the first quarter of the beat's own scroll distance, ~230px of scroll at this viewport).
Handing this to the adjudicator as-is — it is squarely the pre-existing `clockT` windowing
issue 7 was told not to touch.

**Day-beat regression (test 2)**: sampled visible `h2` colour at three day beats
(scrollY 1500, 4650, 7000) — all `rgb(22, 24, 15)` = `#16180f` = `--ink` exactly, `--night-t-copy`
reads `0.000` throughout. **PASS, exact match.**

**No accent creep (test 3)**: ramp endpoints are `--ink`/`--text` and `--ink-mut`/`--text-2` and
`--goblin-ink`/`--text-2` per source — all documented neutrals or a controlled brand-hue-to-neutral
ramp, never the raw `--goblin` accent. **PASS by source inspection.**

**No-JS path (test 4)**: not run live (no JS-disable capability in this session), but provable
from source: `var(--night-t-copy, 0)` falls back to `0` when the property is never set (no-JS ⇒
no `SceneRenderer`), so `color-mix(..., 0%)` reduces to the first colour, `--ink` — **PASS by
source inspection.**

**dpr 1.25 repeat (worldP=0.80)**: re-measured on the second monitor (dpr 1.25, window resized
to ~1862×698 — could not hit the exact 1484×775 target on that monitor due to window-snap
non-determinism, documented above). `nightT=0.713` (vs 0.714 at dpr 1) and all three OKLab
outputs matched the dpr-1 sample to 4 decimal places. **PASS — no dpr sensitivity**, expected
since this is a pure CSS custom-property computation.

## Issue 9 — remove the `window.__lenis` QA hook

- `grep -rn "__lenis" site/dist/assets/` → **0 matches**. **PASS.**
- Built bundle (`localhost:5180`): `typeof window.__lenis === 'undefined'`. **PASS.**
- Dev server: `typeof window.__lenis === 'object'`, and `delete window.__lenis` is present in the
  matching cleanup, both gated on `import.meta.env.DEV`. **PASS.**
- Native-scroll parity: `window.scrollTo(0,4200)` + 600 ms settle on the built bundle produced
  `--copy-v = [0,0,1,0,0,0,0]`, consistent with the dev-server behavior pattern observed earlier
  in this session at the same scrollY/window-size relationship (beat-index-2 copy active). Not a
  byte-for-byte side-by-side diff against a simultaneously-open dev tab — **PASS with a caveat**,
  reasonably strong but not the strictest form of the test.

## Issue 10 — defer/inline the render-blocking CSS

Against the built bundle on `localhost:5180`, fresh reload, network requests captured:

- `document.querySelectorAll('link[rel="stylesheet"]').length === 0`,
  `document.querySelectorAll('style').length === 2`. **PASS**, exact match to acceptance test 1.
- `performance.getEntriesByType('resource')` — zero `.css` entries. **PASS.**
- `document.fonts.check('500 48px Newsreader')` → `true`; `document.fonts.status === 'loaded'`.
  Network log: 8 `.woff2` requests, **all `statusCode: 200`, zero 404s**. **PASS.**
- `dist/index.html`: 58,384 B raw / 15,593 B gzip (build-summary claim was 58,150/15,547 —
  matches within noise of a re-build). Gzip is under the 20 kB ceiling. **PASS.**
- FOUC frame-by-frame scan, 5-load FCP median before/after, no-JS styled-render check, and
  reduced-motion path: **all UNTESTED** — no throttled video-capture capability and no JS-disable
  toggle available in this session.

## Cross-cutting regressions

- **Console**: read from a fresh listener across a full scripted walk of all 9 beats (scroll to
  the middle of every pin spacer, then to max scroll, then back to 0) on the dev server. **Zero
  errors.** One warning, the pre-existing and explicitly-allowed `THREE.Clock` deprecation
  notice. **PASS.**
- **Loader hand-off**: not specifically re-verified frame-by-frame (needs the same pixel path
  that's unavailable), but the loader clears normally on every one of the 5 reload cycles run for
  issue 1 (spacer count reaches 9, `data-gg-loading` clears, `scrollHeight` stable) with no
  visible hang or console error. **No evidence of a broken hand-off; not rigorously tested for
  the specific "invisible swap" pixel claim.**
- **Beat-4 dual-pane** (cross-checked incidentally while reproducing issue 3): at the one aspect
  that reproduces cleanly (1.94), both panes show identical scale/framing and the amber divider
  glow (`.pane-divider`) is clearly present and lit in the screenshot. At the two aspects where
  issue 3 fails, the composition is still symmetric between panes (both clip identically), so
  this specific regression path (asymmetric panes) does **not** appear to be present — the panes
  fail together, not independently.
- **`swapRiseLightRef` pointLight** (`Diorama.tsx:1005-1047`, "left in place as out-of-scope"):
  confirmed **functionally dead**, not merely redundant. Its own comment
  (`Diorama.tsx:998-1004`) states its purpose is to give the incoming swap map its own warm fill
  light because "WorldTurns' shared ambient/sun are already night-dim by this point" — but issue
  5 deleted every ambient/directional light globally and converted every material to
  `MeshBasicMaterial`, which **ignores all scene lights, point lights included**. The code still
  runs every frame (`swapRiseLightRef.current.intensity = sceneProgress.swapT * SWAP_RISE_LIGHT_INTENSITY`)
  and the light object still exists in the scene graph, but nothing in the scene can render its
  effect any more. It's genuinely dead, not just out-of-scope — worth a follow-up deletion pass
  alongside issue 5's other light removals rather than leaving it as a silent no-op.

---

## Summary

| Issue | Verdict | Key numbers |
|---|---|---|
| 1 | PASS (partial — no throttling available) | 5/5 unthrottled reloads clean, spacers=9, scrollHeight delta=0 |
| 2 | PASS (scrollbar-drag sub-test untested) | PageDown×3 and End/Home exactly match `scrollTo` equivalents |
| 3 | **FAIL** | Outer walls fully clipped at aspect 1.31 and 1.45, both well inside the claimed-fixed 1.05–1.6 range; root cause: shipped `setPathAspect(aspect)` drops the height term the plan's own math requires |
| 4 | UNTESTED (pixel path unavailable) | Code matches spec exactly; qualitative screenshot plausible |
| 5 | PASS (structural) | 0 lit-material matches, 1 pointLight left (dead, see below), assertion doesn't throw |
| 6 | PASS (structural), pixel tests untested | Mechanism matches spec exactly at all 4 props; one peripheral-geometry visual worth a follow-up look |
| 7 | PASS with one CONCERN | h2 1.27/5.07/10.05/13.53:1 across worldP 0.30-0.80; `.sub` at worldP=0.50 measures 4.43:1, just under the 4.5:1 floor |
| 9 | PASS | 0 `__lenis` matches in dist, undefined on preview, object in dev |
| 10 | PASS (video/no-JS sub-tests untested) | 0 stylesheet links, 2 style tags, 0 CSS resource entries, 0 font 404s, gzip 15.6 kB |

**Overall: not ready to ship as-is.** Issue 3 has a real, reproducible regression (clipping
still happens well inside its claimed-fixed range) that should go back to scope A. Issue 7 has
one marginal contrast miss worth a precise re-check. Everything else that could be verified came
back clean; a meaningful fraction of the plan's own acceptance numbers (pixel luminance,
histograms, per-surface tint deltas, FOUC frame scans) could not be captured in this environment
and are marked untested above rather than assumed passing.

**Screenshots**: all captures in this session were JPEG (the `computer`/`zoom` tools) or
misaligned/unusable PNG attempts (`CopyFromScreen`, saved to a session scratchpad directory as
`beat7-kit*.png` — kept on disk for reference but not usable as colour evidence per the PNG-only
rule). No screenshot in this report should be treated as a source of pixel-exact colour data;
only the issue-7 numbers (DOM/CSS derived) and the issue-3 clipping observation (binary
presence/absence of a wall, not a pixel measurement) are treated as hard evidence above.
