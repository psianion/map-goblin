# Vulturing Elemental Sandbox for Good Goblin

Date: 2026-08-13
Sources:
- Tweet — https://x.com/chirovisuals/status/2086800825217606073 (38s video, 2.5k likes, 219k views)
- Playable — https://genex.games/world/elemental-sandbox
- Source — https://github.com/achrefelouafi/LinearAbiltyCastingThreeJS (MIT, 452 stars)

## What it actually is

One project seen three ways. A Three.js skillshot VFX sandbox: six abilities, two aiming
shapes, 938 live sliders, zero textures — every visual is procedural geometry, SDF/noise
shaders, or GPU particles. Not a game; a tuning rig with a character in it.

The three links are worth reading as three separate usability documents:

| Link | What it teaches |
|---|---|
| Tweet | How a dense tool sells itself in 38 seconds of unbroken motion |
| Genex page | Onboarding-as-one-paragraph; distribution/remix surface |
| README | The interaction architecture — arm/aim/commit, validity-before-commit, edit-while-paused |

Note the direct conflict with our own directive: their headline boast is "everything is
generated, no textures." Our standing bar (memory: real-art-textures-directive) is the
opposite for **art**. The reconciliation is a line worth holding explicitly: *art is
painted, overlays are shaders.* Their arrow, targeting circle, ground burns and molten
cracks are all SDF+noise — that is exactly the category where we should copy them, and it
doesn't touch the painted-battlemap gate at all.

---

## Ranked findings

### 1. AoE templates at the table, clipped by authored walls — the biggest single steal

Their `AimController` + `CastShape.LINE | ZONE` is precisely a VTT spell template. We have
`canvas/src/engine/rulerMeasurement.ts` in the editor and **nothing measuring at the
table** — `session/client/src` has no ruler, no cone, no burst.

Their design note is the one to copy verbatim: *"from the targeting side a far cast is a
line cast you only care about the far end of."* One controller, one `cast` event
(`origin, unit direction, distance`), two drawn shapes. Adding zone targeting required no
change to the things that consume the event. So: line / cone / circle / square templates
are one targeting layer, not four features.

The differentiator nobody else gets cheaply: **we already own wall geometry and
server-side LOS.** A fireball template that gets *clipped by the wall it can't see past*,
computed by the same code that computes fog, is the positioning line made literal — "the
map you drew is the game you run." Owlbear and Foundry both make you eyeball this.

Ship order: measure line (drag from token, feet readout, snaps to grid) → circle burst →
cone → wall-clipped fill as the reveal. First two are days; the clip is the demo.

Belongs to Sprint 5 (combat). Worth pulling the measure-line forward — it's the single
most-missed thing in a live session and it's small.

### 2. Validity shown before the click, never as a toast after it

`range` and `minRange` are per-ability; aiming inside `minRange` **tints the indicator red
and refuses the cast**. No error, no message, no undo — the shape itself says no.

Ours currently errors after commit in several places. Candidates for pre-commit refusal:

- Door placed off-wall → door ghost tints red until it's on a wall segment
- Wall endpoint beyond snap distance → the pending segment goes red, click does nothing
- Zone with zero/degenerate area → red fill
- Light dropped outside the map bounds → red ring
- Token dropped into solid rock at the table

This is exactly the PRODUCT.md voice rule ("errors say what happened and what to do") but
one step better: with a pre-commit tint there's no error to write. For a DM in a dim room
with players waiting, a refused click costs nothing; a committed mistake costs an undo they
have to find. **Highest value-per-line item on this list.**

### 3. Re-raycast every frame, not on pointermove — we have this bug

Their note: *"raycasts the pointer onto the ground plane every frame, not only on mouse
move, so orbiting the camera with a cast armed swings the indicator under a stationary
cursor."*

We do it the other way. `canvas/src/canvas/useCanvasInput.ts` feeds the tool preview only
from `onPointerMove` (`:218`, registered `:601`). `onWheel` (`:502`, registered `:607`) and
the pan paths change the camera without re-emitting. So: arm the wall tool, hold the
cursor still, scroll to zoom — the preview is drawn at a stale world point until you jiggle
the mouse. Same for pan-tool drag and any programmatic zoom-to-fit.

Fix is small and belongs in one place: cache the last screen position, and re-run
`engine.screenToWorld` + `_toolManager.onPointerMove` whenever the camera transform
changes, instead of only on pointer events. One change, every tool benefits.

### 4. Edit-while-paused — freeze the frame, reshape it against a still

*"P pauses; the editor keeps applying. Freeze a frame mid-eruption, then reshape the
silhouette, the palette and the timing against a still image."* Their stated reason for the
project existing.

Two applications for us, one internal and one product:

**Product — DM hold at the table.** A pause that freezes what players see while the DM
keeps editing: move a wall, add a light, redraw fog. Players see the frozen frame; the
change lands on resume. Right now editor and table are separate surfaces, so any mid-
session fix is a context switch with players watching. This makes the table the editor
without making players watch the sausage.

**Internal — lighting tuned against a frozen moment.** We shipped time-of-day and weather
(PR #84). Scrub to dusk, freeze, tune the torch falloff against that exact still. Tuning a
light against a moving clock is the reason lighting passes take three rounds.

Their supporting detail matters: the indicator runs on **real** time, not scaled sim time,
so it keeps animating while paused. Our equivalent — selection halos, the "your turn" ring,
drag ghosts — must survive a paused clock. (And still honor prefers-reduced-motion.)

### 5. Global multipliers over the per-object values

938 sliders, but the top folder is **Global**: speed, glow, noise, particles, lights,
impact intensity, camera shake, time scale — *multipliers* that scale everything at once
without destroying the authored values underneath.

We have per-light properties and no master. The DM ask is always "make this whole map
darker/warmer/foggier," and today that's forty edits or nothing. A small Scene Mood set —
global light intensity ×, global light warmth, ambient level, fog softness — that multiplies
rather than overwrites, is one undo step and reversible.

This is the single change that makes the existing lighting system feel like it has a dimmer
instead of forty switches.

### 6. Every folder collapsed by default

With 938 controls, *"one open section pushes the rest off the screen."* Their answer is
brutal and correct: everything starts collapsed. We already use collapsible sections in
`PropertiesPanel` / `LayerProperties`, with `openSections` state. Worth an explicit audit of
what we open by default now that the panel has grown — the default open set should be the
one or two sections you touch on 90% of selections, not "the ones that existed first."

### 7. Presets: we have them, we don't let users make them

`DUNGEON_STYLE_PRESETS` and ambient presets exist and both are hard-coded registries.
Theirs has a preset *manager* — save the current state, name it, get it back.

Cheapest high-value extension: "Save current as preset" on lights and on layer style. A DM
who has tuned a torch they like should not tune it again on the next map. Storage is
per-user, not per-map. Also unblocks preset sharing later, which is the pack system's
natural neighbour.

### 8. Ground decals that persist — the visual vocabulary for combat

Cinder Fall leaves molten cracks; Frost Lance leaves rime. Their decals are SDF+noise
shaders on the floor, and they outlive the effect that made them.

For Sprint 5 this is the whole answer to "what does a spell look like after it resolves":
a scorch that persists for N rounds and fades, authored as an overlay layer, server-owned
so players and DM agree. Fits the overlays-are-neutral rule (memory:
overlays-neutral-accent-themeable) if we keep them ink/white/desaturated rather than accent.

Also worth noting: this is a *state* channel, not decoration. "This square burned two
rounds ago" is information.

### 9. Modal tools that don't lock each other

*"Cooldowns are per ability too, so spending one slot never locks the other out."* And
press-the-key-again to disarm; Esc and right-click both cancel.

Ours: Escape exits the active tool (already a stated accessibility rule). Worth confirming
right-click cancels a pending wall/zone without opening a context menu, and that pressing
the same tool key twice disarms rather than re-arms. Small consistency sweep across
`defaultShortcuts.ts`.

### 10. The persistent, hideable key panel

Genex's onboarding is one paragraph that just lists the keys, plus **H to hide the help
panel**. No modal, no tour, no dismissed-forever state.

At the table, a DM two sessions in doesn't need it and a first-timer is lost without it. A
hideable keys card — not a tour — respects both. Our `StatusBar` already carries per-tool
hints; this is the fuller sibling for the table side.

### 11. One settings module as the source of truth

`config/settings.js` — *"the single source of truth for every parameter."* 938 controls are
only maintainable because adding a parameter is one entry that the panel reads. Ours are
spread across store slices, property components and the preset registry, so every new knob
costs a store field, a component, and a preset entry.

Not urgent, but it's the reason they can afford 938 knobs and we can't afford 90. Revisit if
the properties panel keeps growing.

---

## Distribution (from the Genex page, not the code)

Genex hosts the build with: play count (1.2k), author attribution, share, a comment thread,
and **"Remix with your agent."** The build was ported "unchanged apart from the build glue
that resolves your Genex identity."

We already publish maps to the server library (PR #82) and host campaigns from it. The
missing half is the *public map page*: preview image, author, play count, one-click "run
this," and fork-to-remix. That turns published maps from a personal library into a
distribution surface, and it's mostly UI over data we already store.

Flagging but not recommending yet — it's a product-direction call, not a usability one, and
publishing anything public needs your sign-off.

## The demo format (from the tweet)

38 seconds, 1920×1080, unbroken, no UI cutaways, no voiceover, capability density front-
loaded. 219k views on a tool with no product behind it.

Our nine-beat site already has this shape. The transferable rule is the *unbroken take*:
blank canvas → room drawn → torch lit → player joins → fog peels, in one continuous camera
move, no cuts to panels. Cutting to UI is what makes tool demos read as tutorials.

---

## Recommended order

1. **Pre-commit validity tint** (#2) — smallest diff, biggest felt difference
2. **Camera-change re-raycast** (#3) — real bug, one place, every tool
3. **Global scene multipliers** (#5) — makes lighting feel finished
4. **Measure line at the table** (#1, first slice) — most-missed live feature
5. **Save-your-own presets** (#7)
6. AoE templates + wall clipping (#1, full) — Sprint 5, with decals (#8)
7. Edit-while-paused (#4) — needs its own design pass, table/editor convergence

Nothing here is approved. This is a brainstorm, not a plan.
