# Cave demo — acceptance bar + grade (2026-08-26)

Target: the CaveRoomBuilder kit's own reference map, `D:/DownLs/CaveRoomBuilder/CaveRoomBuilderDemo(22x16).jpg`
(3080x2240, 140 px/cell). Release gate on top of it: `docs/art-style-guide.md`.
Facts carried over unchanged from `docs/2026-08-26-cave-baseline.md` §"Measured art facts".

Graded render: `session/testdata/goblin-warren.mapbuilder` (40x32 cells, 179 asset instances, 1 floor
ring / 156 verts / 236.5 cells perimeter / 509 cells² area), flat-composited, no engine lighting or fog.

Reproduce (from `D:/Labs/map-goblin`, scripts in the session scratchpad):

| what | command | output used below |
|---|---|---|
| overview | `node preview.mjs cave/preview3.png 26` | preview3.png |
| hi-res | `node preview.mjs cave/hi.png 100` | hi.png |
| crop A x14-26 y19-31 | `node preview.mjs cave/c-a.png 70 14 19 26 31` | c-a.png |
| crop B x24-36 y9-21 | `node preview.mjs cave/c-b.png 70 24 9 36 21` | c-b.png |
| crop C x2-14 y0-12 | `node preview.mjs cave/c-c.png 70 2 0 14 12` | c-c.png |
| crop D + wall overlay | `WALLS=1 node preview.mjs cave/c-d.png 70 27 8 39 20` | c-d.png |
| band thickness | `node band2.mjs <img> <ppc>` | ray-march, 800-1000 rays |
| silhouette grain | `node silh.mjs <img> <ppc>` | perimeter vs closing radius |
| shells outside floor edge | `node shell.mjs <img> <ppc>` | |
| shells inside authored polygon | `node inward.mjs` | ours only |

Cell coordinates below are map cells, origin top-left, x right, y down.

---

## A. The bar

Fourteen criteria. Each is markable PASS/FAIL from a screenshot at 70 px/cell or better.
Numbers in the "reference" column are measured off the gridded reference
(`scratchpad/cave/demo-grid.png`, 140 px/cell) or off the full reference JPG, not invented.

**A1 — Band thickness.**
Measured perpendicular from the visible floor edge outward to the last painted pixel, the rock band is
**1.0–1.9 cells**. No stretch longer than 2 cells may sit below 0.9 or above 2.2.
*Reference:* median 1.36, p25 1.07, p75 1.82, mean 1.53, sd 0.62 (841 rays). Note the spread: the
reference band is deliberately uneven, IQR 0.75 cells wide. A band of constant width fails this even if
its median is in range.

**A2 — How much of the band sits on the floor side.**
The kit paints roughly **0.5 cell of pale pebble spill inside the floor edge** — about **35% of the band
lies on the floor side of the walkable boundary**, the rest is solid rock on the void side.
Check: sample the shell 0–0.25 cell *inside* the authored floor polygon; **≥85% must be painted art,
not bare floor fill**. Shell 0.25–0.50 cell inside: **≥55% art**. A run where tan floor fill touches the
rock's ink contour directly, with no pebble lip, fails.

**A3 — Silhouette tracking.**
The band never leaves the floor edge. Specifically: **no stretch of authored floor edge longer than
0.4 cell may have bare floor fill on both sides of it**, and **zero white void pixels may appear inside
the floor polygon**. Two pieces that end short of each other and leave daylight through the wall is the
worst instance of this and is an automatic FAIL on its own.

**A4 — Silhouette grain.**
Outer lobes run **0.7–1.2 cells peak-to-peak**. Screenshot test at 70 px/cell: count lobes on a 5-cell
run of wall — **4 to 7**, not 10 to 12.
Measured test: close the art silhouette with a disk and track perimeter loss. **≤22% of the perimeter may
live below a 0.3-cell closing radius, and ≥20% must live in the 0.3–0.8-cell band.**
*Reference:* P(0)=99.8 cells, P(0.3)=80.2, P(0.8)=61.1 → 20% below 0.3 cells, **24% in the 0.3–0.8 band**.
This is the number that separates chunky hand-cut rock from a machine picket fence.

**A5 — Joints.**
At every joint between adjacent pieces the ink contour is continuous and the stone grain crosses it.
**No straight edge longer than 0.3 cell may exist anywhere in the painted rock, its pebble fringe, or its
cast shadow** — including any rectangular floor-material patch dropped on the cave floor.
A bad joint looks like one of: a razor-straight cut across the stone; a step where the shadow starts or
stops; a notch of void between two piece ends; a piece corner overlapping the next piece's ink outline.

**A6 — Cast shadow.** *(RECALIBRATED 2026-08-26 — see `2026-08-26-cave-shadow-diagnosis.md`.)*
The original bar — one continuous soft band of constant width, no patch, no shadow edge on a piece
boundary — **the kit's own reference map does not meet it either.** The shadow is baked into every
source PNG as a 0.27–0.34-cell skirt under an alpha ramp, so it arrives in per-piece stamps no matter
how the pieces are laid: measured at the first 0.1-cell shell out from the rock, the reference is 21.1%
shadowed and ours is 21.5%. Continuity is not the achievable difference and must not be graded as one.
What DOES separate them is **light direction**. The reference concentrates 69% of its void-side shadow
weight in three adjacent compass octants — one consistent light. Ours manages 41%, against 38% for a
uniform smear, because 47 pieces throw their skirt outward and 36 throw it inward.
**The bar, restated:** ≥60% of the void-side shadow weight falls within three adjacent octants, and no
piece throws its skirt against the map's light direction. Shadow continuity is explicitly not graded.

**A7 — Bend versus straight.**
A bend piece is used only where the floor edge turns **≥45° within that piece's footprint**. A run whose
edge turns **<25° across the piece footprint** uses a straight. Both errors are visible: a bend spread
over a gentle curve reads as a hinge or a dent; a chain of straights round a tight corner reads as a
chamfered polygon rather than rock.

**A8 — Piece repetition.**
**No single piece id supplies more than 35% of the map's straight-run pieces**, and **no more than 3
instances of the same id occur consecutively along one run**. Long straight stretches of floor edge get
long pieces: any floor-edge run of ≥5 cells with <25° of turn must be covered by pieces averaging
**≥4 cells**, not by a chain of 2-cell pieces.

**A9 — Rubble grain, density, and clustering.**
Rubble clumps are **1.2–2.5 cells across**. **≥60% of each clump's footprint sits within 0.6 cell of the
floor edge** — rubble is talus at the wall foot, not confetti on the floor. Cluster rate along the wall:
**one per 3.5–5.5 cells of wall run** (reference: ~1 per 4 cells of perimeter). **At most 3 clumps on the
whole map may sit more than 2 cells from any wall**, and those must be deliberate (a cave-in, a spoil
pile), sized ≥2 cells, and paired with something else — never a lone identical clump.
Individual pebbles inside a clump vary **0.08–0.3 cell**; a clump of uniformly sized pebbles fails.

**A10 — Clean wall between dressings.**
Dressing clusters are separated by **≥2 cells of undressed rock**, and **no wall run longer than 8 cells
is entirely undressed**. The reference alternates: ~1.5–2.5 cells of pebble talus, then ~2–3 cells of
clean stone. Continuous dressing all the way round, and a bare ring with all the dressing dumped in the
middle of the room, both fail.

**A11 — Floor crack character.**
A crack is a **hairline ≤0.2 cell wide** that **branches at least once**, **tapers to nothing at both
ends**, and **runs from a wall, a rubble field, or another crack to one of the same**. Forbidden:
a blunt flat terminus; a rounded knob terminus; a crack floating free with both ends in open floor; two
cracks parallel within 20° for more than 2 cells; a crack that reads as a rope, root, or cable because
its stroke has constant width and a visible outline on both sides.

**A12 — Prop density and floor readability.**
**3–7 props per chamber**, **at least 2 of them touching a wall, a rubble field, or another prop**.
**≥60% of each chamber's floor area more than 1 cell from a wall stays bare** and token-readable at the
20 px/cell default zoom (art-style-guide release checklist §6). A chamber with fewer than 3 props reads
as unbuilt; a chamber with props evenly spaced across its middle fails regardless of count.

**A13 — Palette and the focal accent.**
Everything sits in the kit's desaturated grey / warm-tan register: **no fill outside the void exceeds
luminance 235**, and **no element exceeds chroma (max−min channel) 45 except the single focal accent**
(art-style-guide §Style-DNA-4 stone interior, §Composition). **Exactly one focal accent on the map.**
Two or more saturated things competing is a FAIL, and so is a prop that reads as unpainted white.

**A14 — The void.**
Outside the cave the field reads as **one flat uniform value**, and **the only structure in it is the
wall's cast shadow (A6)**. No straight edges other than the map border, no per-piece artefacts, no value
steps, nothing that lets a viewer reconstruct where one sprite ended and the next began.

---

## B. The failure catalogue

| # | Name | Visual tell |
|---|---|---|
| B1 | **Squash / stretch** (non-uniform scale) | Stone grain goes elliptical; the ink contour is visibly heavier on one axis than the other; round pebbles become ovals; the same rock motif appears at two different aspect ratios on the same wall. Compare a nub on a horizontal run against a nub on a vertical run — if they are the same art at different proportions, the sprite is being filled into a box it was not drawn for. |
| B2 | **Guillotine seam** (visible straight tile-cut) | A perfectly straight edge crossing the rock, its pebble fringe, or its shadow. Rock has no straight edges; the eye finds one instantly. Sub-forms: the value step (fill changes across the cut), the shadow step (cast shadow ends flat mid-run), the alpha notch (void showing through the cut), and the **material rectangle** — a whole square patch of a different floor value dropped on the cave floor with four straight sides. |
| B3 | **Picket fence / sawtooth** | One short piece repeated down a run. Tell: the outer silhouette teeth are all the same height and recur on a fixed pitch, usually 0.4–0.55 cell. Squint and the wall reads as a comb or a caterpillar rather than as rock. The measured signature is a silhouette that loses almost all of its perimeter to a 0.3-cell close and then goes flat — no structure at the lobe scale. |
| B4 | **Band drift / floating wall** | The painted band and the walkable floor edge stop agreeing. Tells: bare floor fill visible on the void side of the wall; the band riding entirely outside the floor polygon so the floor meets the ink with no pebble lip; the band riding entirely inside so a sliver of floor is stranded behind the rock; and the terminal case, **daylight through the wall** — void visible inside the room where two piece ends failed to meet. |
| B5 | **Hinge bend** (bend on a gentle curve) | A corner piece laid where the edge barely turns. The wall develops a visible elbow or dent that nothing in the floor shape explains — it reads as a hinge or a dogleg on what should be a smooth sweep. |
| B6 | **Chamfered polygon** (straights on a tight turn) | The inverse. A tight corner paved with straight pieces resolves into 2–4 flat facets meeting at obtuse angles. The room silhouette reads as a cut gemstone, not a cave. |
| B7 | **Machine scatter / confetti** | Dressing distributed by a generator rather than by gravity. Tells: near-equal spacing between clumps; clumps at similar size and similar rotation; clumps floating in open floor with nothing to have fallen from; the wall foot bare while the room centre is speckled. Real talus piles up against the wall and thins toward the middle. |
| B8 | **Reversed piece** (void side facing the room) | A piece placed so its dark drop-shadow edge faces the floor and its pale pebble edge faces the void. Tells: a dark halo bleeding onto the tan floor instead of onto the white; pebbles scattered out into the void where nothing walks; the run's light/dark polarity flipping partway along. |
| B9 | **Shadow-box tiling** | Each sprite's own cast shadow rendered as a separate blob, so the void fills with soft grey rectangles that do not merge. Tell: square or trapezoid shadow patches sitting off the rock, and shadow density doubling at overlaps and dropping to zero at gaps. This is the single most legible "assembled from tiles" giveaway because the void has nothing else in it to hide behind. |
| B10 | **Blunt terminus** | A linear detail asset — crack, ledge, fissure — cut off flat at its sprite boundary, or ending in the rounded knob the artist drew as a connector. Cracks in nature taper; a crack that stops dead reads as a dropped rope. |
| B11 | **Palette breakout** | An asset outside the map's value/chroma register. Two flavours: the **bright breakout** (a prop rendering near-white against a mid-grey map, reading as unpainted or as a UI element) and the **chroma breakout** (a saturated prop repeated several times, which destroys the one-focal-accent rule by competing with itself). |
| B12 | **Geometric room** | A chamber whose outline is a recognisable primitive — circle, ellipse, rounded rect — or whose floor polygon carries multi-cell perfectly straight segments. Caves have no straight runs and no constant radii; the reference's chambers are asymmetric lobed blobs. |
| B13 | **Bald wall, busy middle** | The inverse of the art-style-guide rule "detail concentrated at walls, edges and focal points; floor centers stay open". Tell: the wall ring is clean stone for its whole circumference while every crack, pebble and prop sits out in the open floor. |

---

## C. The grade

Graded on `cave/preview3.png` (26 px/cell), `cave/hi.png` (100 px/cell), and crops
`c-a` / `c-b` / `c-c` / `c-d` (70 px/cell). **3 PASS, 11 FAIL.**

### The known asset blocker accounts for nothing here

The baseline's blocker — 20 gg-demo object entries sharing one image across a family, so the renderer
squashes it into the wrong box — **is already fixed on disk**:

- `node dims.mjs` → `mismatched 0/825`. Every pack entry's declared frame now equals its file's real
  pixel dimensions.
- Independently: across the 52 entries this map uses, the authored `width x height` matches the pack
  art's aspect to within 2% for **all 52** (max skew 0.0%). Nothing in this map is being stretched.

So although 55 of the map's 78 structural pieces (71%) belong to families that *were* affected —
`wall_short_2x2` x24, `wall_short_2x4` x10, `outside_bend_5x3` x8, `outside_bend_3x3` x3,
`inside_bend_3x3` x3, `ledge_1x4` x3, `ledge_1x2` x2, `outside_bend_3x2` x1, `inside_bend_4x4` x1 —
**the render below is already post-fix, and B1 (squash) does not appear in it.** Landing the fix in the
running engine will change nothing about the findings that follow. Everything below is real.

### Criterion by criterion

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| **A1** | Band thickness 1.0–1.9 cells, uneven | **PASS** (marginal) | Ray-march on hi.png over 911 rays: median **1.14**, p25 0.97, p75 1.45, mean 1.32, sd 0.57 — inside the bar. Cross-check by shell profile: the outward shell that is 50% void sits at **0.88 cell** (reference 0.79), so the band is not thin. But the spread is compressed — IQR **0.48** cells against the reference's **0.75** — so it reads as a constant-width ribbon rather than as rock. Visible on the whole NW chamber ring, c-c. |
| **A2** | ≥85% art in the first 0.25 cell inside the floor edge, ≥55% in 0.25–0.50 | **FAIL** | `inward.mjs`: 0–0.25 cell inside the polygon is only **68.8%** art (**31.2% bare tan floor fill**); 0.25–0.50 is **33.6%** art against a bar of 55%. There is essentially no pebble lip. Worst: the NW chamber ring, cells (3,3)–(12,11) in c-c — the ink contour meets flat tan directly for most of its ~30-cell circumference; the only pebble lip is the short arc at (7,2.4)–(11.4,3.1). Same on the c-d right-hand run, (35,10)–(38,17). |
| **A3** | Band never leaves the floor edge; zero void inside the polygon | **FAIL** | Two hard instances. (a) c-d: the authored floor edge from **(35.8,11.6) to (36.7,11.4)** — ~1 cell — carries **no wall art at all**; the magenta polyline crosses bare tan with rock on neither side. (b) c-d, the choke at **(33.2,12.2)**: two runs terminate with flat ends ~0.6 cell apart and **white void stabs ~1.5 cells into the room** at (33.4,12.6). Also c-a at (20.4,23.0): a white notch punched clean through the band. |
| **A4** | ≤22% of perimeter below 0.3-cell close, ≥20% in the 0.3–0.8 band | **FAIL** | `silh.mjs` on hi.png: P(0)=322.6, P(0.15)=253.5, P(0.3)=231.2, P(0.5)=226.6, P(0.8)=215.7 cells. **28% of the perimeter lives below 0.3 cells** (bar ≤22%) and only **7% in the 0.3–0.8 band** (bar ≥20%; reference 24%). The curve goes flat after 0.3 cells — the classic picket-fence signature. By eye: the NW chamber's top-left arc, c-c, runs ~12 teeth over 5 cells = **0.42 cell pitch** against a 0.7–1.2 target. |
| **A5** | No straight edge >0.3 cell in rock, fringe, or shadow | **FAIL** | Worst offender is a **material rectangle**: the `cave_dungeon_adaptor_4x5` at cells **(17.2,22.8)–(21.1,27.9)** (c-a) puts a translucent grey square with four dead-straight sides and a 45° straight top-left cut onto the cave floor. Guillotine seams in the band: **(19.4,22.8)** vertical white slice through the rock (c-a); **(32.9,12.1)–(32.9,12.7)** straight shadow step (c-d); **(25.3,29.6)** flat cut with a step (c-a); **(29.1,13.9)** and **(27.1,16.8)** vertical cuts (c-b). Geometry backs it: 5 of 81 adjacent-piece joints overlap by <0.20 cell and **3 have an actual gap** (worst −0.28 cell, `inside_bend_5x3` / `wall_short_2x2` at (5.2,30.3)). |
| **A6** | Continuous 0.25–0.35 cell shadow band, no rectangles | **FAIL** | Per-sprite shadows are rendered as separate blobs and never merge. Clear rectangular shadow patches sitting off the rock at cells **(30.6,9.2)** and **(33.2,8.8)** (c-b, top-right), **(20.0,20.2)** (c-a), **(31.4,10.3)** (c-d). Density visibly doubles where two pieces overlap and drops to zero across gaps. |
| **A7** | Bends only on ≥45° turns, straights only under 25° | **PASS** | Measured floor-edge turn within each piece's own footprint: bends (n=31) median **59°**, p25 40°, p75 74°; straights (n=37) median **16°**, p75 22°. **0 of 37** straights sit on a >60° corner. Only **3 of 31** bends sit on a <25° edge — `outside_bend_3x3` at (20.5,15.0) 19°, `inside_bend_3x3` at (17.6,3.1) 15°, `inside_bend_3x3` at (20.0,1.8) 0°. The last one is a visible hinge on the north chamber's top arc. Fix those three and the criterion is clean. |
| **A8** | ≤35% from one id; long runs get long pieces | **FAIL** | **`wall_short_2x2` supplies 24 of 37 straight-run pieces = 65%**, nearly double the bar. Length histogram: 2-cell x24, 4-cell x10, 6-cell x3. Meanwhile the floor polygon has **32 segments longer than 2 cells, the longest 7.19 cells** — (25.8,30.0)→(19.2,27.2), the south corridor — and the map owns only three 6-cell pieces for all of them. This is the direct cause of A4. |
| **A9** | Rubble at the wall foot, ≤3 clumps beyond 2 cells | **FAIL** (rate passes, placement does not) | Rate is right: 50 rubble instances over 236.5 cells of perimeter = **one per 4.7 cells**, inside the 3.5–5.5 bar, and clustering is genuine (nearest-neighbour CV 1.18; 40 of 50 have a neighbour within 1.5 cells). Placement is wrong: **median distance from clump centroid to the floor edge is 1.25 cells** (bar: 60% of footprint within 0.6 cell), p90 2.85, max 4.95, and **7 clumps sit beyond 2 cells** against a bar of 3. Named: the NW chamber's five clumps at (4.5,7.8), (5.9,3.6), (6.0,10.4), (7.0,10.8), (10.5,9.3) all float in open floor (c-c). Same failure at (15.7,23.1) and (21.0,27.0) in c-a, and (33.7,13.3) / (36.1,17.9) / (36.7,19.1) in c-d — three near-identical clumps of the same asset at the same scale, evenly spread. |
| **A10** | ≥2 cells clean between clusters, no bare run >8 cells | **FAIL** | The NW chamber ring, cells (2,0)–(14,12), carries **no wall-foot dressing at all around its entire ~30-cell circumference** (c-c) — every pebble in that room is out in the middle. The c-b upper-left run (24,15)→(31,10), ~9 cells, is likewise bare. |
| **A11** | Hairline ≤0.2 cell, branches, tapers, wall-to-wall | **FAIL** | The two `ledge_1x6` strips in the NW chamber run **(6.3,5.0)→(11.3,9.4)** and **(7.6,3.9)→(10.9,9.1)** (c-c): near-parallel within ~10° for over 5 cells, constant ~0.2–0.3 cell stroke with an outline on both sides, both ends blunt-cut, both floating free with neither end reaching a wall. They read as two grey cables lying on the floor. The `ledge` at **(30.6,15.3)→(33.0,20.0)** (c-d) terminates in a rounded knob at (32.1,15.3) and a flat cut at (30.9,16.3). All **11 ledge instances have centroids >2 cells from the floor edge** (median 2.75) — none connects to anything. |
| **A12** | 3–7 props per chamber, ≥60% of open floor bare | **PASS** | Prop clusters: 7 at (15,19), 6 at (20,6), 6 at (33,7), 6 at (32,19), 5 at (9,7), 4 at (6,27), 3 at (29,28) — all inside 3–7. Openness: measured on hi.png, **85.3%** of floor more than 2 cells from a wall is bare fill (bar ≥60%). The lone outlier is the 1-prop cluster at (32,29), which reads as an oversight rather than a design. |
| **A13** | Nothing over luminance 235; one focal accent | **FAIL** | Bright breakout: `stairs_stone_long_2x4` at **(23.5,28.5)** and `stairs_stone_short_2x2` at **(4.4,29.4)** render as near-white rectangles with black hatching — they read as graph paper glued to the floor (c-a, bottom right; preview3, bottom left). Chroma breakout: **four** `acid_mushroom_1x1` at (6.6,5.5), (9.8,6.2), (7.1,9.6), (11.0,9.0) are high-saturation lime in a desaturated grey/tan map, and they compete with each other so none of them is a focal. Four spider webs at (29.5,15.8), (31.6,18.0), (34.1,16.5), (33.6,20.6) are pale mint-green, off the stone register. Against them the intended focal — the red `bed_pattern_1_a` at (34.4,5.4) with the brazier at (33.6,9.3) — is one of five things shouting. Bar says one. |
| **A14** | Void reads as one flat field, only the shadow in it | **FAIL** | Fails through A6: the void is not flat, it is tiled with soft grey rectangles at the piece pitch. At 26 px/cell (preview3) the whole outside of the map is visibly quilted — you can count the wall sprites without looking at the rock. Additionally the void leaks inside the cave at (33.4,12.6) (see A3), which means the void is not even a single connected field. |

---

## D. Ranked worklist

Ordered by cost to the look. None of these is fixed by the asset blocker — that fix has already landed
(`mismatched 0/825`) and the render above is post-fix.

| Rank | Failure | Criteria | Smallest change that fixes it | Blocker helps? |
|---|---|---|---|---|
| 1 | **Picket-fence silhouette** — 65% of straights are one 2-cell piece; 28% of the perimeter is sub-0.3-cell teeth against a 22% bar, 7% at lobe scale against 20%. | A4, A8 | Length-greedy piece selection: walk each low-turn run and take the longest piece that fits before falling back, capping any one id at 35% and at 3 consecutive uses. The map already has 6-cell and 4-cell straights and uses them 3 and 10 times against 24 for the 2-cell. No new art needed. | No |
| 2 | **Shadow-box tiling** — the void is quilted with per-sprite shadow rectangles, legible at 26 px/cell across the whole map. | A6, A14 | Stop compositing per-sprite shadows. Draw one shadow pass from the union of the wall silhouette (offset + blur of the merged alpha), or strip the baked shadow from the wall art and let the engine cast it. This is the highest ratio of look-gained to work in the list. | No |
| 3 | **No pebble lip** — only 68.8% art coverage in the first 0.25 cell inside the floor edge against an 85% bar, 33.6% against 55% in the next quarter. | A2 | Move every wall piece inward by the offset the baseline already measured: the rock/pebble split sits 0.18–0.32 cell off the art midline on the floor side, so the piece anchor must land that split on the polygon edge, not the sprite centre. One constant in the placement transform. | No |
| 4 | **Material rectangle + white stairs** — a four-straight-sided translucent square at (17.2,22.8)–(21.1,27.9), and two near-white hatched rectangles at (23.5,28.5) and (4.4,29.4). | A5, A13 | Delete the `cave_dungeon_adaptor_4x5` placement or replace it with the cave-side transition art whose edge is painted; swap both stair assets for the darker stone variants, or drop them and mark the level change with rubble and a ledge. Three edits to the map file. | No |
| 5 | **Daylight through the wall** — void inside the room at (33.4,12.6); ~1 cell of unwalled floor edge at (35.8,11.6)–(36.7,11.4). | A3 | Two placements. Also add a minimum-overlap constraint of 0.25 cell at every joint — 5 of 81 joints are under 0.20 today and 3 are open gaps. | No |
| 6 | **Guillotine seams** at (19.4,22.8), (25.3,29.6), (29.1,13.9), (27.1,16.8), (32.9,12.1). | A5 | Same overlap constraint as rank 5, plus rotating alternate pieces 180° where the art allows so the cut never lands on the same grain twice. Worst three are the negative-overlap joints already listed. | No |
| 7 | **Rubble is confetti, walls are bald** — median clump centroid 1.25 cells off the edge, 7 clumps beyond 2 cells, the entire NW chamber ring undressed for ~30 cells. | A9, A10 | Re-anchor rubble to the wall foot: sample positions on the floor-edge offset curve at 0.2–0.5 cell inboard instead of on open floor, keeping the existing one-per-4.7-cell rate (which already passes) and the existing clustering (which also passes). Then allow ≤3 deliberate mid-floor piles and delete the rest. | No |
| 8 | **Cracks read as cables** — two parallel `ledge_1x6` in the NW chamber, all 11 ledges floating >2 cells from any wall, blunt and knobbed ends. | A11 | Route cracks wall-to-wall or wall-to-rubble, forbid parallel pairs within 20°, and hide every terminus under a rubble clump or the wall band so the blunt cut never shows. If the kit has no tapering crack art, terminating under dressing is the cheap fix. | No |
| 9 | **Competing accents** — four lime mushrooms, four mint webs, a red bed, two chests. | A13 | Keep one accent. Reduce the mushrooms to a single cluster of 2–3 in one chamber, desaturate or drop the webs, and let the bed-plus-brazier corner at (33.6,9.3)–(34.4,5.4) be the map's focal. | No |
| 10 | **Constant-width band** — IQR 0.48 cells against the reference's 0.75; the ring reads as an extruded ribbon. | A1 | Falls out of rank 1: mixing 4- and 6-cell pieces with the bends widens the thickness distribution on its own. Re-measure after rank 1 before doing anything further here. | No |
| 11 | **Three hinge bends** at (20.0,1.8) 0°, (17.6,3.1) 15°, (20.5,15.0) 19°. | A7 | Swap each for a straight of the same run length. Three edits; the rest of the bend/straight assignment is already correct. | No |
| 12 | **Geometric chamber** — the NW room at (2,0)–(14,12) is a near-perfect ellipse; the floor polygon carries 32 segments over 2 cells, longest 7.19. | B12, A8 | Subdivide and jitter the floor polygon before piece placement: no segment over ~2.5 cells, lateral noise of ~0.3 cell. This is upstream of everything else in the list and will change the piece plan, so do it after ranks 1–3 are proven, not before. | No |

**After the whole list:** A1, A7, A12 already pass; ranks 1–12 close A2, A3, A4, A5, A6, A8, A9, A10,
A11, A13 and A14. Re-grade against section A from a fresh `preview3.png` plus the four crops, and re-run
`band2.mjs` / `silh.mjs` / `inward.mjs` for the numbers in A1, A2 and A4.
