# Landing art pass — Direction D2, "The lit table" (2026-08-07)

User picked D2 from the direction board
(`docs/landing-mockups/2026-08-07-direction-board.html`). This plan scopes the
art pass from the quality plan's §3, re-grounded in D2, plus the trust-beat
dressing the user confirmed reads as boilerplate. Nothing here starts before
explicit approval.

## What D2 means (from the board frame)

The page is a warm-lit tabletop, not a void. Parchment/cream field
(`--parchment #e8dfc6`), visible wood table surface, the diorama sitting on it
like a physical model. Ink text on paper (`--ink #16180f`, body ≥4.5:1).
Goblin green as *text* on light surfaces uses the ink-margin shade `#5F7A14`
(board's `--goblin-ink`); `#B6D648` survives only where it's a filled surface
with dark ink on top (CTA button) — never as text on parchment. Beat 5
performs the actual nightfall: the world dims to the current night look and
returns — the one dark moment IS the story beat. Beat 8's door is carved into
the table edge. Seam = a crack in the table wood with molten green seeping
through (board's `.seam-crack`), same decided molten material.

## Phases (each a contained workflow, ≤5 agents, Sonnet workers + 1 Opus
review; Fable adjudicates between phases with anchor frames)

### A. World surface swap — the foundation, first and alone

Everything else sits on this; nothing runs in parallel with it.

- DOM: `tokens.css`/`global.css` flip — page field parchment, text ink,
  green text → `#5F7A14`, CTA stays `#B6D648` fill + ink text. Brand header,
  hero, kit, door section re-inked. Contrast pass on every copy block.
- Scene: `SceneRenderer.tsx` `NORMAL_BG '#0b0a08'` → warm table surround;
  surround/skirt textures (`textures.ts`, `composition.tsx`, `Diorama.tsx`)
  become wood table + parchment context so the diorama reads as a physical
  model. The unlit-baked-values rule holds (do NOT revert to lit-chain
  tuning).
- The `.grain` paper overlay and trust vignette re-judged on light ground.
- Triage cached wf_78bda4d6-657 fixes here: green-speckle cleanup and rain
  clip likely survive; composition vignette likely invalidated — resume only
  what survives, drop the rest.
- Verify: anchor walk frames vs the D2 board hero frame before any later
  phase starts.

### B. Beat 1 ink identity — D2's strongest beat

"You draw the map." literally as ink strokes drawing themselves on parchment
— stroke-by-stroke reveal of the map outline, on paper, before the walls
rise. This is the beat D2 exists for.

### C. Beat 5 nightfall + beat 4 palette retune

- Nightfall now *performs*: whole world dims from lit table to the current
  night look and back as the scrubber travels (`WorldTurns.tsx`, clockT bg
  lerp, torch pools holding warm against the blue).
- Beat 4 panes retuned for a lit world: DM pane = the lit table; player pane
  fog reads as shadow inside a lit room, not a black void. Pane split logic
  from S2 is kept untouched — palette only.

### D. Trust-beat dressing (user-confirmed boilerplate fix)

- Readable secret door prop: flat-red placeholder → wood/iron door that reads
  at the beat-4 camera distance.
- Vault-with-prize behind the secret door (the thing the players can't see),
  room props so both rooms read as places, not greybox.
- Divider seam treatment: molten green glow inside the DM/player pane divider
  — the "crack between two truths" standout from the routing proposal.
- Files: `mapData.ts`, `textures.ts`, `Diorama.tsx`, `focalAccents.tsx`,
  `SceneRenderer.tsx` (divider only).

### E. Beats 6/7 payoff + beat 8 door

- Beat 6 swap glow-to-room scale; beat 7 table lighting + legible map payoff
  (`TableScene.tsx` — also closes the tracked "beat-7 too dark" follow-up).
- Beat 8 doorstage recast as carved into the table edge (CSS + doorstage
  markup; eyes stay).

### F. Seam re-ground

- Material: molten green through a crack in the table wood (keep the decided
  molten quality, new wood-crack housing).
- Per-beat routing finally lands, data-driven in `seamRoutes.ts`, following
  the arc hairline → widens → eyes in crack → frames door → submit pulse.
- Constraints hold: green never tints the diorama, never overlaps a CTA at
  rest.

## Out of scope

- Eyebrow-chip removal rides the Marginalia grammar step, not this pass.
- Mobile hero rebuild (static image stands; recapture it on D2 in the gate).
- Lenis external-scroll follow-up, `window.__lenis` removal — pre-ship
  checklist, not art.

## Gate (quality plan §4, unchanged)

Full walk on the built bundle: every anchor frame judged against the D2 board
frames; wheel-scroll fps (baseline 60fps avg / p95 17ms, AppActivate
foreground protocol); zero console errors; reduced-motion + 390px passes;
mobile hero recaptured on D2.

## Sequencing

A → (B, C, D, E in any order, adjudicated between each) → F → gate. F goes
last because routing needs the finished backgrounds to route against.
