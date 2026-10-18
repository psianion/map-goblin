# Door & light icon audit — editor + table, DM + player

2026-08-24 · impeccable `audit` · run live against the deployed docker stack (images at main `af9f59c`):
editor 5621, table 5622 (campaign Gate Keep, invite HEJGFK, DM seat + player seat "Borin").
Code read on main. Register: product (`PRODUCT.md`).

## Audit Health Score

| # | Dimension | Score | Key finding |
|---|-----------|-------|-------------|
| 1 | Accessibility | 1 | Light/door popovers have no role, no focus management, no Escape, no keyboard path |
| 2 | Performance | 3 | Event-driven rendering, 1–2ms door round-trips; colour input commits per frame |
| 3 | Responsive/targets | 2 | Door marks ≈ 10px, light icons 24px at real table zooms — core interactions under 44px |
| 4 | Theming | 2 | Shipped LightPopover runs native Chrome-blue sliders + native colour input, fully off Moss |
| 5 | Anti-patterns | 3 | No AI-slop tells; deduction for editor-vs-table speaking two control grammars |
| **Total** | | **11/20** | **Acceptable — significant work needed** |

## Anti-patterns verdict

Pass. Nothing reads as generated: door state is baked into the door art instead of colour chips,
panels are quiet Moss dark, the join flow is genuinely good. The failures below are consistency
and craft gaps, not template smells.

## P0 — blocking

### 1. The table light-editing UI is not in git
`session/client/src/modules/lights/` (`lights.ts`, `LightEditor.ts`, `LightsPanel.tsx`,
`LightPopover.tsx`, `selection.ts` + tests) is **untracked on main**. PR #105 shipped the engine
half (`lightSync.ts`, LightingRenderer, LightTool) but this whole directory missed the squash —
same trap as the #108 stray test file. It only works in docker because images build from the
working directory. A clean clone or CI build silently loses the entire feature.
**Fix:** commit the directory (needs a PR — user approval required).

## P1 — fix before release

### 2. LightPopover is native-blue, off the design system
`session/client/src/modules/lights/LightPopover.tsx`. Confirmed live: Chrome-default blue range
tracks/thumbs and a native `<input type="color">` sit inside a Moss dark popover. Violates the
token system, the "accent only on state" rule, and product consistency (every other slider in the
app is `slider-minimal`). Also `<input type="color">` fires one `set-light` per input event while
picking (same defect as TokenPanel).

### 3. No focus/role management on map popovers (shell-wide)
LightPopover, DoorMenu, TokenMenu: no `role="dialog"`, no focus move on open, no focus trap, no
Escape-to-close, not keyboard reachable at all (the map click is the only path in). WCAG 2.1.1 /
4.1.2. PRODUCT.md promises "Escape always exits the active tool" — untrue for these.

### 4. Editor door states are illegible on the canvas
`packages/core/src/engine/doorRenderer.ts`. Closed = dark ink bar — near-invisible on dark stone
at working zooms. Open = 0x555555 arc — could not be distinguished live (glyph became two faint
posts). Secret badge (gold star, 0xe0b252): **never appeared** on the deployed editor after
toggling Secret on; either a render bug or drawn too small. Locked deliberately has no art. Net:
the DM cannot read closed/open/locked/secret apart on the editor canvas.
*Caveat:* the automation tab was throttled (rAF stalls when occluded) — re-check the secret badge
once by hand in a foreground tab before filing it as a render bug.

### 5. Hit targets at real table zooms
Door mark radius 0.26wu ≈ a 10px dot at the 36–45% zoom the table opens at; hit radius 0.45wu ≈
~20px. Light icons are fixed 24px (`LIGHT_ICON_RADIUS_PX = 12`). All under the 44px floor, and a
*missed* click in Lights mode closes the popover **and silently exits the mode** (shell rule).
Doors are the single player interaction — they deserve the most forgiving target on the map.

### 6. Click = toggle + menu on door marks
`session/client/src/modules/doors/`. A single click on a door mark toggles the door immediately
*and* opens the menu. An accidental player click opens a door and reveals fog before anyone
decides anything. The menu already has explicit Open/Close — click-opens-menu,
action-buttons-change-state would be the calmer contract. (Behavioral: user decision.)

## P2 — next pass

7. **Door marks full-bright over night fog** (known open decision, confirmed live): parchment
   ring/dot floats over unexplored black; reads as chrome pinned above the painting. Candidate:
   memory-tier opacity outside live sight.
8. **One icon, two grammars.** Editor light: hover ring+crosshair, click = generic selection with
   giant radius AABB, "12.0 × 12.0 sq" label, resize-handles-scale-radius (undiscoverable).
   Table light: click = popover, drag = move, no selection box. Same disc, different behavior on
   each surface.
9. **LightProperties (editor) vs LightPopover (table) diverge**: RADIUS "30 FT" with a stray bare
   "6" (cells) next to the slider vs "Radius 30 ft"; INTENSITY 0.20 (0–1) vs Intensity 20%;
   FALLOFF exists only in the editor. Same object, two dialects.
10. **DoorProperties panel inconsistencies**: WIDTH is a bare unitless number (cells?); the panel
    renders as a flat label block while LIGHT/GRID/ENVIRONMENT are collapsible section cards.
11. **Mode overlap**: opening Lights mode leaves an open DoorMenu on screen — two contexts at once.
12. **Icons carry no state**: a disabled/intensity-0.2 light and a blazing one render identical
    discs (fill = colour only); DM can't read on/off or brightness from the map in Lights mode.

## P3 — polish

13. Rail Lights/Doors glyphs are placeholder icon-sheet entries (known, sign-off pending).
14. Light drag snaps centre to pointer (≤12px jump) instead of preserving grab offset (known).
15. Slider keyboard arrows in LightPopover unverified (CDP can't test it — one hand check;
    sliders must be arrow-key operable for WCAG).
16. Editor canvas cursor/click cross renders theme-blue — canvas overlays are white+ink by
    decision; check the cursor sprite.

## Positive findings

- Redaction model verified live: player rail has no Doors/Lights modes, light icons never render
  for players, Lock absent from the player door menu, secret doors never ship unrevealed.
- Door state syncs both directions at 1–2ms; log line ("Borin opened Single 1") lands instantly.
- Doors panel: chip grouping (Open · 1), Frame action centring the map — good under time pressure.
- Join flow: invite pre-filled from URL, "Table found — who are you?", "Preparing map…" state.
- Zero console errors across all three seats for the whole walk.
- Door art carries state in the artwork, not in coloured status dots — right instinct, needs the
  legibility fixes above to actually deliver.

## Recommended actions

1. **[P0]** Commit `session/client/src/modules/lights/` (propose PR — not an impeccable command).
2. **[P1] `/impeccable polish`**: LightPopover → Moss controls (slider-minimal, tokened colour
   field, debounced colour commits); door-glyph contrast pass in doorRenderer (open arc + secret
   badge + closed bar legible on dark stone); icon hit-target floor.
3. **[P1] `/impeccable harden`**: dialog roles, focus trap, Escape, keyboard path for
   LightPopover/DoorMenu/TokenMenu; slider arrow-key verification.
4. **[P2] `/impeccable clarify`**: unify units and labels across LightProperties/LightPopover and
   DoorProperties (ft everywhere, one intensity notation, width units).
5. **[P2] `/impeccable polish`** (final): door-marks-over-fog treatment, icon state encoding,
   mode-overlap cleanup, drag grab-offset.
