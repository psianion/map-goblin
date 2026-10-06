# Scroll-tick analysis — landing page (site/)

Date: 2026-08-11
Scope: analysis only. No code changed.

## Measurement conditions

| | |
|---|---|
| URL | `http://localhost:5179` (running dev server) |
| Viewport | 1920 × 855 CSS px, `devicePixelRatio` 1, page zoom 100% |
| `document.hidden` | asserted `false` inside every measuring call |
| `prefers-reduced-motion` | `false` (the Lenis/ScrollTrigger path, not the IntersectionObserver fallback) |
| `document.scrollHeight` | 15390 |
| max scroll y | 14535 |
| `.pin-spacer` count | 9 (waited for) |
| Wheel tick | synthetic `WheelEvent{deltaY:100, deltaMode:0}` on `window`, settle window 1250 ms |
| Frame counter | live WebGL context's `gl.clear` patched to increment a counter — `frameloop="demand"`, so a tick that renders 0 frames genuinely changed nothing in the 3D scene |
| Progress source | the real `sceneProgress` singleton, reached via `await import('/src/scene/sceneProgress.ts')` (Vite dev module cache returns the same instance), plus the DOM proxies (`--copy-v`, `--night-t`, `.scrub` opacity, `.scrub-fill` width, `.pane-tags` opacity) |

Lenis response to one tick, measured: target jumps to exactly +100 px on dispatch;
`lenis.scroll` is 0 px at t=0, **69.9 px at t=200 ms**, 100 px by t≈1.5 s. Smoothing is
real but sub-second and monotonic — it is **not** the mechanism behind the dead start.

## Page geometry (measured, not derived)

Every `.beat` is `min-height: 100svh` (`site/src/styles/global.css:168-170`) and every
ScrollTrigger is `start:'top top', end:'+=100%'` with default `pinSpacing`
(`site/src/scene/ScrollCamera.tsx:171` and `:186-191`). So each pin-spacer is
`sectionHeight (855) + pinDuration (855) = 1710 px`, and the spacers tile at a
**1710 px pitch = 2 × viewport height**:

```
spacer tops: 0, 1710, 3420, 5130, 6840, 8550, 10260, 11970, 13680   (all h = 1710)
```

The trigger only owns the **first half** of each spacer. The second half — 855 px —
belongs to no trigger at all.

---

## 1. Per-wheel-tick map from y = 0

Tick *n* lands at y = 100 n exactly (measured, every tick). `copy` is the `--copy-v`
array in DOM order: `[whisper, ink, sight, trust, world-turns, scenes, kit]`.

| tick | settled y | active section | ScrollTrigger phase | progress values that changed | frames rendered | what visibly changed |
|---|---|---|---|---|---|---|
| 0 | 0 | 0 whisper | whisper pin, p=0.000 | — | — | baseline: whisper line on the empty sheet |
| 1 | 100 | 0 whisper | whisper pin, p=0.117 | **none** | **0** | **nothing** |
| 2 | 200 | 0 whisper | pin p=0.234 | none | 0 | nothing |
| 3 | 300 | 0 whisper | pin p=0.351 | none | 0 | nothing |
| 4 | 400 | 0 whisper | pin p=0.468 | none | 0 | nothing |
| 5 | 500 | 0 whisper | pin p=0.585 | none | 0 | nothing |
| 6 | 600 | 0 whisper | pin p=0.702 | none | 0 | nothing |
| 7 | 700 | 0 whisper | pin p=0.819 | none | 0 | nothing |
| 8 | 800 | 0 whisper | pin p=0.936 | none | 0 | nothing — screenshot at y=850 is pixel-identical to y=0 |
| 9 | 900 | 0 whisper unpinned | **gap** | none | 0 | first movement on screen: the whisper paragraph starts sliding up. DOM only — the canvas is frozen |
| 10 | 1000 | gap | gap | none | 0 | whisper keeps sliding up |
| 11 | 1100 | gap | gap | none | 0 | " |
| 12 | 1200 | gap | gap | none | 0 | " |
| 13 | 1300 | gap | gap | none | 0 | " |
| 14 | 1400 | gap | gap | none | 0 | whisper gone; ink section in frame but its copy is `--copy-v:0` |
| 15 | 1500 | gap | gap | none | 0 | blank: sheet on wood, no copy anywhere |
| 16 | 1600 | gap | gap | none | 0 | blank |
| 17 | 1700 | gap (ends 1710) | gap | none | 0 | blank — screenshot-verified: empty sheet, zero text on screen |
| **18** | **1800** | 1 ink | **ink pin p=0.105** | `inkT 0 → 0.105` | **76** | **first 3D change of the entire page** — wall footprints begin inking in |
| 19 | 1900 | 1 ink | p=0.222 | `inkT → 0.222` | 76 | more wall ink |
| 20 | 2000 | 1 ink | p=0.339 | `inkT → 0.339`, `copy[ink] 0 → 0.16` | 76 | "You draw the map." starts fading in |
| 21 | 2100 | 1 ink | p=0.456 | `inkT → 0.456`, `copy[ink] → 0.62` | 76 | headline nearly readable, walls ~half inked |

### Verdict on complaint (a)

- **Ticks 1–8 (y 0 → 855, 5.9 % of the page): literally nothing changes.** Zero frames,
  zero progress writes, and two screenshots (y=0, y=850) that are identical. The whisper
  section is pinned by a trigger that has **no `scrub` and no `onUpdate`**
  (`site/src/scene/ScrollCamera.tsx:170-172`), so 855 px of scroll drive nothing.
- **Ticks 9–17 (y 855 → 1710): the DOM moves, the scene does not.** Still 0 frames. This
  is the "randomly starts moving" moment — what starts moving is the HTML paragraph
  scrolling out of a fixed canvas that has not repainted since load.
- **First scene motion: tick 18, y = 1710.** 17 wheel ticks / 1710 px / 11.8 % of the
  page's scroll before the diorama moves at all.

The complaint's "roughly 6 scrolls" maps to the 8.5-tick pinned block (a mouse whose
notch is 120–150 px instead of 100 px hits it in 6–7). The number scales with viewport
height: dead pin = exactly 1 vh, first scene motion = exactly 2 vh.

---

## 2. Full beat table

`t` is the camera path parameter, `setT((i + self.progress) / segments)` with
`segments = 8` (`site/src/scene/ScrollCamera.tsx:193-194`, `:49`).
Percentages are of max scroll (14535 px).

| # | section | own pin (px) | % | camera t | progress var driven | dead gap after (px) | % |
|---|---|---|---|---|---|---|---|
| 0 | whisper | 0 – 855 | 5.9 | **frozen at 0** | **none** | 855 – 1710 | 5.9 |
| 1 | ink | 1710 – 2565 | 5.9 | 0 → 0.125 | `inkT` 0→1 | 2565 – 3420 | 5.9 |
| 2 | the rise (hero) | 3420 – 4275 | 5.9 | 0.125 → 0.25 | `riseT` 0→1 | 4275 – 5130 | 5.9 |
| 3 | sight | 5130 – 5985 | 5.9 | 0.25 → 0.375 | `sightT` 0→1, `sightActive` | 5985 – 6840 | 5.9 |
| 4 | trust | 6840 – 7695 | 5.9 | 0.375 → 0.5 | `trustT` 0→1, `trustActive` | 7695 – 8550 | 5.9 |
| 5 | **the world turns** | **8550 – 9405** | 5.9 | 0.5 → 0.625 | **`clockT` 0→1**, `worldActive` | 9405 – 10260 | 5.9 |
| 6 | the swap | 10260 – 11115 | 5.9 | 0.625 → 0.75 | `swapT = clamp(p/0.45)` | 11115 – 11970 | 5.9 |
| 7 | the kit | 11970 – 12825 | 5.9 | 0.75 → 0.875 | `kitT` 0→1 | 12825 – 13680 | 5.9 |
| 8 | the door | 13680 – 14535 | 5.9 | 0.875 → 1 | none | — (max scroll) | — |

**Scroll budget: 6840 px (47.1 %) drives the scene. 7695 px (52.9 %) drives nothing.**
Measured directly: four wheel ticks inside the beat-4→beat-5 gap (y 7800→8200) rendered
**0 frames** and changed **0** progress values; three ticks inside beat 5's pin rendered
114 / 84 / 76 frames.

### What actually plays on screen, per beat

The copy contract (`site/src/scene/sceneProgress.ts:66-69`) is: own copy fades in over
own `T` 0.30 → 0.55, holds, dissolves over the *next* beat's `T` 0.50 → 0.75.
Consequence, uniform across every beat:

| own T | on screen |
|---|---|
| 0.00 – 0.30 | the beat's picture animates with **no headline at all** (the previous beat's copy has already scrolled off during the 855 px gap) |
| 0.30 – 0.55 | headline fading in over an already ~half-played picture |
| 0.55 – 1.00 | readable |

Screenshot-verified at two boundaries: y=1700 (empty sheet, no text) and y=8550
(full dual-pane split, no text).

### Beat 5 — `clockT` in detail (the midday bug)

Curve as authored: `clockT = self.progress`, linear 0→1 across the pin
(`site/src/scene/ScrollCamera.tsx:211`). The scrub widget's own labels
(`site/src/App.tsx:83-88`) measure to: **dawn 4.1 %, noon 34.0 %, dusk 63.9 %,
23:40 94.8 %** of the track. `.scrub-fill` width and `.scrub-thumb` left are set to
`clockT × 100 %` (`ScrollCamera.tsx:83-86`), so the thumb's position *is* the clock.

Measured sweep:

| y | clockT | `.scrub` opacity | `.pane-tags` opacity (split) | world-turns `--copy-v` | `--night-t` | floor grade `frontLoad(clockT)` | what the viewer sees |
|---|---|---|---|---|---|---|---|
| 7695 – 8400 | 0.000 | 0 | 1.00 | 0 | 0.000 | 0.000 | beat 4's split, sliding up; then no copy at all |
| 8550 (pin start) | 0.000 | 0 | 1.00 | 0 | 0.000 | 0.000 | **still the dual-pane split. Clock UI invisible. No headline.** |
| 8636 | 0.101 | 0.50 | 0.50 | 0 | 0.101 | 0.271 | split half-closed, scrub track ghosting in |
| 8721 | 0.200 | **1.00** | **0.00** | 0 | 0.200 | 0.488 | split gone; scrub appears **with the thumb already at 20 %** — past dawn |
| 8807 | 0.301 | 1 | 0 | **0.00 → fading** | 0.301 | 0.657 | headline starts to appear; **thumb sits on the "noon" label (34 %)** |
| 8892 | 0.400 | 1 | 0 | 0.40 | 0.400 | 0.784 | headline half in, map already cool |
| 9021 | 0.551 | 1 | 0 | **1.00** | 0.551 | **0.909** | **"Night falls on schedule." fully readable — thumb between noon and dusk, floor grade 91 % of the way to night** |
| 9405 (pin end) | 1.000 | 1 | 0 | 1.00 | 1.000 | 1.000 | 23:40 |

Screenshot-verified at clockT 0.000 (split panes, no copy), 0.301 (single map, thumb at
30 %, map already noticeably cooled), 0.551 (headline in, map fully night-graded).

**So: the animation curve defines dawn → 23:40 across the pin. The sub-range the viewer
can actually read the beat over is clockT ≈ 0.30 → 1.00, and the sub-range where the
beat is unambiguously "on" (split gone, clock UI visible) is 0.20 → 1.00. The first
20–30 % of the declared day — dawn through noon — plays behind a closing dual-pane split
on a screen with no headline on it. That is the reported "starts at midday".**

---

## 3. Root cause

Four candidate mechanisms were separated by measurement. Two are causes, two are not.

### CAUSE 1 — the whisper pin is a scrub-less 1 vh pin

`site/src/scene/ScrollCamera.tsx:170-172`

```ts
const whisperTrigger = sections[0]
  ? ScrollTrigger.create({ trigger: sections[0], start: 'top top', end: '+=100%', pin: true })
  : null;
```

No `scrub`, no `onUpdate` — therefore no `setT`, no `invalidate()`, and under
`frameloop="demand"` no frame. Measured: 855 px / 8.5 ticks / 0 frames / 0 progress
writes / pixel-identical screenshots. The comment above it explains why the pin exists
(stopping section 1 from bleeding up into the held void), which is a real problem — but
the fix bought 855 px of frozen page at the exact moment a first-time visitor tests
whether the page responds.

### CAUSE 2 — `pinSpacing` doubles every section's scroll cost, and the trigger owns only half

`site/src/styles/global.css:168-170` (`.beat { min-height: 100svh }`) plus
`site/src/scene/ScrollCamera.tsx:186-191` (`start:'top top', end:'+=100%'`, default
`pinSpacing: true`).

The spacer is `sectionHeight + pinDuration = 855 + 855 = 1710`. The pin occupies
`[top, top+855]`; the section then scrolls normally over `[top+855, top+1710]` while the
next section slides in. Nothing is bound to that second 855 px. Measured pitch confirms
it exactly (spacer tops 0, 1710, 3420, …). Eight such gaps × 855 px = 6840 px, every one
of them 0 frames.

The dead start is the **sum of cause 1 and the first instance of cause 2**:
855 (whisper pin) + 855 (gap 0) = 1710 px before `inkT` moves.

### CAUSE 3 — front-of-`clockT` is spent on the *previous* beat's teardown

`site/src/scene/SceneRenderer.tsx:279`

```ts
const trustGlow = sceneProgress.trustT * (1 - Math.min(1, sceneProgress.clockT / 0.2));
```

`trustT` is latched at 1 from beat 4 onward, so this is `1 - clockT/0.2`: the dual-pane
split, the pane tags, the trust vignette, the divider and the scissor render
(`SceneRenderer.tsx:280-312`) all close over **clockT 0 → 0.2**. And the clock's own
widget rides the inverse — `SceneRenderer.tsx:293`:

```ts
if (scrub) scrub.style.opacity = String(1 - trustGlow);   // == clockT / 0.2
```

so the dawn end of the time scrub is invisible by construction. Measured: `.scrub`
opacity 0 at clockT 0, 0.5 at 0.101, 1.0 at 0.200.

### CAUSE 4 — the global copy fade window pushes legibility to 55 %

`site/src/scene/sceneProgress.ts:66-67` (`FADE_START = 0.3`, `FADE_DONE = 0.55`), applied
per beat by `ScrollCamera.tsx:56-64`. For a beat whose picture *is* a clock, "copy is
readable at 55 % of the picture" means "the headline arrives in the afternoon".
Also produces the ~600 px headline-free window at every beat boundary (the gap plus the
first 30 % of the next pin).

Amplifier: `Diorama.tsx:337-340` `frontLoad(t) = 1-(1-t)^3` deliberately front-loads the
floor/border night grade, so the *largest* value swing lands in exactly the sub-range
that is hidden: `frontLoad(0.2) = 0.488`, `frontLoad(0.3) = 0.657`, `frontLoad(0.55) = 0.909`.
Half the night grade is spent under the split.

### RULED OUT — non-pinned intro sections

None exist. `.pin-spacer[0].offsetTop === 0`; `<Hero>` renders only the fixed canvas,
`.stage-lamp` / `.grain` / `.brand` are fixed or zero-height. No scroll is consumed
before the first pin. Not a contributor.

### RULED OUT — Lenis smoothing lag

Measured per tick: target +100 px immediately, 69.9 % of the distance travelled at
200 ms, settled by ~1.5 s. That is a normal smooth-scroll feel and it moves the value on
every tick. The first 17 ticks render 0 frames whether Lenis is settled or not, and
`immediate:true` jumps to the same positions produce the same zero. Not a contributor.

### RULED OUT — ScrollTrigger start offsets

Every trigger in the file uses the same `start: 'top top'` with no offset and
`end: '+=100%'` (`ScrollCamera.tsx:171`, `:189-190`). No `scrub` smoothing number is set
(`scrub: true` = direct, no catch-up). Nothing is offset or lagged at the trigger level.
Not a contributor.

### On `frameloop="demand"`

Not a bug — it is the honest instrument here. `setT` is the only caller of `invalidate()`
on the scroll path (`ScrollCamera.tsx:95-99`), and it is only reached from a scrubbing
`onUpdate`. "0 frames rendered" is therefore an exact statement that no progress value
moved. Every dead range in this report was confirmed both ways (0 frames **and**
unchanged `sceneProgress`).

---

## 4. Ranked fix list

### F1 — Re-window `clockT` so dawn lands when the beat becomes visible *(fixes the reported midday bug; smallest diff)*

`site/src/scene/ScrollCamera.tsx:210-221`. The file already has the exact pattern one
line below, for `swapT` (`:225`).

The catch: `SceneRenderer.tsx:279` and `:293` read `clockT` as the *pin's raw progress*
to close the split and reveal the widget. Remapping `clockT` alone would break the split
close. Minimal correct shape:

1. Add a raw field, e.g. `worldP: number`, to `sceneProgress` (`sceneProgress.ts:5-38`;
   note `BeatProgressKey` is derived from the numeric fields, so a new numeric field
   becomes a legal copy key — harmless, but check `COPY_KEYS` is unaffected).
2. In `ScrollCamera.tsx` (`i === 4`): `sceneProgress.worldP = self.progress;` and
   `sceneProgress.clockT = THREE.MathUtils.clamp((self.progress - 0.3) / 0.7, 0, 1);`
3. Point `SceneRenderer.tsx:279` and `:293` at `worldP` instead of `clockT`.
4. `setScrub()` keeps riding `clockT`, so the thumb starts at 0 exactly when the widget
   becomes visible.

Expected effect: split closes and the scrub widget appears while the thumb is still at
**dawn**; the full dawn→23:40 sweep then plays across the 599 px where the headline is
fading in and readable. `frontLoad`'s front-loaded grade also lands on-screen instead of
under the split.

Cheaper variant if `worldP` is unwanted: leave `clockT` alone and instead move the split
close off `clockT` entirely — close it on `trustT`'s own tail (`trustT > 0.85`) or on
beat 4's `onLeave`. Then step 2's remap can use `/0.8` instead of `/0.7`. Same result,
one fewer field, slightly more risk of reintroducing the N1/R2/C2 seam the current code
was written to avoid — read those comments (`SceneRenderer.tsx:263-300`,
`ScrollCamera.tsx:210-221`) before choosing.

### F2 — Give the whisper pin a job, or delete it *(fixes ~half the reported dead start)*

`site/src/scene/ScrollCamera.tsx:170-172`.

- **Preferred:** add `scrub: true` and an `onUpdate` that calls `setT()`. The camera path
  currently spends keyframes 0→1 over beat 1's pin; hand the whisper pin the first slice
  of it (e.g. `setT(self.progress * 0.5 / segments)` and let beat 1's trigger start at
  `0.5/segments`), or drive a dedicated pre-beat (a slow descent, the sheet's ambient
  settle). Anything that calls `setT` will `invalidate()` and repaint.
- **Cheaper:** `end: '+=25%'` — cuts the frozen block from 855 px to 214 px (~2 ticks).
- **Cheapest:** delete the trigger. Re-check the bleed-back problem its comment
  documents (`:161-169`) before taking this.

Expected effect: wheel tick 1 produces a visible frame.

### F3 — Close the 855 px inter-beat gaps *(structural; recovers 47 % of the page)*

`site/src/scene/ScrollCamera.tsx:171` and `:186-191` + `site/src/styles/global.css:168-170`.

- **Option A (smallest diff):** add `pinSpacing: false` to every pin. Spacers collapse to
  the section's own 855 px, pins become contiguous, doc height halves (15390 → ~7695), and
  every wheel tick from y=0 to the end drives a scrub. **Must be verified visually:** with
  `pinSpacing:false` the following section scrolls *over* the pinned one instead of after
  it, so the two beats' `.copy-scrub` blocks will overlap on screen during the handoff.
  The existing crossfade contract (F4) largely covers this, but it changes the look.
- **Option B (preserves the current look, more code):** keep `pinSpacing`, add a second
  non-pinning `ScrollTrigger` per section covering the gap (`start:'bottom top'`-ish,
  `scrub:true`) that continues the camera scrub from `(i+1)/segments` toward the next
  keyframe. The camera then never freezes; the copy handoff stays exactly as it is today.
- **Option C (do nothing structural, just shrink it):** `.beat { min-height: 60svh }`
  shortens each gap to 513 px. Cheap, partial, changes composition.

Expected effect for A/B: no wheel tick anywhere on the page renders 0 frames.

### F4 — Pull the copy fade window forward

`site/src/scene/sceneProgress.ts:66-69`. `FADE_START 0.3 → ~0.05`,
`FADE_DONE 0.55 → ~0.20`. Expected effect: every beat's headline is legible in the first
fifth of its own picture rather than past the halfway point, and the ~600 px of
completely text-free screen at each beat boundary shrinks to ~170 px. Cheap, global,
affects all seven gated beats — worth a visual pass on beats 3/4 (sight, trust), whose
copy is currently timed against the token walk and the pane split.

If F3 Option A is taken, do F4 in the same pass — the crossfade is what makes the
overlapping handoff read as intentional.

### F5 — Minor: `.scrub` opacity has two owners

`ScrollCamera.tsx:92-93` sets `.scrub` opacity to 1 at mount; `SceneRenderer.tsx:293`
then owns it — but only from the first rendered frame, which today is y=1710. Between
mount and y=1710 the widget sits at 1 with no renderer behind it (off-screen, so
harmless). F1 makes `SceneRenderer` authoritative from clockT 0; drop the mount-time
write, or keep it and note that it is only a pre-first-frame default.

---

## Appendix — reproducing

```js
// after the page is idle and the tab is foregrounded:
const m = await import('/src/scene/sceneProgress.ts'); window.__sp = m.sceneProgress;
const cv = document.querySelector('canvas'); const gl = cv.getContext('webgl2');
window.__frames = 0; const o = gl.clear.bind(gl); gl.clear = (...a) => { window.__frames++; return o(...a); };

// one real wheel tick:
const f0 = window.__frames;
window.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, deltaMode: 0, cancelable: true, bubbles: true }));
await new Promise(r => setTimeout(r, 1250));
({ y: window.__lenis.scroll, frames: window.__frames - f0, sp: { ...window.__sp } });
```

Everything in sections 1–3 above came out of that harness; the three screenshot
checkpoints were y=0 / y=850 / y=1700 for the dead start and clockT 0.000 / 0.301 / 0.551
for the clock beat.
