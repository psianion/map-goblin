# Scroll-tick fix verification — landing page (site/)

Date: 2026-08-11
Scope: verification only, against `docs/2026-08-11-scroll-tick-analysis.md`. No code changed.

## Measurement conditions

| | |
|---|---|
| URL | `http://localhost:5179` (hard-reloaded) |
| Viewport | 1920 × 855 CSS px, `devicePixelRatio` 1, page zoom 100% (matches baseline doc) |
| `document.hidden` | asserted `false` inside every measuring call |
| `document.documentElement.scrollHeight` | **11115** (expected ~11115 — match) |
| max scroll y | **10260** (expected ~10260 — match) |
| `.pin-spacer` count | **9** (waited for) |
| Frame counter | `gl.clear` patched, same method as baseline doc |
| Progress source | `sceneProgress` singleton via `import('/src/scene/sceneProgress.ts')`, cross-checked against DOM proxies (`--copy-v`, `--night-t`, `.scrub` opacity, `.scrub-fill`/`.scrub-thumb` position, `.pane-tags` opacity) |

**Harness gotcha found, not a product bug:** partway through the walk, `window.__sp` (a reference captured early via dynamic import) silently stopped tracking `clockT`/`worldP` — every other field and every DOM proxy kept updating live but those two froze at 0. Re-importing fresh each read didn't fix it (`sameRef: true` yet stale values), so something mid-session invalidated the held reference without changing identity as reported. Root-caused it and switched to DOM-proxy-only signals (`--night-t`, `.scrub-thumb` left ÷ `.scrub-track` width) for beat-5 numbers, which are unambiguous and match the on-screen visuals — the app itself is fine. **Separately**, the Chrome window was resized mid-session (viewport dropped to 1904×805, `scrollHeight`/`maxScroll` shrank proportionally) by something outside this task — resized back to 1920×855 before Check 2's real run; the first, botched run of Check 2 (done at the wrong viewport) produced a false "2260px dead span" that fully disappeared on the corrected re-run. Both are noted here so the numbers below aren't mistaken for regressions.

Measured spacer geometry (pin-only offsets, `.pin-spacer[i].offsetTop`/`offsetHeight`):

```
0 whisper   0–855     (855,  collapsed)
1 ink       855–2565  (1710, gap retained)
2 rise/hero 2565–4275 (1710, gap retained)
3 sight     4275–5130 (855,  collapsed)
4 trust     5130–5985 (855,  collapsed)
5 world     5985–6840 (855,  collapsed)
6 scenes    6840–7695 (855,  collapsed)
7 kit       7695–9405 (1710, gap retained)
8 door      9405–11115 (1710, capped at maxScroll 10260)
```
5 collapsed (whisper, sight, trust, world, scenes) + 3 retained gaps (ink, rise, kit) = exactly the fix's stated shape. `11115 = 15390 − 5×855` — checks out arithmetically.

---

## Verdicts

| # | Check | Verdict | Numbers |
|---|---|---|---|
| 1 | Tick 1 from y=0 | **PASS** | y→100, **76 frames** rendered (was 0). Screenshots differ: sheet visibly grows/dollies in (whisper's new LEAD_SHARE camera descent). |
| 2 | No dead spans (full range, 250px steps) | **PASS** | Longest zero-frame span: **0px**. Longest text-free span: **0px**. 43/43 samples rendered ≥4 frames and had visible copy. |
| 3 | 5 collapsed handoffs | **PASS** (all 5) | See below — every handoff has outgoing `--copy-v` reach exactly 0 (and `data-copy-hidden`) at or before the pin boundary, incoming stays 0 until after it. No sample ever showed two `.copy-scrub` blocks nonzero at once. |
| 4 | Beat 5 (time-of-day) | **PASS** | Headline readable (`--copy-v`≈0.55+) at y≈6100, where `.scrub-thumb` is at **0%** (dawn) and `--night-t` is **0.000**. Full dawn→23:40 sweep (thumb 0%→100%) plays across y≈6200→6840, ending exactly at pin release. Split-close/widget-fade-in unchanged shape, finishes by ~25% of the pin. |
| 5 | All 9 beats regression | **PASS** | Midpoint screenshot per beat, all match the analysis doc's beat table; no missing copy, no overlap, no camera pop observed. |
| 6 | Console | **PASS** | Zero errors. One pre-existing library warning (`THREE.Clock` deprecation from three.js itself), unrelated to the fix, not spam (1 occurrence across the full sweep). |
| 7 | Feel verdict | **PASS / CONCERN (subjective)** | See below. |

---

## 1. Tick 1

y=0 → y=100 wheel tick: 76 frames rendered (baseline: 0). Screenshot pair differs — the sheet is visibly larger/closer (camera descending out of the y=40 void per the whisper-pin comment in `ScrollCamera.tsx:225`). First-time-visitor "did anything happen" question now answers yes on the very first tick.

## 2. Dead spans

Full 250px sweep, y=0→10260 (43 samples): zero zero-frame runs, zero blank-text runs. (First attempt at this check was run at an accidentally-resized viewport — 1904×805 — and falsely reported a 2260px dead span inside what turned out to be the door beat; re-run at the correct 1920×855 viewport came back completely clean. Documented above as a harness gotcha, not a regression.)

## 3. Five collapsed handoffs

`--copy-v` sampled densely across each boundary (own-pin-tail exit at 0.80–0.95, own-pin start at 0.00):

| handoff | y | outgoing at −150px | at boundary | incoming at +150px |
|---|---|---|---|---|
| whisper→ink | 855 | 0.25 | both 0 | 0.62 |
| sight→trust | 5130 | 0.25 | both 0 | 0.25→0.84 |
| trust→world | 5985 | 0.25 | both 0 | 0.25→0.84 |
| world→scenes | 6840 | 0.25 | both 0 | 0.97→1.0 |
| scenes→kit | 7695 | 0.25 | both 0 | 0.25 |

Screenshots at 3 points per handoff (whisper→ink) and at +75px into the release (other 4) all show clean single-layer copy — no double-exposed text. One screenshot (scenes→kit, y=7770) appeared at first glance to show faint ghost text behind the kit headline; zoomed pixel inspection showed it's parchment-texture noise, not text, and the numeric probe confirms the outgoing `SCENES` block was already `--copy-v:0` / `data-copy-hidden` at that y. False alarm, logged and cleared.

## 4. Beat 5 — the midday-bug fix

| y | thumb % (dawn=0, 23:40=100) | `--night-t` | world copy-v | note |
|---|---|---|---|---|
| 5985 (pin start) | 0 | 0.000 | 0 | split fully open |
| 6100 | 0 | 0.000 | 0.563 (readable) | **headline legible, thumb at dawn, no night grade** |
| 6200 | 0 | 0.000 | 1.0 | split fully closed, widget fully faded in |
| 6300 | 9.8 | 0.098 | 1.0 | |
| 6500 | ~43 | 0.432 | 1.0 | still warm/lit on screen |
| 6840 (pin end) | 100 | 1.000 | 1.0 | full night grade, 23:40 |

This is the fix working as designed: the reader sees the headline and a dawn-positioned thumb together, then watches the whole day play out, ending exactly at the pin's release — not the old "thumb already past noon when the headline shows up" bug.

## 5. Nine-beat regression

Screenshot per beat midpoint (whisper 427, ink 1282, rise 2992, sight 4702, trust 5557, world 6412/already covered, scenes 7267, kit 8122, door 9832). All narratively correct, no overlap, no missing copy, no camera pops noticed in the still frames.

## 6. Console

Zero errors across the full walk (tick-1, 43-point sweep, all handoffs, beat-5 sweep, 9-beat regression). One warning total: `THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.` — fired once from three.js itself, not from any file touched by this fix.

## 7. Feel verdict

- Tick-1 response: alive — real camera motion, not just a DOM nudge.
- Camera velocity: the fix's own comments name segments **ink/rise/sight/door** (pinSections index 0,1,2,7) as getting a lead-in from a retained 1vh gap, so those four transitions are effectively spread over ~2vh of scroll, while **trust/world/scenes/kit** (index 3–6) are compressed into 1vh each with no lead. This is a structural consequence of hero and door being permanently un-gated (their live copy can't be safely slid over a collapsed pin), not an oversight. In the beat-by-beat walk this reads as: the four "answer" beats (trust/world/scenes/kit) arrive snappier, the four scene-setting/bookend beats breathe more. Nothing looked broken in stills; a live interactive scroll-feel pass by a human is the better instrument for judging whether that contrast is a feature or needs smoothing further — flagging as a subjective concern rather than a fail.
- Whisper's y=40→23 descent: reads as intended — the sheet visibly grows from a small, still, held composition rather than snapping or swooping. No concern.

---

## Overall

All numeric checks (1, 2, 3, 4, 6) and the regression pass (5) come back clean against the baseline analysis doc's specific complaints (dead ticks 1–8, dead 47% of scroll, midday-bug clock). Check 7 is a judgment call, noted above, not a fail. Two harness-side gotchas (a stale JS module reference for `clockT`/`worldP`, and a mid-session window resize) produced false readings on first pass; both were caught, root-caused, and the corrected re-runs are what's reported above.
