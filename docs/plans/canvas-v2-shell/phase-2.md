# Canvas phase two: the renderer work behind the shell

Status: drafted 7 November 2026; order, scope and rules agreed with the user the same day; the mockup page mockups/phase-2.html was approved by the user on 7 November; the self-review below closes the edge cases; building starts when its open questions are answered. Phase one (the shell, the design system, the registry, every family) is on the `canvas-v2-shell` branch; see [README.md](README.md). Phase two is everything the shell exposes a control for but the engine cannot draw yet, plus the terrain brush model the user asked for after trying the result.

## Built

| Item | Commit |
|---|---|
| 0 Closeout: render checks pointed at the new shell, helper wait, suite split fast/slow | fe8fad6 |
| 1 Terrain brush model, Smooth blending, Fill, Intensity, format 3.5 | ffd0074 |
| 2 Floor opacity and per-floor edge band | 1b569cd |
| 3 Carve out, Mode row, Alt while drawing | 29f8db5, 8b78712 (Floor mode is its own flag, not the shared erase switch) |
| 4 Midpoint handles in node mode, Curve for floors, one flattening helper | 701fcd5 |
| 5 Corner style on walls, per wall and per layer, pieces classified in core | 6689ba0 |
| 6 Wall auto-join and Merge for two walls | fdffdd6, 22b2feb (Merge row and both lengths on the two-wall card) |
| 7 Freestanding doors on their own piece, 5 degree steps, format 3.6 | cfbfca2 |
| 8 Water brush, mask per layer, key W, format 3.7 | 82ceab4 |
| 9 Material brush, patches with the generalised border walk, key A | 552572b |
| 10 Path, units laid end to end along the line, key P | 86e968b |
| 13 Level clone and compare | b031898 |
| 16 Below-water props, format 3.8 | 69d6ee8 |
| 14 Trace image layer, Import as trace, toggle key J | a215617, 4c1d320 (drawing tools refuse on a trace layer with a plain message) |

Specs written and not run in wave 1: terrain-brush, floor-opacity, floor-carve, floor-node-mode, shell-frame-d (updated). In wave 2: wall-corner-style, wall-merge, door-freestanding. In wave 3: water-brush, material-brush, path-tool. In wave 5: level-clone-compare, prop-below-water, trace-image. Wave 4 is parked. At the last commit: core 2383 unit tests, canvas 1076, typecheck, lint and build green in both packages; nothing pushed.

### Battlemap image fix wave (8 November, from the user's first review)

Audit findings: the Image start never read the image, scaled it by a 70 px guess at the camera centre, the line-up box was one square capped at three cells, Use this grid only rescaled the image, Select move snapped the pointer delta so an off-grid picture stayed off-grid, no grid showed over a picture, the Battlemap layer had a generic sheet, no trace choice at import, and no grid detection existed.

| Commit | What |
|---|---|
| 2841ded | New map reads the picked image (pixels, "WxH" name hint), fills Fixed size, offers Use as Battlemap or Trace |
| 175b70b | Grid detection from the image's pixels (cell size, line offset, confidence) |
| 334d37c | Line-up as a whole-image W by H lattice with corner handles; Use this grid makes one image cell one map cell, lands on the origin, sets the fixed size, fits the camera; overhang under one cell does not grow the frame; format 3.9 (imageSource) |
| 326cd56 | Select move snaps a single picture, prop, light or label absolutely; grid lines drawn over every picture's footprint |
| 4a7924d | Battlemap layer sheet (Image section: file, Line up grid, Replace, Convert to trace); image card gets Line up grid and Use as; re-line-up snaps to the nearest grid corner; child lock when the layer holds other things; ImageLayer.placement in 3.9 |
| 6b773ae | VTT and Foundry starts pin to the nearest whole cell and fix the downscale drift |

Open after the wave: Ctrl+I, drop and paste still scale a picture to 5 cells as a prop (Use as Battlemap on its card is the route); multi-selections, floors and walls keep the delta snap; VTT battlemaps carry no imageSource; the Battlemap sheet and the line-up bar had no mockup frame and await the user's visual review. Spec written and not run: battlemap-image (6 tests).

Second review (8 November), one commit 1e72f46: the lattice box drifted because any mouse button started a drag that never checked for a held button; the grid over pictures read the Battlemap layer's wall colour while the swatch edited the active layer, and no grid read the snap step; the lattice floated with its own cell size so W and H never changed the map. Now the map frame is the W by H cells of the canvas grid, written live; the picture is scaled so one printed cell is one canvas cell and nudged by left-drag, arrows and a px-per-cell stepper; the floating box is gone; one camera animation path; the Grid lines swatch colours the active layer and every picture layer on the level; both grids draw one-pixel lines with half-strength lines at the snap step while Snap is on (the table keeps whole cells).

## Testing plan (end of phase two, awaiting the user's approval)

No browser test has run since phase one's last run. The suite now holds 333 tests in 40 files: 287 in the fast project, 46 in the slow project (23 `@render`, 23 `@cdn`). The 13 phase-two specs hold 17 tests.

Rules for the run: one Sonnet agent, through context mode, no builder; two workers, no retries; Playwright starts its own server on port 5175 and the agent kills it and every headless browser when done; every invocation runs once; a failure is reported by test title with its assertion text, never as a count. Before anything runs: typecheck, lint, unit tests and build green at the head, and no stray browser or test server alive.

One run, in three invocations, in this order, each stopping the plan if it shows the shell cannot boot:

1. **The phase-two specs** (13 files, 17 tests, about ten minutes). Proves each new control and tool does in a real browser what its item says: brush accumulation, floor opacity sample, carve and undo, midpoint insert, corner pieces, join and merge, freestanding door, water, material border, path width, clone and compare, trace toggle, below-water tint. First signal of wiring errors, since none of these ran while being written.
2. **The fast project** (`pnpm -C canvas e2e`, 287 tests, about thirty minutes on two workers). Proves phase two broke nothing in the shell, the families, home, keys, layers, export and publish. Includes the light footprint check from item 0.
3. **The slow project** (`pnpm -C canvas e2e:render`, 46 tests, about fifteen minutes; the `@cdn` half needs the pack CDN reachable). Proves the render checks under the new chrome and the item 0 fixes. The warren band and plateau references are expected to differ because the terrain ramp and sharp corners changed the look on purpose; those diffs are re-baselined, not fixed, after the user has seen the new images.

Then one root-cause analysis of every failure across the three invocations, each failure sorted into: the spec reads the new chrome wrongly, the code is wrong, or the reference is stale. One fix commit. Then the failed files only, once more. Then stop; no further run without the user.

Expected cost: about an hour of wall time and one agent; the fix commit is budgeted at one builder and one commit. Two choices for the user: whether the light footprint test (tagged `@lighting`, a pixel check in the fast set) is retagged `@render` first, and whether the `@cdn` half runs at all this time. Every commit passed typecheck, lint, the unit tests and the build in both packages. After each wave the public stack is rebuilt from the wave head and restarted so the user can review it live.

## TL;DR

Sixteen items, grouped into five waves by dependency. Every item is one builder, one mockup frame approved before code, one scoped spec, one or two commits. The waves are ordered by what the user feels first when drawing: the brushes and floors, then walls and doors, then the three new terrain tools, then colour and prefabs, then map-wide helpers. Before any of it, a short closeout commit fixes the three open pixel checks and splits the browser suite into a fast scoped set and a slow render set, so phase two never runs a 40-minute suite again.

## Rules that bind every item

1. **Mockup first.** No control, panel section, dock column or card field is built until its frame is drawn in `mockups/phase-2.html` and the user has said yes. Items that change only the renderer and reuse an existing control (floor opacity, corner style) still get a before-and-after picture in that page.
2. **One builder per item.** One Opus builder, briefed with this file's row, the Dungeondraft page and the family's phase-two comment. No helper builders. Sonnet only for read-only research through context mode.
3. **No browser tests during the phase.** Typecheck, lint, the unit tests and a production build run freely and are green before every commit. A builder writes its item's browser spec but never runs it. No browser test of any kind runs without the user's approval. At the end of the phase this chat lays out one testing plan (which specs, in what order, what each proves, the expected cost) for the user to approve; the runs, the root-cause analysis of the failures and the one fix commit follow that approval.
4. **A budget line per item.** Each brief states the expected commits and the expected number of browser runs (usually two: one while writing the spec, one before the commit). A builder that passes its budget stops and reports instead of pushing on.
5. **Registry stays the source.** A phase-two control is added by registering the setting the family's phase-two comment already names, with its home from the audit. The panel, dock and card render it; no surface code is written per item.
6. **Nothing lands half-drawn.** If the renderer cannot finish an item within its budget, the control stays unregistered and the item goes back on this list with a note of what was learned.

## Closeout before phase two (item 0)

One commit on the same branch, then the user reviews phase one.

- Fix the three open render checks from the phase-one suite: the light footprint sample points under the new chrome, the warren band reference fitted to the new viewport, and the plateau ring lift offset for the 112px dock. Fix the helper's wait for the shell test id after navigation so the frame specs pass on four workers.
- Split the suite: `@render` and `@cdn` specs move to a slow project that runs only on request; everything else is the fast set, under ten minutes on two workers. The scripts: `pnpm -C canvas e2e` for the fast set, `pnpm -C canvas e2e:render` for the slow set.
- Budget: one builder, one commit, no browser runs; the three render checks are fixed by reading the specs against the new chrome and the fixes are verified in the end-of-phase testing plan.

## Waves

| Wave | Items | Why this order |
|---|---|---|
| 1 Brushes and floors | 1 Terrain brush model, 2 Floor opacity and edge band, 3 Carve out, 4 Node mode handles and floor curve, built together as one workstream in that order, one commit each | The first minute of drawing a map is terrain and floors; these are the controls the user already saw in the mockups and found missing; 2 to 4 are small engine changes and go in the same pass as the brush |
| 2 Walls and doors | 5 Corner style, 6 Wall merge and auto-join, 7 Freestanding doors | Walls are drawn next; both corner pieces exist in the sets already |
| 3 New terrain tools | 8 Water brush, 9 Material brush, 10 Path | New tools with new masks and renderers; each is its own family entry already named in the flyout list |
| 4 Colour and prefabs | 11 Colour per region, 12 Save as prefab | Depend on pack declarations; the pack format change is one decision for both |
| 5 Map-wide | 13 Level compare and clone, 14 Trace image, 16 Below-water layer | Useful but not on the drawing path; 16 waits for 8. 15 Label font faces was dropped on 7 November: one font for everything for now |

## Items

Each row: what the user gets, the engine work, the registry work, the reference, the mockup, the test, the budget. Budget sizes: S is one commit and about two scoped runs; M is two commits; L is three or more and needs a mid-way check-in.

### 1. Terrain brush model (Dungeondraft style)

- **User gets:** holding the brush on a spot keeps adding texture; intensity sets how fast; a low intensity gives the organic look; a Smooth blending switch softens edges; Fill floods the enclosed floor with the slot's texture; Erase mode paints back to the floor's own texture; the 0.4 display threshold goes, so every strength is visible.
- **Engine:** per-frame accumulation while the pointer is down, with intensity as rate per second; blend mode flag read by the terrain shader; flood fill bounded by the floor outline; erase as negative accumulation; the threshold replaced by a smooth curve.
- **Registry:** Terrain brush panel gains Smooth blending and Fill enclosed floor; Strength is renamed Intensity; Erase already exists.
- **Reference:** Terrain brush page, "the longer you click, the more texture is added", smooth blending before and after pictures.
- **Mockup:** frame B of the Terrain brush with the two new panel rows and the Fill button in the Textures column.
- **Test:** unit tests on the accumulation function (time, intensity, ceiling, erase); one spec that holds for one second at two intensities and samples a pixel each.
- **Budget:** M.

### 2. Floor opacity and per-floor edge band

- **User gets:** the Opacity row on the floor card and the default in the Floor panel work; a floor can pick its own edge band instead of the layer's.
- **Engine:** alpha per floor in the floor renderer; the band renderer reads a per-floor band id with the layer's as fallback.
- **Registry:** register `floor.opacity` (panel default and card field) and `floor.edgeBand` (panel default and card field), already named in the Design family's phase-two comment.
- **Reference:** Pattern shape tool, opacity.
- **Mockup:** frame B and frame D already draw these rows; a before-and-after picture of a floor at 50%.
- **Test:** a spec that sets 50% and samples; a unit test that the band id falls back to the layer.
- **Budget:** S.

### 3. Carve out on Floor

- **User gets:** a Mode row in the Floor panel, Draw or Carve out, and Alt while drawing as the fast path shown in the status hint; a carved shape subtracts from floors under it.
- **Engine:** polygon subtract through the clipper dependency, applied to every floor the shape overlaps on the active layer, as one undo step.
- **Registry:** register `floor.mode`; the hint shows Alt.
- **Reference:** Building tool, ALT drag.
- **Mockup:** frame B with the Mode section, as round two drew it.
- **Test:** a spec that draws a floor, carves a rectangle out, undoes; unit tests on the subtract across two floors.
- **Budget:** M.

### 4. Node mode with midpoint handles, and floor curve

- **User gets:** Node mode on the dock and the card shows a handle at every node and a smaller one at every midpoint; dragging a midpoint inserts a node; Curve on floors bends the segment the way it does on walls.
- **Engine:** midpoint handles in the node editor; the polygon tool honours curve mode; curve handles on floors.
- **Registry:** register `floor.curve` in the Edit column.
- **Reference:** Wall tool, Edit Points.
- **Mockup:** frame D with the handles drawn on the picked floor.
- **Test:** a spec that enters node mode, drags a midpoint, undoes; unit tests on insert.
- **Budget:** M.

### 5. Corner style on walls

- **User gets:** a Corner style seg in the Wall dock, Rounded or Sharp, per wall; the wall set's corner pieces are used.
- **Engine:** the wall renderer picks the corner piece by the wall's corner flag; both pieces exist in the sets from the start.
- **Registry:** register `wall.cornerStyle` (dock, and a card field).
- **Reference:** Wall tool, Bevel corners.
- **Mockup:** the Wall dock with the seg; a picture of the same wall both ways.
- **Test:** a spec that draws a wall, switches the style, samples a corner.
- **Budget:** S.

### 6. Wall merge and auto-join

- **User gets:** drawing to another wall's endpoint joins them; two picked walls show Merge on the card and the bar.
- **Engine:** endpoint snap and join in the wall tool; a Merge command with undo.
- **Registry:** Auto-join switch in the Wall panel (already named); Merge verb on the Select family, shown for two walls.
- **Reference:** Wall tool, CTRL continue, Merge.
- **Mockup:** the Wall panel with Auto-join; frame D with two walls picked and Merge in the row.
- **Test:** a spec that draws two walls end to end and checks one remains; undo.
- **Budget:** M.

### 7. Freestanding doors

- **User gets:** a Freestanding switch in the Door panel; a door placed in open space, rotatable in 5° steps.
- **Engine:** a door object not bound to a wall edge, with its own angle; light blocking follows its state as today.
- **Registry:** register `door.freestanding`; the card's Angle field becomes editable for these doors.
- **Reference:** Portal tool, Freestanding.
- **Mockup:** the Door panel with the switch; a card for a freestanding door.
- **Test:** a spec that places one and rotates it.
- **Budget:** M.

### 8. Water brush

- **User gets:** the Water brush in the Terrain flyout: a brush with Size, Shallow and Deep colours, Blend distance, Border on or off, Erase mode.
- **Engine:** a water mask layer per level, a shader that blends shallow to deep by distance from the mask edge, an optional border line, erase as mask subtraction, save and load of the mask.
- **Registry:** register the tool and its settings from the Terrain family's phase-two comment.
- **Reference:** Water brush page.
- **Mockup:** frame B for the Water brush, dock and panel.
- **Test:** a spec that paints water, changes Deep colour, samples; unit tests on the mask.
- **Budget:** L.

### 9. Material brush

- **User gets:** a freehand patch that closes into one solid piece with the pack's border art, "like scatter but fuller"; Size, material swatches, Smooth, Border on or off, Erase.
- **Engine:** a freehand mask, the cave band renderer generalised to lay a pack's border units along any outline, erase as subtraction.
- **Registry:** register the tool and its settings.
- **Reference:** Material brush page.
- **Mockup:** frame B for the Material brush.
- **Test:** a spec that paints a patch and checks the border is drawn; unit tests on outline extraction.
- **Budget:** L.

### 10. Path

- **User gets:** a Path tool: Width, Smoothness, Curve, Node mode, piece swatches; transitions in and out (hard, fade, grow or shrink); Snap; editable after placing; Block light.
- **Engine:** individual unit pieces laid along a polyline, never stretched strips (decided 2 November); width and smoothness; transitions; a card with the fields.
- **Registry:** register the tool, its dock, panel and card.
- **Reference:** Path tool page.
- **Mockup:** frame B and frame D for Path.
- **Test:** a spec that draws a path with three nodes and changes its width; unit tests on piece placement along a curve.
- **Budget:** L.

### 11. Colour per region, and tint preview in the library

- **User gets:** art that declares colour regions shows one colour control per region on the card and in the stamp dock; the library preview shows the chosen tint before placing.
- **Engine:** packs declare regions (a mask per region); the renderer tints per region; the library tile renders the tint.
- **Registry:** the colour control already exists as one colour with alpha; it becomes a list when the asset declares regions.
- **Reference:** Objects tool, colourable assets.
- **Mockup:** the Stamp dock and the prop card with two region rows; a library tile with the tint.
- **Test:** unit tests on region tinting; a spec that sets a region colour and samples.
- **Budget:** L, and needs the pack format decision first.

### 12. Save as prefab

- **User gets:** a picked group becomes a pack-local asset in the library under Prefabs, placeable like a prop.
- **Engine:** serialise the group's children and their offsets into a pack entry; the library lists and places it.
- **Registry:** a verb on the Mixed card and the group card; a Prefabs chip in the asset panel.
- **Reference:** Prefabs tool page.
- **Mockup:** the Mixed card with Save as prefab; the asset panel with the Prefabs chip.
- **Test:** a spec that saves a prefab from two props and places it.
- **Budget:** M, after 11's pack decision.

### 13. Level compare and clone

- **User gets:** Clone on create in the Level column's menu; Compare levels draws another level at a chosen opacity under the current one.
- **Engine:** render a second level at opacity; clone copies a level's layers and children.
- **Registry:** the Level column's menu gets the two entries; a Compare row in the Layers sheet.
- **Reference:** Level settings page.
- **Mockup:** the level menu and the Layers sheet with Compare.
- **Test:** a spec that clones a level and compares two.
- **Budget:** M.

### 14. Trace image

- **User gets:** a background image layer with Opacity and a toggle key, so an imported image works as a trace.
- **Engine:** opacity on background layers; a key bound through the registry.
- **Registry:** the Layer sheet gets Opacity for background layers; the shared keys list gets the toggle.
- **Reference:** Settings tab, trace image.
- **Mockup:** the Layer sheet for a background layer.
- **Test:** a spec that imports an image, sets 40%, toggles it.
- **Budget:** S.

### 15. Label font faces (dropped 7 November: one font for everything for now)

- **User gets:** a Font row in the Label panel with two or three faces; the table renders the same face.
- **Engine:** the label renderer draws the chosen face here and at the table; the faces ship with the app.
- **Registry:** register `label.font`.
- **Reference:** Text tool page.
- **Mockup:** the Label panel with the Font row.
- **Test:** a spec that places a label in each face.
- **Budget:** none; not built in this phase.

### 16. Below-water layer

- **User gets:** props under water are tinted by the water.
- **Engine:** tint props by the water mask from item 8.
- **Registry:** a Below water switch on the prop card's Layering section.
- **Reference:** Water brush page, Below Water layer.
- **Mockup:** the prop card with the switch; a before-and-after picture.
- **Test:** a spec that places a prop in water and samples.
- **Budget:** S, after 8.

## Mockups

One page, `mockups/phase-2.html`, in the same style as `shell.html`, with every frame for every item listed above, drawn before any building. The user reviews the whole page once; building starts after that approval and follows the page to the pixel.

## Tests and budget for the whole phase

- Fast set: the family and shell specs, tagged, under ten minutes on two workers. Slow set: `@render` and `@cdn`. Both exist so the end-of-phase testing plan can run one scope at a time.
- Expected browser runs during the phase: none. Builders write specs and never run them. Typecheck, lint, unit tests and the production build are the gate for every commit.
- At the end of the phase: one testing plan from this chat, approved by the user, then the runs it lists, one root-cause analysis of the failures and one fix commit.
- One builder at a time per wave unless two items touch different engine files and the user agrees to a pair.
- The watcher runs every twenty minutes and reports a stall after thirty minutes without a file change and without a test process alive.

## Self-review: edge cases and the decisions taken

Reviewed 7 November against the approved mockup page, the phase-one code, and the table client. The table imports the core engine for map rendering, so renderer changes made in `packages/core` reach published maps without table work; the table client itself is never touched in this phase, so the two gaps that leaves are called out below as accepted.

### Across every item

- **Map format.** Each wave that adds data bumps the format version once, in `canvas/src/io/mapFile.ts`, with a fixture test that an old map loads and a new map round-trips. The table reads maps through the same core parser, so item 0 adds a test that the parser the table uses accepts the new version.
- **Undo.** Every new engine operation (carve, fill, merge, clone, insert node) is a command on the existing command layer with a single undo step.
- **Export and publish.** The PNG export pipeline and the table both draw through the core renderers; each wave's approved run includes the export spec so water, material, path and opacity are known to reach exports.
- **Reference images.** The terrain model and the threshold change how existing paint looks, on purpose. The end-of-phase run re-baselines the warren band and plateau references; a diff there is expected, not a bug, and the testing plan says so before anyone reads it as a failure.
- **Keys.** The mockup letters are placeholders. Material brush cannot be M (Measure holds M on the rail, which is always live); the registry's collision test picks a free letter and the report lists it. Water W and Path P are clear (Wall is in another family; Pan is G).
- **Curves.** Floors and paths can carry curved segments after wave 1. One shared helper flattens curves to segments at a fixed tolerance, used by hit-testing, the clipper, the band renderer and export, so no consumer sees a curve it does not understand.
- **Budget.** One builder at a time; the watcher checks every twenty minutes; a builder that passes its budget stops and reports.

### Per item

1. **Terrain brush.** Holding still must keep adding, so the tool runs a timer while the pointer is down and adds intensity × elapsed seconds, frame rate independent. Smooth blending is a flag on the terrain layer, saved with the map; toggling it re-renders that layer. Fill needs a floor under the pointer; over none, the hint says "No floor here" and nothing happens. Fill is one undo step. Erase is negative accumulation down to zero. The setting keeps its id so saved prefs load; only the label becomes Intensity. The 0.4 display threshold becomes a smooth ramp, which changes how existing maps look, as agreed.
2. **Floor opacity and edge band.** Alpha applies to the floor's fill and texture only; its walls, band, props and lights are unaffected and floors below show through. Edge band per floor is None or a band id, falling back to the layer's when unset; the band renderer takes the per-floor value first.
3. **Carve out.** Carves the active layer only. A carve that splits a floor yields two floors with new ids; a carve that removes a floor entirely deletes it; walls, rooms and doors on the floor are untouched. Regular polygons and rectangles carve as well as polygons. Carving a floor with curved edges flattens those edges first and the hint says so. Alt in Draw mode carves the one shape being drawn.
4. **Node mode and floor curve.** Dragging a midpoint inserts a node; Delete is disabled at three nodes. Curve handles show only in node mode. N stays reserved.
5. **Corner style.** Per wall, for all its corners. Where two separate walls meet, the corner is rounded only if both are rounded. A set missing a corner piece falls back to sharp with a development warning, never a crash.
6. **Merge and auto-join.** Merge is enabled only for two walls that share an endpoint and have the same type and set; otherwise the verb is disabled with a hint. Auto-join joins only to a wall of the same set. The merged wall keeps the first wall's id; doors on either wall keep their place along the new wall; undo restores both walls.
7. **Freestanding doors.** New door fields (position, angle, freestanding) and a format bump. The table has its own door module for toggling at the table; it is not touched in this phase, so a freestanding door does not draw or toggle at the table until the table pass. Known gap, accepted 7 November. The card's Freestanding switch converts both ways: anchoring snaps to the nearest wall within one cell and refuses with a hint when there is none. Light blocking treats the door as a short segment.
8. **Water brush.** One mask per level, saved with the map the way terrain paint is. Blend distance is in cells; the border is a thin line in the Deep colour; erase subtracts from the mask. The Shape option is drawn disabled until the shape placer exists. Water sits in the layer order like any layer, so it can go over or under a floor by layer order.
9. **Material brush.** Needs border units per material from the packs; today only cave ink has them. The brush ships with cave ink as its one material and the swatches fill in as packs arrive; border units per material are on the forge list for when the user asks what to build there next.
10. **Path.** Units are laid along the flattened polyline at the piece's own spacing; width scales the units; transitions are alpha ramps over the first and last few units. The pack's path entries already exist, so no new art is needed to start.
11. **Colour per region** and 12. **Save as prefab.** Parked until the pack format carries region masks and prefab entries.
13. **Level clone and compare.** Clone is a deep copy with new ids and remapped room, zone and prep references. Compare draws the other level's static layers at opacity under the current level, with no interaction, and is never exported or published.
14. **Trace image.** Opacity on background image layers; the toggle key is registered in the shared keys and covered by the collision test. A background image layer is excluded from PNG export and from publish by default, with a per-layer switch to include it.
15. **Label font faces.** Dropped: one font for everything for now.
16. **Below water.** Reads the water mask from item 8; a prop with the switch on but no water under it is drawn normally.

## Open questions

None open. Answered 7 November: the forge is not asked for anything yet, border units per material are noted for later; nothing in the table client is touched until its own pass; background image layers stay out of export and publish by default; one font for everything, so item 15 is dropped; the end-of-phase run re-baselines the render references.

## Decision log

| Date | Decision |
|---|---|
| 7 Nov 2026 | Phase two drafted as five waves, one builder per item, mockup before code, scoped tests only, full suite only with the user's permission |
| 7 Nov 2026 | Mockup page approved; no forge or table work inside phase two (forge asks and the table door module are noted for their own passes); item 15 dropped, one font for everything; trace layers out of export by default |
| 7 Nov 2026 | Wave 1 built as one workstream, terrain brush first; wave 4 parked for the pack format; render checks kept; one mockup page for all of phase two before any build |
| 7 Nov 2026 | Wave 1 decisions while building: Fill is a one-shot (click Fill, then click the floor; armed look is the existing toggle-on style, hint "Click a floor to fill · Esc cancels"); the edge band default starts unset and shows the layer's band; Paint or Erase is a terrain-only seg on the shared erase value; Floor's Draw or Carve out is its own flag so it never flips the brushes to Erase; the flattened-curve notice is a toast; in node mode the floor stays picked, the selection box hides, the floating bar and the card stay as frame 4 draws them, the card's Delete removes the picked node and is disabled at three nodes |
| 7 Nov 2026 | Wave 2 decisions while building: corner pieces classified by letter in core (A, C sharp; B, D, E rounded) until packs tag them, a forge ask for later; corner default Sharp for new and unset walls, so existing maps lose the random mix; floor-tool outlines follow a layer value the dock writes when nothing is picked; no new renderer pass for corners between separate walls, auto-join makes them one wall; Auto-join default on; Merge enabled only for two walls sharing an end with the same type, set and layer; freestanding doors are built on the existing door-on-its-own-piece, so the table draws and toggles them and the accepted table gap does not arise; angle steps 5 degrees; frame 7's "R rotate" key, its Placement and Fittings captions and its rotate and flip verbs were not built (keys are placeholders; the card keeps its shipped sections) |
| 7 Nov 2026 | Wave 3 decisions while building: the water mask lives on the dungeon layer painted on (not one per level), drawn just above that layer's floors so layer order decides over or under; water is colour only, no tiles needed; a material patch is filled with the material's paired floor (cave ink pairs with cave floor by set name until a pack declares the pairing), the pack dropdown and the From library tile wait for a second material pack and a Materials chip; the cave floor texture was already usable as a floor, a terrain slot and in the Textures chip; the path card carries two editable transition segs; paths are a new child type laid from the two 8-cell path units the packs hold, so curves lay as long chords until shorter units arrive (forge ask); the Material key is A |
| 7 Nov 2026 | Wave 5 decisions while building: Clone is a text entry under New level matching the shipped menu; Compare is view state with a None option and a disabled slider while off; the trace is its own per-level background image layer created by "Import as trace" under Import image (user's choice), at 40 percent, never in export or publish (user's rule, so the per-layer include switch was dropped), toggle key J; Fit Map stretches to the frame, Original is 70 px per cell centred; the below-water tint is a straight multiply by the water colour with no strength setting; a layer and level picker for export is a post-phase item that needs a mockup first |
| 7 Nov 2026 | No browser tests at all during the phase: typecheck, lint, unit tests and the production build gate every commit; builders write specs and never run them; one testing plan at the end of the phase, approved by the user, then the runs, one root-cause analysis and one fix commit |
