# Landing design enhancement — background art direction + UI block redesign

Date: 2026-08-07 · Scope: ideas only, no code. Companion to `site/art-brief.md` (the exposure/value
contract, being fixed separately) — nothing here repeats that contract; this is the layer above it:
what each frame IS as a picture, and what the DOM blocks become. Judged against
`docs/landing-mockups/2026-08-07-landing-concepts.html` (approved board),
`docs/art-style-guide.md` (release gate), and PRODUCT.md voice.

---

## PART 1 — Background art direction: make it look like something

### The diagnosis in one line

The scene is *lit* (badly, per art-brief) but never *composed*: one floating floor plan in
undifferentiated black, no edge between map and void, no focal accent anywhere, nothing occupying
the darkness, no grounding shadow — so even a perfectly exposed frame would read as "boxes in
nothing," not a place. The board frames read because every one is a picture with a subject, a
light mass in a deliberate spot, and black that feels like cave air rather than dead pixels.

### The five systemic moves (do these once, every beat inherits them)

1. **Torn-rock skirt around the dungeon.** Style-guide DNA rule 5: dungeon negative space is
   pure black *with a rocky torn edge*. Give the diorama a jagged rock rim hugging the outer wall
   silhouette — one flat `ShapeGeometry` ring (outline noise-displaced, ~0.3–0.8 cell amplitude)
   or a single alpha-card ring mesh with a baked painterly texture, albedo `#14120d`–`#1a1710`,
   ink-outlined by the same inverted-hull pass as the walls. Sits 1–2px below floor level, unlit
   (basic material). This single mesh converts "rectangles floating in void" into "rooms carved
   out of rock." It extrudes/rises with the walls in beat 2 and persists through beat 7.

2. **One focal accent per beat — enforced, not hoped.** Style-guide rule 7: exactly one focal
   per map. Each beat names its focal below; technique is always the same cheap pair: a small
   emissive mesh (or sprite) + one radial-gradient glow sprite (`#EDA94E` core), additive,
   flickering on the board's 4.5s keyframes. The camera path and copy layout point at it. If a
   frame has no single brightest, warmest point, it fails.

3. **Light mass opposite the copy + copy-side vignette shaping.** Composition contract: the
   brightest pool in the scene sits in the map half at a rule-of-thirds anchor, never centered,
   never behind text; the copy half is shaped darker by an authored gradient, not by accident.
   Technique: one fullscreen quad post-gradient (or a large radial dark sprite over the copy
   half), per-beat direction flip when copy switches sides (beats 3 and 5 alternate). This is
   what makes the DOM and the scene read as one composed frame instead of text dumped on a
   screenshot.

4. **The goblin eyes as recurring witness.** The darkness needs an occupant. Two emissive
   `#B6D648` ellipse sprites with ink pupils (the exact beat-8 asset) appear small and far in
   the void margins throughout the scroll: a faint blink in beat 0 near the whisper, a glimpse
   low in the rock skirt shadow during the beat 5→6 transition, gone when looked at (fade on
   proximity to viewport center), finally arriving full-size above the door in beat 8. Two
   sprites + a blink timeline — near-zero cost — and the whole page gains a narrative spine:
   something has been watching you scroll toward its door. (Rationing note: this plus CTA plus
   voice lines keeps `#B6D648` ≈2% of any viewport, per the board spec.)

5. **Air and ground: ember motes + contact shadow.** (a) One instanced points buffer, fixed
   ~120 quads, warm `#EDA94E` at 4–8% opacity, slow vertical drift + horizontal sine, spawned
   only within ~1.5 cells of torch pools, killed at pool edge — the black between pools becomes
   air. (b) One dark radial sprite under the diorama as a soft contact ellipse so the map sits
   *on* something. Fixed buffers, zero per-frame allocation, fits the perf guardrails.

Deliberately NOT proposed: god-rays, bloom chains, fog volumes, particle rain beyond the
art-brief's instanced streaks, any perspective camera drama. The style guide's drama is baked
and painterly, not post-processed.

### Per-beat visual identity (what the frame IS as a picture)

Every entry: composition / silhouette hierarchy / focal / light mass / what fills the void —
with the technique named. All within the art-brief palette pins.

**Beat 0 — "Pitch-black cave, something breathing."**
The frame is 95% void with the goblin whisper text and, far low-right, two tiny eyes that blink
once and go dark. One ember mote drifts through frame. The map exists only as the faintest
silhouette: rock-skirt edge barely separable from void (`#12110d` on `#0B0A08`), two ember
points at ≤25% intensity (art-brief). Silhouette hierarchy: eyes > whisper > skirt edge.
Technique: eye sprites (move 4), motes (move 5), skirt mesh at pre-dawn albedo. Nothing else.
The beat's job is to make the darkness itself the first character.

**Beat 1 — "Ink drawing itself on black paper."**
The frame is a drafting sheet: flat plan lines (`#5a5d50` → parchment-lit `#8a877a` at the draw
head) crawling across black, grid seams ghosting in behind completed strokes, the page grain
overlay doing double duty as paper tooth. Focal: the draw head itself — a small warm glint
sprite riding the line tip (the "pen nib catching lamplight"). Light mass: none — this beat is
deliberately the flattest, so beat 2 lands. Void filler: two or three stray half-drawn
construction lines and one dashed pale arc (the board hero has exactly this remnant) sitting
outside the plan — the sheet reads as *worked on*, not generated. Technique: dashoffset line
meshes; glint = one sprite parented to the draw head; construction lines are static line
segments at `#5a5d50` 40%.

**Beat 2 — "The map wakes: a torchlit two-room hold carved in rock" (hero).**
Composition: board a1 — copy 44 / map 56, top-down orthographic, black margin around the map,
the rock skirt now risen with the walls. Silhouette hierarchy: ink wall network > skirt edge >
door rectangles in their gaps > pools. Focal: the treasure glint in the SE room (emissive dot +
glow sprite, the board hero has it, the build lost it) — last thing to ignite, timed with the
headline landing. Light mass: the two right-hand pools, brightest at the upper-right third
anchor; copy-side vignette holds the left half ≤`#141210`. Void filler: motes near pools; one
faint remnant construction line from beat 1 fading out (continuity between beats — the drawing
becomes the place). Technique: all inherited from the systemic moves + art-brief lighting pins.

**Beat 3 — "A lantern cone in a black cave."**
The picture is the wedge: 70% of frame `#080706`, the visibility polygon the only lit region,
its hard edge (≤2px falloff) the strongest line in frame. Composition: copy right (board a2),
wedge apex at the token on the left third, wedge opening toward frame center — the light
literally points from the darkness toward the copy. Silhouette hierarchy: wedge edge > token +
amber sight ring (focal) > one shadow spike cast by a wall corner cutting the wedge (the proof
the algorithm is real — stage one wall corner inside the wedge specifically to cast it).
Explored-remnant rooms at 18% fill the wedge's wake so the token has a history. Void filler:
nothing — this beat's void must stay absolute; even motes pause outside the wedge. Technique:
clip-region rendering per art-brief; sight ring = torus/ring sprite `#EDA94E` 70%.

**Beat 4 — "The same room twice; one copy is lying by omission."**
A diptych of two flat plans, deliberately clinical: camera fully top-down, minimal pools,
flat-ambient DM pane — the one beat where the scene argues like a diagram. Composition: two
panes, 2px `#26241D` divider, copy above (board a3). Silhouette hierarchy: DM pane's complete
double-room plan > amber dashed secret-door break + "S" badge (focal — the only warm accent in
the frame) > player pane's lone west room adrift in `#080706`. The player pane's ≥50% darkness
IS the composition: its emptiness must be readable as *missing geometry*, so give the missing
east room zero remnant — not dimmed, absent. Void filler: none on the player side (the point),
motes only in the DM pane. Technique: scissor split per board spec; badge = circle mesh + mono
"S" texture; dashed break = line dash material.

**Beat 5 — "The same place under moonlight, two hearths refusing to go out."**
The frame is a blue nocturne: `#06070A` field, `#232833` floors, and exactly two amber pools
holding warm — the complementary clash is the picture. Composition: copy left (board a4), the
two warm pools placed diagonal across the map (NW + SE) so the eye travels through the blue
between them; rain streaks (instanced, 112°, confined to the map footprint) give the void over
the map a direction. Focal: the brighter of the two pools (+10% at full night per art-brief).
Silhouette hierarchy: warm pools > night-ink wall network > rain direction > scrub UI. Void
filler: rain over the map only; the outer void stays clean so the map reads as seen through a
storm, not the page. Technique: ambient lerp + instanced rain per art-brief; nothing new.

**Beat 6 — "Striking one set while the next rises, mid-performance."**
Composition: a diagonal handoff — outgoing night-graded map sinking low-left (walls ≤30%
height), incoming day-graded map rising high-right, overlapping ~15% at frame center. The two
grades (blue vs warm) make the two maps instantly separable even mid-cross. Focal: the incoming
map's hearth — one big lit pool at its center, alive *before* the map finishes rising ("no
blackout" performed: the new set arrives already lit). Silhouette hierarchy: incoming lit
silhouette > outgoing sinking ink > skirt fragments. The incoming map gets a *different plan
silhouette* (round chamber + hall vs the two-room hold) so the swap reads at a glance. Void
filler: motes migrate toward the incoming hearth. Technique: two light rigs cross-fading, never
both <40% (art-brief); second small map geometry set, shared materials.

**Beat 7 — "A lamp over the war table."**
The pull-back reveals the frame everyone knows from their own dining room: a wooden table in a
dark room, one warm overhead ellipse, the map glowing brighter than everything (the product's
whole pitch as a still life). Composition: board frame-table — table upper 55%, centered copy
below in the dark band. Silhouette hierarchy: glowing map (focal — brightest object in frame)
> lamplight ellipse on plank wood > dice pair + mug as ink-outlined satellites > room vignette
`#241A10`. The rock skirt reads, at this scale, as the diorama's base board — the same mesh
sells "physical model on a table" for free. Void filler: the room's radial glow replaces raw
void; a hint of a chair-back silhouette at frame edge is allowed if cheap (one dark alpha
card), skip if not. Technique: one warm point/spot overhead + plank texture per art-brief;
props are simple meshes with the outline pass.

**Beat 8 — "The door at the end of the corridor."**
The DOM owns the door; the scene's job is the stage: radial warm glow ellipse behind the door
position (`#17150F` per board), faint `#EDA94E` rim on the void floor, the dim beat-7 table
remnant far behind at ≤10%, eyes arriving full-size (the witness lands — move 4's payoff). Void
filler: two or three motes drifting up through the glow like dust in a doorway light. Technique:
one radial sprite + the existing DOM door; nothing else competes.

---

## PART 2 — UI block redesign (structure and visuals; every copy string stays)

### Honest diagnosis of the current blocks

1. **The eyebrow chips are the exact saturated scaffold.** Every feature section carries a tiny
   tracked-uppercase mono eyebrow (`FOG & SIGHT`, `TRUST`, `LIVE TABLE`, `SCENES`). This is the
   2023-era kicker that now appears on the majority of generated landing pages regardless of
   brief — the definition of a tell. Worse, it's a transcription error: the board used
   `BEAT 03 · SIGHT` as *frame labels* — mockup annotation chrome, explicitly "not page
   content" — and the build promoted them into page grammar. They should not survive in any
   direction below. (Mono itself stays legitimate where it is diegetic HUD: `YOUR VIEW` /
   `THEIR VIEW`, the scrub ticks, the `GOOD GOBLIN` wordmark.)
2. **One scaffold, stamped eight times.** Every beat is eyebrow → h2 → sub → italic voice line,
   left-aligned at the identical x, identical padding, `min-height: 100svh`, centered
   vertically. The uniform reflex — one identical treatment applied to every section — is what
   reads as generated, independent of any single element.
3. **Naked text with no relationship to the scene.** Blocks float raw over the canvas with no
   containment, no edge treatment, no anchor to what the diorama is doing. The copy could sit
   over any background; that interchangeability is the "generic overlay" feel. (The one
   exception — the door + plaque — is a physical in-world object, and it's the only block
   that feels like ours. That's the thread to pull.)
4. **`border-top: 1px solid` between beats** slices the "one continuous scene" fiction into
   generic SaaS bands. The board already owns a better divider: the corridor motif (tiny
   ink-outlined door between two wall lines).
5. **The scrub and pane tags are correct ideas** (diegetic HUD shadows of scene state) styled
   generically — a naked 4px rounded track could come from any component library.

### Direction 1 — "Marginalia" (the page is the DM's annotated map sheet)

The whole page becomes one map sheet the goblin has annotated. Section grammar: kill the
eyebrow; each feature block is headline + sub + voice, but the *headline is anchored to the
scene* by a hand-ruled ink leader line — an inline SVG stroke (subtle waver, 1.5px,
`#5a5d50`) running from the headline's end toward the thing the copy describes (the token in
beat 3, the "S" badge in beat 4, the scrub in beat 5), ending in a small ink ring. The voice
line becomes a margin scribble: same Newsreader italic green, but set slightly rotated
(−1.5deg), offset into the margin like a note added later. Headlines gain a hand-wavered ink
underline (SVG, not border-bottom). Section dividers become the board's corridor motif.
Typography: Newsreader display unchanged; mono retreats to diegetic HUD only. Signature
motion: the leader line draws itself (dashoffset) as the block scrolls into its pin, the ink
ring landing on its target as the beat's scene state settles — copy and scene visibly become
one picture. Buildable: CSS + one small inline SVG per section (a fixed-viewBox leader path
per beat; no dynamic anchoring needed — the beats are pinned compositions).

### Direction 2 — "The Goblin's Ledger" (ink-ruled entry strips)

The feature blocks become entries in the goblin's ledger — the strip device the approved board
already used in Direction C. Section grammar: each beat's headline sits on a full-width ledger
strip: `#12110D` band, 2px ink rules top and bottom, headline left, voice line right-aligned
on the same baseline (two voices of one entry: the claim and the goblin's aside). In place of
the eyebrow, each strip carries one small inked pictogram (24px inline SVG, drawn in the art
style: an eye for sight, a keyhole for trust, a moon for the world turning, two overlapping
map corners for scenes) — pictograms are voice, labels were scaffold. The sub hangs below the
strip over raw void, unboxed. Dividers: none — the strips themselves are the punctuation.
Typography: headline drops one size step (the strip gives it weight instead), voice italic
stays. Signature motion: the strip's two rules draw outward from the left edge (scaleX,
ease-out-quint) as the beat pins, like a line being ruled in a book; the pictogram inks in
with a 120ms delay. Buildable: pure CSS + four small inline SVGs; DOM change is wrapping
h2 + voice in a strip container.

### Direction 3 — "Torchlight & the Corridor Spine" (darkness is the container)

No boxes, no strips — the *scene's darkness* contains the copy, made deliberate. Each copy
block sits inside an authored torchlight scrim: a soft radial darkening (CSS
radial-gradient backing, elliptical, feathered ~30%, `#0B0A08` at 85% center fading to
transparent) shaped like the shadow between torch pools — containment with zero card
geometry, and it guarantees text contrast independent of scene exposure. Section grammar:
eyebrows replaced by a persistent corridor spine — a fixed thin vertical track at the far
edge (2px, `#26241D`) with nine notches, one per beat: passed notches are small ink ticks,
the current beat's notch is a live torch flame glyph (12px SVG, `#EDA94E`, the board's
flicker keyframes), upcoming notches barely visible. The spine is map-legend chrome: it says
"you are here in the dungeon," replacing eight eyebrows with one persistent element that
carries actual state. Dividers: corridor motif between acts only (after hero, before door).
Typography: unchanged families; headlines may step up one size since the scrim guarantees
legibility. Signature motion: the flame glyph slides along the spine between beats with a
brief trailing ember; on `prefers-reduced-motion` it jumps. Buildable: CSS gradients + one
fixed-position spine component (list of nine anchors) + one flame SVG.

### Shared cleanups (apply under any direction)

- Delete all four eyebrow chips and the `.eyebrow` class.
- Replace `border-top` beat separators with the chosen direction's device (or nothing).
- Restyle the scrub as an in-world object: ink track, wooden/brass thumb reading as a physical
  slider bead, mono ticks kept (they are HUD).
- Vary block placement per beat (the board already alternates 44/56 and 58/42, copy left/right,
  and one centered beat) — the build currently left-aligns everything; adopt the board's
  alternation so the scroll has rhythm.
- The door/plaque stays exactly as designed — it is the standard the rest is being raised to.

---

## PART 3 — Ranked shortlist

### Background moves, ranked

1. **Torn-rock skirt** — the single highest-leverage mesh; converts floating rectangles into a
   carved place, per the style guide's own negative-space rule.
2. **Focal accent per beat, enforced** — the style guide's one-focal rule applied to the page;
   gives every frame a subject (glint, sight ring, S badge, held pools, hearth, glowing map,
   eyes).
3. **Light-mass-opposite-copy + copy-side vignette** — makes DOM and scene one composed frame
   and guarantees copy legibility structurally instead of by luck.
4. **Goblin eyes as recurring witness** — near-zero cost, gives the whole scroll a narrative
   spine and pays off the existing beat-8 asset.
5. **Ember motes + contact shadow** — the cheapest "the black is air, the map has weight"
   grounding pass.

### UI direction recommendation

**Direction 1 — Marginalia**, because it is the only one that dissolves the actual complaint:
the blocks stop being an overlay *on* the scene and become annotations *of* it — the leader
lines make copy and diorama a single picture, which no amount of block styling achieves.
Steal from the others where they're strongest: Direction 2's ledger strip is the right
treatment for beat 7's centered kit summary, and Direction 3's torchlight scrim is worth
adding under any direction as the legibility guarantee. Fallback order if Marginalia's leader
lines prove fiddly against the live scene: 3, then 2.

### Explicitly NOT to do

- No parchment/cream cards behind copy blocks — it breaks the drenched-dark strategy and walks
  straight into the cream-panel default; parchment stays rationed to the plaque.
- No numbered section markers (01/02/03) as eyebrow replacements — same scaffold, one tier
  deeper.
- No glassmorphism scrims, no backdrop-filter panels over the canvas.
- No bloom/god-ray/SSAO passes to "fix" the murk — exposure is fixed by the art-brief value
  contract, drama by composition.
- No new fonts, no nav bar, no section anchors menu — the page is a corridor, not a site.
- No mono labels beyond diegetic HUD — every remaining tracked-caps string must name live
  scene state (view tags, clock ticks, wordmark), never a section topic.
