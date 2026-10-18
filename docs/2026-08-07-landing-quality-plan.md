# Landing page: quality-bar plan (2026-08-07, post fresh-check)

Goal: close the gap between the built site and the planned "$10k agency" bar.
The fresh browser walk found the skeleton (typography, voice, camera, perf) at
bar and roughly half the beats' pictures below it. This plan covers: the grain
defect, an art-direction fork the user opened (dark dungeon vs lit-table), the
structural fixes that hold in either direction, and the art pass that follows
the fork decision. Quality bar is the gate at every phase — no fix ships on
"technically closed"; it ships on "reads like the mockup frame".

## 0. Why everything looks grainy (diagnosis, confirmed in code)

Three grain systems are stacked, and one of them is mathematically wrong:

1. **PostFX shader grain is applied in linear space, before the sRGB encode**
   (`site/src/scene/PostFX.ts`). `grain = (hash − 0.5) × 0.025` is added to the
   linear color, *then* `linearToSRGB` runs. Near black, the gamma curve
   amplifies brutally: a +0.0125 linear speckle on a black pixel encodes to
   ~11% grey (≈ #1E1E1E on #0B0A08). On a mostly-dark page that is TV static,
   not film grain. It is also re-hashed every frame (`time` in the hash), so it
   shimmers.
2. **CSS `.grain` overlay** (feTurbulence, opacity .05, overlay blend) on top
   of the whole page — the intended "paper" texture.
3. **Baked per-texture speckle** in every floor/wall canvas texture
   (`textures.ts`), including the green moss dots already flagged.

Fix (direction-agnostic, do first):
- Move the shader grain **after** `linearToSRGB`, halve strength (~0.012), and
  scale it by luminance so shadows stay quiet (`grain × (0.3 + 0.7 × luma)`).
  Freeze the hash seed per ~3 frames or drop `time` entirely at rest.
- One grain system owns the page: keep the CSS paper overlay for DOM, keep the
  (fixed) shader grain for the canvas, delete nothing else — but re-judge at
  100% zoom against the board frames. Grain should read as matte paper at
  arm's length, invisible in the void.

## 1. Art-direction fork — needs mockups + user decision (gates the art pass)

User opened it: the page does not have to live in a dark void. Candidates to
mock (static frames, Fable-designed, in docs/landing-mockups/, never
published):

- **D1 — Dark, repaired.** Current world with the grain fix, richer void
  (skirt/table-edge context), and the beat fixes below. Baseline option.
- **D2 — The lit table (parchment/D&D-table world).** The page is a warm-lit
  tabletop: parchment/cream field, wood table surface visible, the diorama
  sits on it like a physical model. Ink text on paper — "From Ink to Alive"
  literally starts as ink on parchment, so beat 1 (drawing the map) becomes
  the strongest beat instead of the weakest. **Beat 5 then actually performs
  nightfall**: the whole world dims to the current night look and returns —
  the one dark moment is the story beat, which is what the user asked for.
  Beat 8's door reads as carved into the table edge.
- **D3 — Hybrid.** Light-grey/warm-stone surround (not cream, not void), dark
  only where the story needs it (night beat, trust beat's hidden half).

Notes for the mockup pass:
- Goblin green #B6D648 stays marketing-accent only; on parchment it reads as
  ink-margin scribbles (Marginalia grammar gets stronger in light mode).
- The molten-green seam concept is void-dependent. Each direction frame must
  show its seam answer (D2: a crack in the table wood with green glow seeping
  through is plausible and keeps the user's decided material). Per-beat seam
  routing decision stays pending and folds into this fork.
- Contrast discipline if light wins: ink-on-parchment body ≥ 4.5:1; the cream
  field must be a deliberate D&D-table prop (wood, parchment texture, objects),
  not a flat cream page.

Deliverable: one mockup board (3 directions × 2 frames each — hero + one
feature beat) → user picks. No art-pass work starts before the pick.

## 2. Structural fixes — safe in any direction (start immediately)

S1. **Copy/scene staging sync** (the multiplier; root of the "beat-3
    collapse"). Sections scroll free while the scene scrubs, so copy arrives
    before its picture and outlives it. Fix: drive each beat's copy
    opacity/translate from the same scroll progress the scene uses
    (`sceneProgress.ts`), with an explicit contract per beat: copy fades in
    only after the beat's picture is ≥80% in, fades out before the picture
    dissolves. No pinning rework needed — choreograph the copy, not the
    scroll. Files: `App.tsx` beat wrappers + one small hook + `global.css`.

S2. **Beat 4 (trust) rebuild.** Player pane must show a real fog-limited view
    (visible walls/floor near the token, void only beyond sight), not an 85%
    black pane. Divider + YOUR VIEW/THEIR VIEW labels appear and leave
    together with the split (currently labels outlive the divider). DM-pane
    palette must match neighbor beats' warmth (it currently washes pale
    grey). Token never straddles the divider slice. Files:
    `SceneRenderer.tsx`, `visibility.ts`, `focalAccents.tsx`, `mapData.ts`.

S3. **Token treatment.** Flat vector ovals → painted tokens consistent with
    the diorama: circular base with rim, tinted fill, soft contact shadow,
    slight size-by-zoom. Kills the "record button" and "sliced blob" reads.
    Files: `focalAccents.tsx` (+ a small painted texture in `textures.ts`).

S4. **Grain fix** from section 0. Files: `PostFX.ts`.

Each of S1–S4 is one scoped agent with named files; verify each with a
before/after frame at the exact scroll positions from the fresh check
(anchors 0 / 1710 / 3420 / 4200 / 5130 / 5900 / 6500 / 7600 / 9300 / 11000 /
12700 / end).

## 3. Art pass — after the fork decision (workflow, ≤5 agents/step)

Direction-dependent, so scoped only after the user picks:
- Beat 1 ink identity (strokes drawing themselves — works in every direction,
  background differs).
- Beat 6 glow-to-room scale + beat 7 table lighting/legible map payoff.
- Seam material (molten quality) + per-beat routing per the pending proposal,
  re-grounded in the chosen direction.
- Remaining cached fixes from wf_78bda4d6-657 (composition vignette, green
  speckles, rain clip) — resume with resumeFromRunId where still applicable;
  drop what the direction change invalidates.
- Eyebrow-chip removal rides with the Marginalia grammar step (already
  planned), not here.

## 4. Gate

Full browser walk on the built bundle: every anchor frame judged against the
chosen mockup frames, wheel-scroll fps capture (fresh-check baseline: 60fps
avg, p95 17ms — must not regress), zero console errors, reduced-motion and
390px passes re-run. The two THREE deprecation warnings stay tracked for the
next version bump.

## Sequencing

1. S1–S4 structural fixes (parallel, small scopes) — start on approval.
2. Mockup board for the direction fork — parallel with 1; user picks.
3. Art pass workflow on the chosen direction.
4. Gate.

Known baseline evidence for this plan: fresh-check screenshots in scratchpad
art-shots/ session dirs; perf numbers above; grain math in `PostFX.ts` lines
58–83.
