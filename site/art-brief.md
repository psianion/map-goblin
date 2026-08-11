# Art direction contract — landing page beats 0–8

Scored against: `docs/landing-mockups/2026-08-07-landing-concepts.html` (board frames) and
`docs/art-style-guide.md` (release gate). Screenshots referenced: `art-shots/brief/beat-N-{mid,end}.jpg`
(current build) vs `art-shots/board/frame-*.jpg` (approved). Every later phase builds to this file;
every judgment round scores against it. "Reads" below means: measurable in a screenshot eyedropper
at the stated pin, ±10% per channel unless noted.

## Palette (the only hexes allowed in the diorama)

| token | hex | use |
|---|---|---|
| void | `#0B0A08` | page/scene background, dungeon negative space |
| void-2 | `#12110D` | DM-pane background (beat 4 left) |
| sight-bg | `#080706` | beat 3 unseen darkness |
| stone | `#2B2E26` | day floor albedo |
| stone-deep | `#1D1F19` | explored-but-unseen floor dim |
| ink | `#16180F` | ALL wall strokes/outlines, day |
| night-ink | `#0C0E12` | wall strokes at full night (beat 5 end) |
| night-floor | `#232833` | floor albedo at full night |
| night-bg | `#06070A` | scene bg at full night |
| torch | `#EDA94E` | light pools, warm accents |
| torch-hot | `#FFD9A0` | pool cores only |
| wood | `#6D4A2C` (day) / `#54391F` (night) | door leaves |
| wood-lit | `#8A6138` | door/table highlights |
| table-wood | `#4A3420` → `#2A1E11` gradient | beat 7 tabletop |
| table-room | `#241A10` | beat 7 radial room glow |
| parchment | `#E8DFC6` | plaque only |
| goblin | `#B6D648` | eyes + CTA + voice text ONLY — never a material, never a light color |
| token-red | `#B53A3A`, token-blue | `#3A5BB5` | tokens, with 3–4px ink outline |

## THE global defect (fix before any per-beat work)

**The value relationship is inverted.** Board: floors are the mid tone (`#2B2E26`), walls are the
darkest thing in frame (`#16180F` thick strokes). Current build: walls render as bright caramel/tan
volumes (~`#8a6a3a`–`#a87f4a` under torchlight) while floors sit near-black. Every beat inherits this.
Contract: at any pin, a wall face samples **darker than the floor beside it** — wall faces ≤ `#20221a`
under peak torchlight, floor under the same torch reads `#4a4030`–`#6a5638` (stone × torch multiply),
floor outside pools reads ~`#2b2e26`. Wall *tops* may carry a thin `#3a3e33` lip so extrusion reads,
but the side faces stay ink.

Second global defect: **no ink-outline post-pass exists.** Everything is smooth-shaded boxes —
the "Unity demo" gate-fail. Contract: inverted-hull (or equivalent cheap) outline, `#16180F`,
~2px at 1440w, on walls, doors, props, tokens; matte materials only (no specular anywhere).

Third: **grid seams are invisible.** Contract: floor texture carries an etched grid at cell size,
stroke `#3a3e33` at ~50% (night: `#333a44`), visible when you look, gone at a glance — per style-guide
DNA rule 2. Bake into the floor texture, not an overlay line renderer.

Fourth: **stray red geometry.** Red patches sit on wall corners/stairs in beats 1–6 reading as
glitches. Red belongs to tokens and nothing else. Recolor stairs/props to wood/stone ramp values.

## Per-beat contract

### Beat 0 — Whisper
- **Exposure floor:** whisper text `#B6D648` on void; the map is *pre-dawn*: nothing above `#1a1710`
  except ≤2 faint torch embers at ≤25% of final intensity. No fully-lit room may exist yet.
- **Mid-pin:** void dominates ≥80% of frame; whisper legible; map hinted as barely-lit silhouette.
- **End-pin:** same, whisper complete.
- **Gaps now:** interior room is already fully torch-lit brown (beat-0-mid), and rooms are outlined
  in a pale *green-white* stroke — off-palette. Pre-ignition line color must be `#5a5d50` (the board's
  half-drawn ink remnant grey), not green.
- **Lighting:** ambient near zero; ember point lights intensity ≤0.25× final.

### Beat 1 — Ink ("You draw the map.")
- **Exposure floor:** the drawing lines themselves — stroke `#5a5d50`→brightening to parchment-lit
  `#8a877a` at the draw head — always read above void. Floors fade in behind completed lines at
  `#2b2e26` with grid seams already present.
- **Mid-pin:** partial line network on void, draw-head visible; NO lit interior, NO torch pools yet.
- **End-pin:** full 2-room + corridor plan as flat ink drawing; floors at `#2b2e26`; still flat
  (extrusion belongs to beat 2). Torches unlit.
- **Gaps now:** build shows a lit brown 3D room mid-draw with orange pools and a red prop — beat 2/3
  content leaking backwards. The flat→extruded reveal is the product argument; keep beat 1 flat and unlit.
- **Lighting:** ambient only, cool-neutral, ~`#1a1a16` floor read outside the drawing.

### Beat 2 — The rise (hero CTA)
- **Exposure floor:** headline `#E6E1D3` sits over VOID, not over lit map. Map occupies the right
  ~56% (board a1 grid: copy 44 / map 56); copy column background samples ≤ `#141210` everywhere
  behind text. Floor albedo reads ~`#2b2e26` with visible grid seams at mid-pin.
- **Mid-pin:** top-down orthographic (slight push-in allowed), walls at partial extrusion, 2 of 4
  torches lit; wall faces ink-dark; door leaves `#6D4A2C` with ink outline sitting IN wall gaps.
- **End-pin:** all torches lit, staggered ignition finished; one focal accent — the treasure glint
  `#EDA94E` dot + glow in the SE room (board hero has it; build has none); headline fully landed.
- **Gaps now:** camera is oblique/tilted (walls show perspective faces, map slides under the copy),
  walls are bright tan, pools wash the whole map to caramel, no focal accent, no door-in-gap read,
  grid absent. Board frame = clean top-down, black void margin around the map, discrete amber pools.
- **Lighting:** each torch = radial pool, core `#FFD9A0` ~35% opacity equivalent, mid `#EDA94E` ~16%,
  radius ~2.5 cells to transparent by 3.5 cells; floor between pools returns to `#2b2e26`. Pools
  light floors; wall faces stay ≤`#20221a`. Flicker per board keyframes (scale 0.97–1.02, opacity
  0.86–1.0, ~4.5s), no per-frame allocation.

### Beat 3 — Sight
- **Exposure floor:** the visibility wedge is the ONLY lit region: inside = beat-2 floor treatment;
  outside = `#080706` with explored-remnant at 18% opacity max. Wedge edge is a hard polygon edge
  (≤2px falloff) — soft-blurred fog fails the "real algorithm" claim.
- **Mid-pin:** token (red `#B53A3A`, 3–4px ink outline, `#EDA94E` 2px sight-ring at ~70%) mid-path;
  wedge visibly clipped by wall corners (at least one shadow spike from a wall edge in frame).
- **End-pin:** token at the door, door swinging, light spilling as a second wedge into the next room.
- **Gaps now:** build shows the whole map lit with a naked red disc floating in it — no wedge, no
  ring, no ink outline on the token, no darkness. The board frame is 70% darkness. This is the
  furthest beat from its target.
- **Lighting:** darkness is scene-level (`#080706` overlay/clear), not fog particles; torch pools
  render only inside the wedge.

### Beat 4 — Trust split
- **Exposure floor:** the two panes must be *obviously different maps*: DM pane (left, bg `#12110D`)
  shows full plan + amber dashed secret-door break (`#EDA94E` dash 5/5 across the wall gap) + circular
  "S" badge (`#EDA94E` fill, ink "S"); player pane (right, bg `#080706`) shows ONLY the west room —
  east room and secret segment absent from geometry. Player pane ≥50% pure darkness.
- **Mid-pin:** panes sliding apart from the single scene, divider `#26241D` 2px; pane tags
  YOUR VIEW (`#EDA94E`) / THEIR VIEW (`#90897A`) legible.
- **End-pin:** split settled; DM pane has both tokens, player pane only the red one.
- **Gaps now:** build's two panes are near-identical warm renders — the entire beat's argument is
  invisible. No badge, no dashed break, no missing geometry readable, oblique camera again. Camera
  must go top-down flat for this beat so plan-difference reads.
- **Lighting:** DM pane flat-ambient (readable plan, minimal pools); player pane keeps beat-3
  darkness treatment.

### Beat 5 — The world turns
- **Exposure floor:** at end-pin (full night) floors read `#232833` ±10, bg `#06070A`, wall strokes
  `#0C0E12`, doors `#54391F` — a *blue* frame with 2 warm pools holding. If the frame eyedroppers
  warm-brown anywhere outside torch pools at end-pin, the beat fails.
- **Mid-pin:** ambient mid-lerp — floors ~halfway `#2B2E26`→`#232833`, cool creeping in from frame
  edges; rain starting.
- **End-pin:** full night per above; torch pools unchanged in hue (`#EDA94E` — the "holding warm
  against the blue" contrast IS the beat); scrub UI (track, thumb `#AEBFE0`, dawn/noon/dusk/23:40
  ticks) present per board.
- **Gaps now:** build never leaves warm brown — no blue shift at all, so the beat currently shows
  nothing turning. Rain renders as chalky white ~white dashes scattered at random angles including
  over the void margin. Contract: rain = instanced streaks, uniform 112° angle, color
  `rgb(190 210 235)` at ~5–8% opacity, confined to the map footprint, length ~0.4 cell.
- **Lighting:** ambient color + intensity lerp on scrub; shadow azimuth wheels; torch lights keep
  color, may gain +10% intensity at night for contrast.

### Beat 6 — The swap
- **Exposure floor:** at all times ≥1 map is partially readable — no frame where everything sinks
  to void (the copy says "no blackout"). Outgoing map keeps beat-5 night grade; incoming map rises
  already carrying the DAY grade (`#2B2E26` floors, lit torches) so the swap also reads as relight.
- **Mid-pin:** outgoing walls sunk to ≤30% height, incoming map's floor plan visible rising.
- **End-pin:** new map fully risen, distinct silhouette from map 1 (different room arrangement),
  torch pools live.
- **Gaps now:** build's mid frame is just beat-5's warm room; end frame shows two dim overlapping
  slabs in murk — incoming map has no lit identity, whole frame under-exposed (~`#151310` mean).
  Also inherits: no outlines, bright walls, red patches.
- **Lighting:** two light rigs cross-fade; never both below 40%.

### Beat 7 — The kit (table pull-back)
- **Exposure floor:** the tabletop wood must read as wood: plank gradient `#4A3420`→`#2A1E11`, plank
  seams (repeating dark line ~every 46px at board scale), ink border; the map on it glows brighter
  than the table (map floor `#2B2E26`+pools vs table wood); room vignette radial `#241A10` behind.
- **Mid-pin:** pull-back in progress, diorama edges + table edge both in frame.
- **End-pin:** full board composition: glowing map centered, dice (red ~26px + blue ~20px, ink
  outlines, rotated), mug (radial `#6B4A2E`→`#40291A`, ink outline) on the wood, warm ellipse of
  room-light around the table, copy + CTA below/over void.
- **Gaps now:** build's table is a near-black trapezoid (~`#0d0b09`) — no planks, no wood color, map
  barely visible, dice are 2 tiny unlit specks, no mug, no room glow. Mean luminance of the table
  region needs to roughly triple.
- **Lighting:** one warm overhead (the "lamp over the table") pooling on the map + falling off
  across the wood; background stays `#0B0A08`.

### Beat 8 — The door (waitlist)
- **Exposure floor:** plaque `#E8DFC6` with ink border; door wood `#8A6138`→`#6D4A2C`→`#4E3520`
  vertical grade with plank lines; eyes `#B6D648` with ink pupils; all on near-void.
- **Mid/End-pin:** door centered, eyes above and blinking (~6s cycle), radial warm stage glow
  `#17150F` ellipse behind the door (board: 70%×55% at 50% 62%), faint `#EDA94E` rim ~12% around
  the door frame, hinges (2 dark strap shapes left side), plaque drop shadow.
- **Gaps now:** closest beat to board. Missing: the warm radial stage glow (build background is flat
  void so the door floats contextless), hinge straps, torch rim; door grade slightly flat. The dim
  table remnant behind the door is fine once beat 7 brightens. Minor beat — polish last.
- **Lighting:** static baked look; only the eye blink and (on submit) the door-crack light spill animate.

## Perf guardrails (carried, not negotiable)
DPR clamp 1.5 stays; outline pass = single inverted-hull or one fullscreen cheap pass, no SSAO/bloom
chains; rain instanced with a fixed buffer; palette lerps precomputed (no per-frame `new Color`);
frameloop demand outside pins.

## Scoring order for judgment rounds
1. Value inversion fixed (walls darkest, floors mid) — gates everything.
2. Beat 3 wedge + darkness. 3. Beat 5 blue night. 4. Beat 4 pane difference. 5. Beat 7 table
materials. 6. Outline pass + grid seams everywhere. 7. Beat 0/1 staging discipline. 8. Beat 8 stage glow.
