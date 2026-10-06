# Shell revamp — Editor and Table redesigned from scratch

Status: PLAN — awaiting approval. 2026-09-14. No code, no mockups yet.

Scope agreed in conversation: both surfaces, visuals AND interaction, design
first with canvas approval before any component is written. Direction of the
look was not given; section 2 asserts a default and lists the rulings needed.

---

## 1. What "from scratch" means here

Two layers exist in each app. Only the top one is redesigned.

| | Rebuilt from a blank page | Kept as is |
|---|---|---|
| Editor (`canvas/`) | `App.tsx` composition, left toolbar + tool popovers, right panel (layers, properties, assets, packs), maps sidebar + prep panel, status bar, floating action bar, context menus, all dialogs, toasts, chrome fade, tokens/theme | `@dnd/core` engine (~22.6k lines: Pixi renderer, geometry, tools, Clipper), the zustand store and its slices/commands/undo, `CanvasHost.tsx` + `useCanvasInput.ts` (rebuilt together, behaviour preserved) |
| Table (`session/client/`) | Landing, join, host wizard, game table composition, rail + popover frame, sidebar frame, log drawer + ticker, status bar, party strip / turn pill / roll bar, every popover body (initiative, fog, fog look, tokens, me, library, doors, lights, scene, world, session), toasts and prompt cards, hotkeys, tokens/theme, icons | `useSessionStore` + `sendCommand` + `WebSocketClient`, the `registerPanel` / `registerSidebar` seams and every `PanelDef.mount()` contract, all Pixi overlays (`TokenRenderer`, `DoorRenderer`, `FogRenderer`, `LightEditor`, `TurnRing`, `worldSync`), `anchor.ts` per-frame DOM placement, `GameRenderer.tsx`, server, protocol, redaction |
| Shared | One design system for both apps (today the table's theme is a hand-copied subset of the editor's) | Map art, art style guide, forge output |

Out of scope, deliberately: floors/levels, audio, on-table dice, Discord
Activity, any engine or protocol change, any change to fog/vision behaviour.
If the redesign finds it needs one of these, it is filed as a follow-up.

Sizes for planning (non-test source): editor shell ~15.7k lines tsx+css across
72 components; table shell ~9.3k lines across 44 components. 51 editor
shortcuts, 18 editor tools, 4 table routes, ~15 table popovers/sidebars.

## 2. Direction — asserted default, rulings needed

Anchors that already bind (from PRODUCT.md, the art style guide, memory):
product register, restrained colour, the map is the stage, no SaaS dashboard
chrome, accent never tints surfaces, canvas overlays white + ink only, no
modals mid-play, prefers-reduced-motion everywhere, text ≥ 4.5:1, Good Goblin
is the name. These are not reopened.

Asserted default for everything else (override any line):

1. **Palette is reopened, constraints are not.** Moss green was chosen in
   August over Verdigris and Goblin; the revamp explores three lanes again
   (Moss kept, a cooler slate-ink lane, a warm-ink lane keyed to torchlight)
   as full-board mockups, night mode first. Restrained stays the floor.
2. **Night is the default on both surfaces; the editor keeps a day mode, the
   table stays night-only.** DMs prep in daylight and play in the dark.
3. **One type family for chrome.** Today's Plex Sans + Newsreader + Plex Mono
   trio is replaced by one well-tuned sans in weights plus a mono for numerals.
   The serif goes unless a mockup earns it back.
4. **Icons are not hand-drawn minimal SVG again.** The 2026-09-01 set was
   rejected. Two candidates go to mockup: a licensed, consistent set restyled
   to one stroke language, or drawn/painted source art per the art style
   guide. The choice is a ruling, not a default.
5. **Editor and Table share a frame vocabulary but not a layout.** Same
   tokens, same primitives, same popover/menu anatomy, same motion. The
   editor is a workbench (persistent panels); the table is a stage (chrome
   retracts, one thing open at a time).
6. **Interaction model changes are scoped to what has a known problem or a
   settled direction**, listed in section 5. Nothing else changes for the
   sake of change; a DM who knows the current table should not have to relearn
   what already works.

Rulings needed before Phase 1 starts (answer any subset, the rest take the
default above): palette lane (1), day mode on the table (2), serif kept or
dropped (3), icon approach (4), and whether the Table must work on a tablet
for players (default: yes at ≥ 768px, phones read-only later).

## 3. Phase 0 — brief (one short doc, no visuals)

`docs/2026-09-xx-shell-v2-brief.md`. Per surface: purpose, who, state of mind,
one scene sentence that forces the theme, three named anchor references,
content ranges (0 / typical / max: layers, children, tokens, log lines,
initiative rows, prep triggers), every state (empty, loading, error, offline,
first run, power user), anti-goals. Written from the two structural maps
already gathered plus PRODUCT.md; a half-day. Approval gate: you read it.

Scene sentences, as drafted:

- Editor: a DM at a desk on a weeknight, lamp on, laptop, an hour to get a
  map ready; wants Figma-grade panel muscle memory without Figma's chrome.
- Table: a DM in a dim room with four players watching a shared screen or
  their own laptops; the map is the only bright thing and the chrome must
  vanish until asked for.

## 4. Phase 1 — design system v2 + mockups (the approval gate)

All artifacts local and uncommitted (docs stay untracked). Nothing is
published anywhere. Walked in Chrome on this machine, you rule in canvas.

**4a. Direction probes.** Three full-board HTML mockups per surface in
`docs/mockups/2026-09-xx-shell-v2/`, each a different lane (per ruling 1),
each showing the same real scene: Goblin Warren, DM view and player view for
the table; the layers + properties + toolbar for the editor with a real map.
Built at 1440×900 and 1280×800. You pick one lane per surface, or one for
both. Rejected probes are deleted the same day.

**4b. Tokens and primitives.** From the winning lane: colour (OKLCH source,
emitted as raw RGB channels so the existing Tailwind opacity modifiers keep
working), 4-step surface ramp with wider night steps, ink weights, one
accent, semantic four, type scale on a 1.2 ratio in rem, spacing, radius,
named z-index stack (dropdown → sticky → drawer → popover → toast → tooltip),
motion tokens (150–250 ms, ease-out-quart, one slow play-beat exception for
fog reveal, reduced-motion twin for each). State vocabulary for every
control: default, hover, focus, active, selected, disabled, loading, error.
Contrast is verified by script on every text × surface pair in both modes,
not eyeballed. Lands in one shared package, `packages/chrome/` (tokens.css +
tailwind preset + ~12 primitives: button, icon button, popover, menu, drawer,
dialog, field, number, slider, select, toggle, kbd, toast), consumed by both
apps. Written up as `DESIGN.md` at the repo root so the design tooling reads it.

**4c. Board replicas.** One clickable HTML replica per surface in the chosen
lane with real copy and real data, covering every region in section 1 and
every state in the brief: editor with 0 / 40 / 400 children in the layers
panel, all 13 property panels, all 8 tool popovers, context menu anatomy,
dialogs, chrome fade; table with all popovers, both sidebars, log drawer open
and collapsed, party strip vs turn pill, initiative in and out of combat,
offline banner, the four pages. This is the artifact you approve. Rule: no
component is coded before its replica state is approved.

**4d. Icons.** Per ruling 4, a mockup sheet of the full set (18 tools, ~30
table rail/menu glyphs, ~20 shared) in context on the replicas, not in
isolation. Separate approval.

Phase 1 is where the time goes. Two to three review rounds are expected.

## 5. Phase 2 — interaction spec

`docs/2026-09-xx-shell-v2-interaction.md`. State tables and a keyboard map,
plus the replicas made clickable for the flows below. Approval gate: you walk
the replicas in Chrome.

Editor changes (settled directions or known problems only):

- Context menus get the issue-48 anatomy: identity header → type
  quick-controls → type verbs → shared verbs → danger, one typed row union,
  per-kind contribution registry. Replaces the hand-rolled 553-line menu.
- Transform: restyled gizmo with live measurement chip + floating action bar
  that hides during drag + numeric section in properties (issue-48 ruling).
- Node editing: shape-coded handles, rope-dash outline with map dim, key map
  in status bar and near-node chip (issue-48 ruling; bezier engine work stays
  out of scope, the UI is designed to receive it).
- Tool popovers become one anatomy driven by a per-tool option schema rather
  than 8 hand-built bodies in one 936-line file.
- Properties panel becomes a field-schema renderer per child type instead of
  13 bespoke panels; same fields, one vocabulary.
- Right panel tabs, maps sidebar and prep panel keep their jobs; layout,
  density and collapse behaviour are redesigned. Zoom-to-fit insets are
  measured from the DOM, not hard-coded widths.
- Chrome fade stays as a behaviour, redesigned as a token (opacity, delay).
- A command palette (Ctrl+K) over the existing 51 shortcuts and the menu
  registry. Cheap because both registries already exist.
- All 51 shortcuts preserved; the toolbar is generated from the keymap so the
  two cannot drift.

Table changes:

- Shell topology is re-decided in the probes: rail + one popover (today) vs a
  retracting bottom dock vs a DM screen split. Player and DM may differ.
- The rulings from August stand unless a probe overturns them with you
  present: log on the right, Scene and World separate, Doors keeps an icon.
- On-map menus (door, token, light) share the issue-48 menu anatomy with the
  editor. `anchor.ts` placement contract unchanged.
- Armed-tool readout, non-blocking prompt cards, journal, prep sidebar keep
  their behaviour; redesigned visually and in density.
- Host wizard collapses from four steps to as few as the data allows
  (resume-live-session detection stays).
- Player surface designed at tablet width (per the ruling), touch targets
  ≥ 44px, one-hand token drag.
- Known tracked misses fixed in passing: zoom readout shows slider position
  not zoom; narrow-viewport log drawer insets 300px instead of overlaying.

## 6. Phase 3 — build the Table shell

Branch `shell-v2-table`, stacked on a `shell-v2-tokens` branch that lands
`packages/chrome/` first (small PR, both apps consume it, no visual change
yet). Then the table shell is replaced wholesale: pages, `shell/`, every
popover body, `components/`, hotkeys, icons. Old files deleted in the same
PR, not left beside the new ones.

Kept verbatim: `useSessionStore`, `sendCommand`, `WebSocketClient`,
`panels.ts` / `sidebars.ts` seams, every `PanelDef.mount()`, all Pixi
overlays, `anchor.ts`, `GameRenderer.tsx`, `compositor-check`.

Tests: the client suite (878 today) is partly shell tests; those are
rewritten against the new DOM, the pure-logic tests (`doors.ts`, `fog.ts`,
`sight.ts`, `tierPlan.ts`, `logFeed.ts`) are untouched. E2E lanes on 561x
updated for new selectors. Gate: docker on 562x, two-seat walk on Goblin
Warren in Chrome, DM + player, zero console errors, every replica state
reached, contrast script green, reduced-motion walked, tablet width walked.
Review pass on the built UI before the PR is proposed.

## 7. Phase 4 — build the Editor shell

Branch `shell-v2-editor`. `App.tsx`, `components/**`, `shortcuts/`,
`lib/toast.ts`, `index.css`, `App.css` (dead Vite boilerplate) replaced.
`CanvasHost.tsx` + `useCanvasInput.ts` rebuilt as one unit; the module-level
ref side-channel (`canvasMenuRef`, `zoomToFitRef`, `togglePopoverRef`,
`importImageRef`, `viewportInsetsRef` and friends) collapses into one explicit
canvas bridge object so the shell has a single seam to the engine.
`StatusBar` reads fps/ruler/cursor through that bridge instead of engine
internals. Store untouched.

Tests: editor suite rewritten where it tests shell DOM; store, geometry and
engine suites untouched. Gate: docker, Goblin Warren opened, every tool used,
every property panel edited, layers with 400 children scrolled at 60 fps,
export and publish walked to the table, zero console errors, contrast
script, reduced motion, review pass.

## 8. Phase 5 — consolidation

Delete the duplicated theme blocks, `chrome-style-guide.md` replaced by
`DESIGN.md`, design-system sync project refreshed (local only, never
published), memory updated. Ship each phase as one squash-merged PR:
tokens, table, editor. Three PRs, each proposed to you in one line first.

## 9. Quality bar (measurable)

- Contrast ≥ 4.5:1 on every text × surface pair, both modes, by script.
- Every interactive primitive ships all eight states; audit by checklist.
- No animation on layout properties; 150–250 ms; reduced-motion twin for all.
- Chrome interactions hold 60 fps with a 400-child layers panel and a live
  fog scene; measured, not assumed.
- Keyboard reaches every control on both surfaces; Escape always exits.
- Shell JS bundle no larger than today's per app; measured at build.
- All suites green (mechanics 438, server 243, client and editor at their
  post-rewrite counts, no test deleted without a replacement).
- Docker walk on both surfaces with zero console errors before any PR.

## 10. Risks

- **The engine bridge in the editor** is the one place a shell rewrite can
  break behaviour that is not covered by tests. Rebuilding `CanvasHost` +
  `useCanvasInput` together and walking every tool live is the mitigation.
- **Icons.** The quality bar rejected one attempt already. Deciding the
  approach before drawing anything, and approving in context, is the
  mitigation. If neither candidate clears the bar, the revamp ships on the
  best licensed set and icons become their own workstream.
- **Design fatigue.** Three probes × two surfaces × review rounds is real
  time. Rejected probes are deleted immediately; nothing lingers.
- **Test churn.** Shell tests are rewritten, not patched. Counts may go
  down before they go up; the gate is behaviour walked, not the number.
- **Runs are capped at one hour each.** Phases 3 and 4 are split into
  briefs per region (pages, rail, popovers, sidebars; toolbar, panels,
  layers, properties, dialogs), never one long run.

## 11. Sequence and approvals

1. Rulings from section 2.
2. Phase 0 brief → you read it.
3. Phase 1 probes → you pick lanes → tokens → replicas → you approve in
   Chrome, per surface. Icons approved separately.
4. Phase 2 interaction spec → you walk the clickable replicas.
5. Tokens PR (proposed, then shipped).
6. Table build → docker walk → PR proposed → shipped.
7. Editor build → docker walk → PR proposed → shipped.
8. Consolidation.

Nothing in 5–8 starts until 3 and 4 are approved.
