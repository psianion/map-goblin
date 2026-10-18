# Nine-issue fix batch — adjudication

Date: 2026-08-11. Read-and-reason pass. No source edits, no git, no browser. Everything numeric
below is either quoted from the plan/verification of record or re-derived here from the shipped
source; where I derived it, the derivation is shown so it can be checked rather than trusted.

Documents of record: `docs/2026-08-11-nine-issue-fix-plan.md` (the plan and its acceptance
numbers), `docs/2026-08-11-nine-issue-verification.md` (the verify pass),
`docs/2026-08-08-background-texture-rescore.md`, `docs/2026-08-11-scroll-tick-analysis.md`,
`docs/2026-08-11-scroll-fix-verification.md`, `docs/2026-08-11-loader-verification.md`.

---

## Verdict table

| Issue | Verdict | The one fact that decides it |
|---|---|---|
| 1 — scroll-rig init flake | **PASS** | `requestIdleCallback(decide, {timeout:1500})` + self-disconnecting `MutationObserver` → `ScrollTrigger.refresh()` are both present and correct; 5/5 reloads gave spacers=9 and a post-loader `scrollHeight` delta of 0. |
| 2 — external scrolls bypass Lenis | **PASS** | No behaviour change was shipped and none was needed; `PageDown`×3 / `End` / `Home` produced byte-identical `--copy-v` and `scrollY` to the `scrollTo` equivalents. |
| 3 — aspect < 1.6 clips beat 4 | **PASS** | `W(36, 1600, 1000) = 16.99` reproduces `y = 36` at the reference viewport exactly, and the closed form is the correct one: the invariant is `(w − 56)/h`, not aspect. Verified independently below. |
| 4 — the lamp isn't in the world | **ACCEPTED-WITH-CAVEAT** (acceptance test 1 not met) | In-frame peak-to-corner modulation at beat 7 is **≈ 24/255** by arithmetic against the shipped constants, not the required **≥ 40/255**; and the map centre sits at `r = 21.0` against `LAMP_RADIUS = 20`, i.e. wholly outside the pool, contradicting the plan's own falloff spec. |
| 5 — split unlit/toon value system | **ACCEPTED-WITH-CAVEAT** | Zero lit materials, zero lights, `shadows` gone — that half is proven. The global `f = 0.35` substitution is **not** proven: the one material anyone actually measured per-surface (the token) came out **37/255** off the shared scalar. |
| 6 — x-ray ghosting on crates | **FAIL** — regression | The grow-in fixes the x-ray, but deleting `alphaHash` + the opacity drive left the four prop bodies as opaque `MeshBasicMaterial`. `SceneRenderer`'s beat-4 player pane hides them **only** via `fade(fogHidden, 1 - trustGlow)`, which sets `material.opacity` — a no-op on an opaque material. |
| 7 — night heading contrast | **FAIL** | Against what is actually behind the copy at beat 5 (the night-ramped map floor, the measurement the plan explicitly specified), the h2 reads **1.08 : 1 at worldP 0.50** and **3.60 : 1 at 0.65**. Both the builder and the verifier measured against the flat scene surround instead, which is not what the copy sits on. |
| 9 — remove `window.__lenis` | **PASS** | 0 matches in `dist/assets/`, `undefined` on the preview build, `object` in dev; both the set and the `delete` are inside `import.meta.env.DEV`. |
| 10 — render-blocking CSS | **PASS** | 0 stylesheet links, 0 `.css` resource entries, 8/8 fonts 200, `dist/index.html` 15.6 kB gzip against a 20 kB ceiling. |

---

## Rulings on the seven contested items

### 1. Issue 3: the re-fix's account is correct; the verification's clipping claim is wrong

The verification reported "outer walls FULLY CLIPPED, zero margin" at aspects 1.31 and 1.45. The
re-fix agent measured 2.80–7.64 px and blamed a capture artifact. **The re-fix agent is right, and
this is provable from the shipped formula without a browser.**

Under the old code the half-pane world width was

```
y_old = 36 · (1.6 / a)          (for a < 1.6, before the clamp)
W     = y · tan(17°) · (w − 56) / h
```

Substituting `a = w/h` collapses the height out entirely:

```
W_old = 36 · tan(17°) · 1.6 · (1 − 56/w) = 17.61 · (1 − 56/w)
```

`W_old` depends on **width alone**. The pane is centred on world x = 8 and the outer wall faces sit
at x = −0.1875 and 16.1875, so the wall is only lost when `W < 16.375`. That requires
`1 − 56/w < 0.9299`, i.e. **w < 799 px**. `Hero.tsx` gates the 3D path on width ≥ 900 px. The wall
could not be off-frame at any viewport that reaches the scene at all, let alone at 1200 px and
1184 px wide.

Concretely at the verification's own two test windows:

| Window | `W_old` | Margin outside the outer wall | In pane pixels |
|---|---|---|---|
| 1200 × 917 | 16.79 | 0.208 world units | **7.1 px** |
| 1184 × 815 | 16.78 | 0.203 world units | **6.8 px** |

So the practical question the brief poses answers cleanly: **the bar was missed by about one pixel
per side, not by the whole wall.** The original defect was real but marginal, and it was marginal at
every viewport ≥ 900 px wide — the plan's "clips both rooms' outer walls" framing overstated it too.

Two further points that break the tie:

- The verification's own evidence is self-consistent with a ~7 px margin. It describes "the left
  pane's outer torch cut by the pane edge (a half-circle at x = 0)". A torch **pool** is a radial
  decal roughly 1.5 world units across; a pool centred near the wall extends about 1.0 units past
  it, far outside a 0.2-unit margin. A cut pool is exactly what a 7 px margin looks like. A cut pool
  is *not* evidence of a missing wall.
- The verification contradicts itself. §3 describes an asymmetric failure (left pane's torch cut,
  right pane's wall "entirely absent"); the cross-cutting section says "the composition is still
  symmetric between panes (both clip identically)". At `trustGlow = 1` the two panes converge on the
  same `centerX` slice (`SceneRenderer.tsx:370, 434, 485`), so a symmetric read is the only possible
  one at pin progress 1.0 — an asymmetric read means the capture was not at progress 1.0.

The re-fix itself checks out independently. `W(36, 1600, 1000) = 36 · tan(17°) · 1544/1000 = 16.99`,
and inverting gives `y = 36.00` at the reference viewport, `53.2` at 1100 × 1000 (matching the
agent's stated worst case exactly) and `55.9` at 1100 × 1050, inside the `[36, 56]` clamp. The
memoise epsilon then no-ops the rebuild at the reference, so the signed-off shape is untouched by
construction rather than by rounding. Margins rise from ~7 px to ~10.3 px at the reference-aspect
family. **Issue 3 is a PASS.**

One thing nobody checked, noted below in the not-proven list: `positionCurve` is a
`CatmullRomCurve3` over all nine keyframes, and each segment's tangents are computed from the four
surrounding control points. Raising keyframe 4 perturbs the *interiors* of segments 2→3 and 5→6 as
well as 3→4 and 4→5. The keyframes themselves stay exact (three.js maps `t` to segments by index,
not by arc length), so nothing moves at the pins — but the smoothness sweep only covered 3→4→5.

### 2. The top-edge overhang: accept as pre-existing, track it, and stop quoting the margin number alone

Accept as pre-existing. It is present at −11.1 px at the signed-off 1600 × 1000 reference, where the
shipped code changes nothing at all (`y` stays 36, the rebuild no-ops). A defect that exists,
unchanged, in the frame the composition was signed off against is not this batch's to own, and
closing it means moving the reference — which is a design decision, not a bug fix.

Two conditions on that acceptance:

- It gets filed. "Left deliberately" in a build note is not tracking.
- The batch's headline number stops being quoted bare. "8.4–11.0 px of margin" is measured at the
  wall's **footprint**; the thing a viewer actually sees clipped is the wall's **top rim**, which is
  still outside the pane everywhere. Both numbers belong in the same sentence, or the reader is
  being told the beat is clean when it is only less dirty. The fix does improve it (−11.1 → −1.4 to
  −6.1 px), which is worth saying too.

### 3. Shape-dependent 1.6 identity: acceptable, and arguably the stronger reading

Acceptable. The signed-off artifact is a **composition** — what the two panes frame — not a pixel
buffer. Under the new formula a 1280 × 800 window (aspect 1.60, the very viewport the original
keyframe comment solved against) gets `y = 36.32` instead of 36, and its half-pane world width
becomes **16.99 — exactly the reference's**. The old code gave it 16.84, i.e. a slightly tighter
crop than the reference. So the change makes a 1.6-aspect short window show the *same* composition
as 1600 × 1000, where before it showed a marginally different one. That is a strengthening of the
invariant that matters, not a weakening.

The cost is 0.9 px of framing lift and the loss of literal pixel-identity against the previous build
at 1.6-aspect windows other than 1600 × 1000. The plan's acceptance test names 1600 × 1000 as its
aspect-1.60 case, and there the frame *is* identical. Fine. The agent's "those windows were
under-framed anyway" is the correct read, not a rationalisation.

### 4. Issue 7's two open contrast points — and a third that is worse than both

**Both of the named points are secondary. The primary finding is that the whole issue-7 measurement
used the wrong background, and the fix fails badly on the right one.**

The plan is explicit (§7 acceptance test 1): measure the text against "the darkest 10th-percentile
background luminance inside the heading's bounding box", from a screenshot with the copy hidden.
Neither the builder nor the verifier did that. Both substituted the scene's flat surround colour
(`NORMAL_BG #3a2717` lerped to `NIGHT_BG #0c0906` by `nightT`). At beat 5 that surround is only
visible past the table plane's edges. What is actually behind the heading is the map floor:
camera keyframe 5 is `[8, 22, 3.5]` at fov 30, so the frame spans roughly world x −1.4…17.4 and
z −2.4…9.4 at aspect 1.6, and the copy column (left ~6–45 % of frame) sits over Room A's floor,
x ≈ −0.3…7, z ≈ 3.5.

That floor is `FLOOR_TINT #efe6cf` multiplied toward `FLOOR_NIGHT_TINT (0.0195, 0.0268, 0.0634)`
by `frontLoad(nightT)` (`Diorama.tsx:64, 209, 436, 850`) — the *same* cubic ease the copy ramp uses.
Re-deriving both sides in OKLab/linear sRGB:

| worldP | nightT | `--night-t-copy` | h2 colour | floor under the copy | **h2 vs floor** | h2 vs surround (what was reported) |
|---|---|---|---|---|---|---|
| 0.30 | 0.000 | 0.000 | `#16180f` | `#efe6cf` | 14.42 : 1 | 1.27 : 1 |
| 0.40 | 0.143 | 0.370 | `#5a5a4f` | `#c4bdab` | 3.69 : 1 | 2.13 : 1 |
| **0.50** | 0.286 | 0.636 | `#929084` | `#9a958a` | **1.08 : 1** | 4.83 : 1 |
| 0.65 | 0.500 | 0.875 | `#c8c5b7` | `#62605e` | **3.60 : 1** | 9.53 : 1 |
| 0.80 | 0.714 | 0.977 | `#e0dcce` | `#363841` | 8.52 : 1 | 12.96 : 1 |
| 1.00 | 1.000 | 1.000 | `#e6e1d3` | `#232838` | 11.23 : 1 | 15.20 : 1 |

(My surround column reproduces the verifier's numbers to within rounding — 4.83 vs their 5.07 at
worldP 0.50 — so this is the same arithmetic applied to a different, and correct, background.)

The copy ramp and the floor ramp are the same cubic running in opposite directions, so they **cross**
— and they cross almost exactly at worldP 0.50, where the heading and the floor under it differ by
`1.08 : 1`. The heading is invisible there. The `.sub` and `.voice` are the same or worse (1.22 : 1
and 1.08 : 1 at that sample).

Worse still, the fix is a net regression at mid-scrub. Pre-fix the copy stayed `#16180f` throughout;
against the same floor that is ~9.8 : 1 at worldP 0.40 and ~6.2 : 1 at 0.50, falling below 4.5 : 1
only past worldP ≈ 0.7 and hitting the plan's cited 1.24 : 1 at full night. **The real defect was
confined to the tail of the scrub. The fix cleared the tail and broke the middle.**

That reframes the two items the brief asked about:

- **(a) worldP = 0.30 measuring 1.27 : 1.** Against the surround, yes. Against the floor it is
  **14.42 : 1** — the best sample in the whole beat. This point is not a defect at all; it is an
  artifact of the wrong background. The `clockT` re-windowing does not need touching, and nothing
  needs a night-independent floor value. **Does not block. Close it as a measurement error.**
- **(b) `.sub` at 4.43 : 1 at worldP 0.50.** Also against the surround. Against the floor it is
  **1.22 : 1**. Arguing over 0.07 of a ratio here is arguing about the wrong number entirely. It is
  subsumed by the primary finding. **Does not block on its own; blocks as part of (c).**
- **(c) the crossover.** **Blocks.**

Fix direction, not a design: a monotone neutral text ramp cannot hold 4.5 : 1 against a background
that itself sweeps the full value range from `#efe6cf` to `#232838` — the two curves must cross, and
at the crossing the ratio is 1 : 1 by construction. No retuning of the ramp shape moves that; it only
moves *where* it happens. So one of the constraints has to give. In rough order of how little they
cost:

1. Constrain the background under the copy instead of the copy — hold or floor the map floor's value
   in the copy column's world region across beat 5, so the text has something stable to ramp against.
2. Move the copy column off the map footprint for this beat (the frame has void at x < 0).
3. Relax the no-scrim rule for this one beat — a soft local plate under the copy is the standard
   answer and the reason the rule usually has an exception.
4. Revert issue 7 and re-scope it to the tail of the scrub only, which is where the measured defect
   actually was.

Whichever is picked, the acceptance test has to be run as written — against the rendered background
under the heading box, not against a colour token.

### 5. Issue 5's `f = 0.35` shortcut: not sound. Per-material verification is still owed.

The light-deletion no-op is strong evidence — for a different claim than the one it is being offered
for. Deleting every light and getting zero pixel movement proves **no surviving material responds to
lights**. That closes acceptance test 1 and validates the premise of test 5. It says nothing about
whether the new albedo reproduces the old on-screen value, which is acceptance tests 2 and 3, and
which is the entire point of step 2's "do not guess `f` — measure it per material".

And the batch contains its own counter-example. The leftovers agent tried exactly this substitution
on the token — one shared scalar across materials — and re-measuring found the red token **37/255
low, well outside the ±4/255 bar**, forcing a per-colour tint (`focalAccents.tsx:151–166`). The one
place where anyone in this batch actually checked a shared factor per surface, the shared factor was
wrong by nine times the tolerance. Twelve Diorama/TableScene materials took the same shortcut and
were not checked.

Ruling: the conversion is structurally complete and correct, and the light deletion is genuinely
proven. The **values** are not. Owed: acceptance test 2 (five representative surfaces within 4/255 of
authored tint) and test 3 (per-beat mean frame luminance within ±6/255). This does not block ship on
its own — a mis-derived albedo is a wrong-looking prop, not a broken page — but it must not be
recorded as closed.

Credit where due: B's correction to the plan is right and important. The plan's step 5 claims
`MeshBasicMaterial` "ignores `normalMap`"; spreading the relief bundle onto one throws
`TypeError: Cannot set properties of undefined (setting 'value')` inside `refreshUniformsCommon`
every frame — a blank canvas, not a silent no-op. Every converted material pulls `.map` only
(`Diorama.tsx:99–110`), matching the already-unlit surfaces. That is a builder catching a factual
error in the plan and documenting it at the site, which is exactly the right behaviour.

### 6. Structurally-verified-only issues (#4's lamp numbers, #6's histogram): what it costs

**#4's on-screen modulation is not merely unmeasured — it is analytically short of the bar, and the
bar may be unreachable as specified.** From the shipped constants (`textures.ts:461, 468, 505–508`:
`LAMP_WORLD = (−9, −8.8)`, `LAMP_RADIUS = 20`, gradient stops `+26 / base at 0.38R / −26`,
`shiftColor` being a flat ±delta in 8-bit sRGB per channel), and beat 7's frame at
`[8, 20, 14]` / fov 38 covering roughly x −3…19, z −3…12:

| Sample point | distance from lamp | wood shift |
|---|---|---|
| frame near-left (−3, −3) | 8.3 | −1.6 |
| frame far-left (−3, 12) | 21.6 | −26.0 |
| frame far-right (19, 12) | 34.9 | −26.0 |
| **map centre (8, 3.5)** | **21.0** | **−26.0 (outside the pool entirely)** |

In-frame peak-to-corner ≈ **24/255**. The bar is ≥ 40/255. That is a real improvement on the
12.6/255 baseline — roughly double — but it is not the acceptance number, and B's claimed "40–45/255"
is a measurement of the **baked canvas**, which contains the pool's core; the frame at beat 7 does
not, because the placement spec deliberately puts the lamp at 26 %/12 % of the frame *at keyframe 0*,
which is off-frame by beat 7. The total available swing is ±26 = 52/255, so ≥ 40/255 in-frame
requires the frame to span from inside the core to past the far falloff. It cannot, at beat 7, with
this placement. **The plan's test 1 and the plan's placement spec are mutually inconsistent.** Do not
let someone thrash `LAMP_RADIUS` chasing 40; re-set the bar against what the placement permits, or
move the sample beat.

Separately, `LAMP_RADIUS = 20` with the lamp 21.0 units from the map centre puts the entire map
footprint outside the pool, which directly contradicts the plan's own falloff spec ("pick
`LAMP_RADIUS` so the map footprint sits inside the pool's bright half"). Mostly cosmetic, since the
map's own floor mesh covers that wood — but it means the constant was not tuned to the spec it cites.

The night-ladder delta (≤ 8/255) is safe analytically: `TABLE_NIGHT_TINT` is linear
(0.053, 0.076, 0.187), so a 24/255 wood delta scales well under 8/255 at `clockT = 1`. Fine on
argument.

**#6's histogram**: shippable on structure. The mechanism is a `scale.y` grow-in with `visible`
gating and *no transparency anywhere on the bodies* — bimodality is not an empirical question about
this implementation, it is a property of it. A solid opaque mesh cannot produce a blended mode. The
dpr-1.25 repeat the plan calls mandatory exists to catch dither density, and there is no longer any
dither. The pixel test would confirm something already entailed by the code. **Do not block on it.**

(#6 fails for a different reason entirely — see the next section.)

### 7. Untested paths: which are genuine ship risks

| Untested path | Ruling |
|---|---|
| CPU/network throttling for #1's 10× reload test | **Genuine risk, but not a blocker.** The fix targets a starvation failure that only appears under load, and the only evidence is 5 unthrottled reloads — the condition the bug does not occur in. That said, the mechanism (a timeout on the idle callback, a forced refresh on loader release) is correct by construction and strictly safer than what it replaced. Ship it; run the throttled loop when throttling is available. |
| No-JS for #10 | **Acceptable with a note.** Inlining CSS strictly improves the no-JS path — the styles are now in the document that renders. There is no mechanism by which this regresses. |
| Scrollbar-drag for #2 | **Acceptable.** Nothing shipped for #2. The premise was disproved from the library source and two of three parity tests passed exactly. |
| dpr-1.25 histogram for #6 | **Acceptable** — see above, there is no dither left to be device-pixel-sensitive. |
| Loader exit seam (#4 test 5) | **The one I would actually worry about, and nobody listed it.** See below. |

---

## What this batch broke or left worse, that nobody flagged

**1. Beat 4's player pane no longer conceals the fogged props. This is a real regression and it
blocks.**

`SceneRenderer.tsx:508–511` hides everything inside `FOG_RECT` from the player pane with
`fade(fogHidden, 1 - trustGlow)`, and `fade` (`:131–135`) works by writing `material.opacity`. The
group it targets (`focalAccents.tsx:123`, populated at `Diorama.tsx:1327–1330`) contains the vault,
`crates-b` and `bones-b`.

Before this batch those prop bodies used `alphaHash` with an opacity drive — `alphaHash` sits in the
opaque pass but *does* consume `material.opacity` for its stochastic discard, so the fade worked.
Issue 6 deleted `alphaHash`, `transparent` and the opacity drive from all four props
(`Diorama.tsx:1602–1608`, `1658–1672`, `1739–1745`). A `MeshBasicMaterial` with `transparent: false`
ignores `opacity` outright. **The concealment write is now a no-op on exactly those bodies.**

What is left is worse than a straight failure: the props' `Outline` hulls still carry `transparent`
(`Outline.tsx:37`) and their contact-shadow decals still carry it too, so both of *those* fade
correctly. The player pane at beat 4 should now render the vault, crates-b and bones-b as solid
untinted bodies with no ink outline and no contact shadow, standing inside the region the beat claims
is unknown to the players. The `PlayerFog` quad cannot save it: it is a flat plane at `FOG_Y = 0.05`
(`focalAccents.tsx:307`) and the props stand above it, so under a near-nadir camera they draw in
front of it.

Minimum fix: either restore `transparent` on those four bodies' materials (at opacity 1 the only cost
is draw-order, and the x-ray fix is unaffected because nothing drives their opacity below 1 outside
beat 4), or have `SceneRenderer` toggle `fogHiddenRef`'s `visible` for the player pane — the
single-write mechanism `focalAccents.tsx:118–119` already describes. Then look at beat 4.

**2. The same opaque-material trap is sitting under the trust tokens, and the blue-token claim is now
unverifiable from the code.**

`focalAccents.tsx:228` and `:239` build the token cap and rim as `MeshBasicMaterial` with no
`transparent`. `SceneRenderer.tsx:491–500` keeps the blue token out of the player pane with
`setOpacity(blueToken, 0)` — the same `material.opacity` write, the same no-op. The comment at that
site calls the withheld blue token "the beat's whole claim".

I cannot tell from source alone whether this is new (the pre-batch material was `MeshToonMaterial`,
which also defaults to `transparent: false`, so it may have been broken already), and I did not use
git. Either way: the batch converted these exact materials and did not check the one behaviour that
depends on them. This needs a thirty-second look at beat 4's right pane before anything ships.

**3. The loader's hand-off target was deleted and its replacement is a different order of
magnitude.**

`index.html:95–98` states that `#gg-lamp`'s end-of-exit value *is* `.stage-lamp`'s rest value and
"the swap is invisible". `.stage-lamp` is gone. The replacement is the baked wood pool, whose entire
modulation is ±26/255 of the wood tint; `#gg-lamp` is a CSS radial overlay running to full opacity
(`index.html:109, 536`). The positions were matched carefully (I get the baked pool's beat-0 centroid
at 23.9 %/12.1 % against the 26 %/12 % target, comfortably inside the ±6 % bar) — but position was
never the risk. Intensity was, and issue 4's acceptance test 5 ("no step ≥ 10/255 in the top-left
quadrant across `clear()`") was never run. This is the untested path most likely to be visible to a
first-time visitor, and it is the first thing they see.

Also: `index.html:65` still carries `html[data-gg-loading] .stage-lamp,` in the inlined critical CSS.
Dead selector, genuinely harmless — C's "no guard needed, CSS-selector-only reference" call was
correct — but it is now shipping in every document. Worth one line of cleanup.

**4. Confirmed still dead, as the verification said**: the `swapRiseLight` `<pointLight>`
(`Diorama.tsx:1005–1010, 1046`) runs its intensity ramp every frame into a scene where every material
is unlit. Its own comment justifies it by the ambient/sun lights that issue 5 deleted. Not a defect —
a per-frame write with no output. Delete it with the rest.

**5. Not broken, but nobody checked it**: raising keyframe 4 perturbs the interiors of camera
segments 2→3 and 5→6 as well as 3→4 and 4→5, because `CatmullRomCurve3` derives each segment's
tangents from four control points. The pins themselves are exact. The smoothness sweep covered
3→4→5 only. At the clamp ceiling (`y = 56`) this is a 41-unit control point moving; a mid-scrub lift
on "the rise" or "the swap" would not have been caught.

### Prior shipped work — status

- **Scroll fix (tick 1, 9 pin-spacers, no dead spans)**: intact. 5/5 reloads gave `spacers: 9`,
  `canvas: true`, `hidden: false`, identical `scrollHeight`, and a 0-delta re-measure across the
  loader release. The new `MutationObserver` refresh strengthens this path rather than touching it.
- **Loader plays and hands off**: plays and clears on every reload, no hang, no console error. The
  hand-off's *luminance* continuity is now unproven — see finding 3 above.
- **Beat-4 split — cross-pane scale**: intact. `SceneRenderer.tsx:353–370, 434, 485` still gives both
  panes the same `halfW × h` crop of one frustum with only a mirrored x-offset. Nothing in the batch
  touched it, and issue 3 moves the camera height, which both panes share by construction.
- **Beat-4 split — fog concealment**: **broken.** Finding 1.
- **Beat-4 split — no blue token in the player pane**: **at risk, unverified.** Finding 2.
- **`.pane-divider` glow**: intact. The rule and its animated `::before` are present
  (`global.css:406–454`), width and opacity are driven per frame off `trustGlow`
  (`SceneRenderer.tsx:318–326`), and the verifier saw it lit at aspect 1.94.
- **Console**: zero errors across a scripted nine-beat walk; one pre-existing, allowed `THREE.Clock`
  deprecation warning.

---

## Ship recommendation

**Do not ship the batch as it stands. Two blockers, both small, both in one place each.**

This is not a bad batch. Issues 1, 2, 3, 9 and 10 are clean, and issue 3's re-fix is the best work in
it — a correct closed-form solve that reproduces the signed-off reference algebraically instead of by
coincidence, plus a correctly-diagnosed false alarm in the pass that preceded it. Issue 5's
conversion and light deletion are real structural wins. The problems are concentrated: one deleted
mechanism that something else was quietly relying on, and one fix measured against the wrong
background.

**Blocking:**

1. **Issue 6 → beat-4 fog concealment.** Restore an opacity-responsive path for the four prop bodies
   (re-add `transparent` to those materials, or switch the player pane to a `visible` toggle on
   `fogHiddenRef`), then look at beat 4's right pane. While you are there, confirm the blue token is
   actually absent — same failure class, same beat.
2. **Issue 7 → the mid-scrub crossover.** Re-measure against the rendered background under the
   heading box, as the plan specified. Then relax exactly one constraint (background value under the
   copy column, copy placement, the no-scrim rule, or scope the ramp to the tail only). Do not ship
   the current ramp: at worldP 0.50 the heading is at 1.08 : 1 against the floor, which is worse than
   the state it replaced.

**Not blocking, but must not be recorded as closed:**

- Issue 4 — acceptance test 1 is missed by roughly 16/255 and the bar is likely unreachable with the
  current placement. The page is better than it was; the issue is not finished. Re-set the bar before
  anyone tunes the constant again.
- Issue 5 — the per-material value verification (tests 2 and 3) is still owed.
- The loader exit seam (issue 4 test 5) should be eyeballed once before ship even without a pixel
  path; a visible step there is the first thing a visitor sees.
- The top-edge wall overhang (pre-existing) and the `swapRiseLight` dead code should be filed.

Once the two blockers land and beat 4 has been looked at, the rest ships.

---

## Not proven, only argued

Everything below rests on reasoning, code reading, or arithmetic — not on a measurement of the
running page. The owner is taking each of these on trust.

**From the builders:**

1. Issue 4's beat-7 peak-to-corner delta of "40–45/255" — measured on the baked canvas, never in a
   rendered frame. My own arithmetic against the shipped constants says ≈ 24/255 in-frame.
2. Issue 4's night-ladder delta ≤ 8/255 — claimed analytically, never sampled. (My check agrees it is
   safe, also analytically.)
3. Issue 4's pool parallax (≥ 15 % of frame width, beat 0 → beat 7) and beat-0 centroid placement —
   both follow from the geometry and both check out on paper; neither was measured.
4. Issue 4's loader hand-off continuity ("the two land in the same screen region so the exit still
   reads as one light") — position argued and correct; intensity never compared, and the two are
   different kinds of light.
5. Issue 5's global `f = 0.35` reproducing each of twelve materials' prior on-screen value — argued
   from one measurement in a different document, contradicted in kind by the token's own 37/255 miss.
6. Issue 5's "no visible change from the light deletion" as proof of the conversion's *values* — it
   proves the lighting claim only.
7. Issue 6's histogram bimodality and interior-edge absence — entailed by the implementation, never
   sampled. (I consider this one safe.)
8. Issue 3's live margins (8.42–11.00 px) and frame-to-frame Δy (1.68–2.03) — derived by projecting
   wall vertices through a camera clone, not read off pixels. The underlying formula I re-derived
   independently and it holds; the specific pixel figures are the agent's own model of itself.
9. Issue 3's top-edge overhang figures (−11.1 px at reference, −1.4…−6.1 px after) — same method,
   same standing.
10. Issue 3's dpr-1.25 check — asserted; `GAP_PX` does carry dpr at `SceneRenderer.tsx:324, 352`, and
    the derivation shows dpr cancelling, which I agree with on paper.
11. `assertNightRatiosDoNotBlowOut` passing — it is `import.meta.env.DEV`-gated
    (`Diorama.tsx:360–361`) and it logs rather than throws, so "it didn't crash" proves nothing. What
    *does* support it: the console walk was run against the dev server and surfaced only the allowed
    `THREE.Clock` warning. That is decent evidence, arrived at by accident.

**From the verification pass:**

12. Issue 3's "outer walls fully clipped, zero margin" — **disproven above.** Recorded here so the
    claim does not resurface.
13. Issue 4's "PASS on vibes" from a JPEG — the verifier labelled it exactly that; it is not evidence
    either way.
14. Issue 9's native-scroll parity between dev and build — pattern-matched across sessions, not a
    side-by-side diff.
15. Issue 6's "peripheral geometry reads as flat translucent gray" — most likely the floor's own
    `material.opacity = riseT` reveal in a not-yet-risen room, which is by design. Not a defect.

**From this adjudication:**

16. My contrast table assumes the map floor is what sits behind the beat-5 heading, derived from the
    keyframe-5 frustum and the copy column's CSS padding. It ignores PostFX's grade and vignette, the
    floor texture's own grid/speckle, and any torch pool drifting under the column. None of those
    move a 1.08 : 1 far enough to matter — a 40 % vignette on the floor still leaves ~1.5 : 1 — but
    the exact figures are modelled, not sampled.
17. My claim that the trust tokens' `setOpacity` is a no-op is certain as to mechanism; whether it is
    a *new* break depends on whether the pre-batch toon material carried `transparent`, which I did
    not check (no git).
18. The Catmull-Rom tangent spill into segments 2→3 and 5→6 is a property of the curve type, not an
    observed artifact. Whether it is visible at the clamp ceiling is unknown.
