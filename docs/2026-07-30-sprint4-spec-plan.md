# Sprint 4 — "Finish Canvas & Table" — Brainstorm · Spec · Plan

**Created:** 2026-07-30 · **Status:** DRAFT for build
**Milestone:** the web app looks and feels finished — both surfaces, one design system, honest 60fps.
**Supersedes:** the tracker's original Sprint 4 (combat) and Sprint 5 (Discord) ordering — see §1.

## §1 Brainstorm — decisions (2026-07-30)

1. **Web-first.** The Discord Activity is parked as a future surface. Nothing new gets
   built for it; the seams that already exist (endpoints.ts single URL surface, auth.ts
   sole issuance module) stay dormant and untouched. Combat ("Run the Fight") moves to
   Sprint 5; web release becomes Sprint 6.
2. **Polish before combat.** The editor and table are not visually ready. The brand audit
   (`2026-07-30-brand-design-audit.md`) confirms it: the editor tab ships as
   "map-builder-scaffold" with a stock Vite favicon, the table has no favicon, doors are
   glyphs, chrome has no design guide and two apps are forking dialects. Combat is the
   biggest chrome surface yet — it lands on a settled design system, not before one.
3. **Assets:** `dungeon-classic` stays the *development* pack — it is FA-derived and never
   ships/redistributes. Forge (the asset-generation pipeline) gets fixed **in parallel**
   while the tools are perfected against dungeon-classic as the visual reference.
   Full replacement-pack generation is deferred until the tools settle; Sprint 4's forge
   exit bar is one regenerated category passing the art guide, not a whole pack.
4. **Brand canon:** the user-facing product name is **Good Goblin**; the runner surface is
   **the Table**; "map-goblin" is repo codename only and never appears in user copy. The
   editor's public name is decided in the brand lane (default: "Good Goblin — Editor").
   Frozen internal names (`@dnd/*` packages, directories) stay as they are.
5. **Perf:** the Sprint 3 fps miss gets cured, not re-documented. The layer cache (#17) is
   in scope; after it lands the player-seat fps row goes back to a hard asserted floor.
6. **Chrome look — decided 2026-07-30** from the two design explorations
   (`docs/design/chrome-directions.html` = the rules and the three greens;
   `docs/design/moss-system.html` = the component system built from the real components).
   Both are now inputs to D2, not open questions:
   - **Accent: Moss.** `#3f6b34` day / `#86b566` night; accent surfaces `#cdd4bf` /
     `#262c23`. Goblin yellow-green is the **brand** colour — landing page, mascot,
     marketing — and never appears in the interface. One focal accent per screen.
   - **Finish: ink & grain, sans headers.** The shared grain/ink-weight stylesheet ships
     (heavier ink on structure, seams on texture — the reconciliation in §2.1); every
     label including panel headers stays sans. No serif in-app, in any surface.
   - **Typeface: one self-hosted text face** for both apps, system sans as fallback. The
     Google Fonts CDN goes away in canvas (a live table must never wait on a CDN — the
     runner's existing no-webfont rule wins). Cinzel survives in marketing only.
     This is what finally makes the two apps render in the same face.
7. **Loose ends taken as defaults** (no decision needed; called out so they aren't
   discovered later): mode default = editor day, table night, both switchable, remembered
   **per user** not per app · goblin "quiet" toggle ships, hiding thresholds only and
   never functionality · radius scale declared at three steps (6px buttons, 4px controls,
   2px chips). The radius state is worse than the design doc found: canvas declares
   `--radius` **twice with different values** (`canvas/src/index.css:32` = `0.625rem`,
   `:61` = `0.25rem`) while session declares `0.25rem` (`session/client/src/index.css:38`),
   and `--radius-md` — referenced all over `canvas/src/components/ui/button.tsx` via
   `rounded-[min(var(--radius-md),10px)]` — **is declared nowhere**, so those buttons are
   silently falling back. One declared scale, the duplicate deleted · Sonner keeps its
   pill shape but takes its colours from tokens · semantic
   `success` = accent stays deliberate, with shape carrying presence state.
   `moss-system.html`'s "Sprint 3 is mid-flight" caveat is **resolved** — S3 shipped as
   `f11d342`, so retheming no longer churns a live gate baseline.
8. **Explicitly out of scope:** GitHub issue **#35** (forge anchored to the hand-painted
   style) is the D5 lane's tracking issue and is only partly discharged here — the exit
   bar is one category, so #35 stays open into S5. GitHub issue **#19** (node-based
   wall/path renderer with editable sprite composition) is a *feature* and is deferred to
   S5+; it is not part of the editor-finish lane. ⚠ GitHub #19 is **not** tracker task
   #19 — every bare `#n` in this doc is a tracker task number, and the two namespaces
   collide at 19 only.

## §2 Spec

### §2.1 D1 — Brand & docs surface

- Tab titles + favicons for both apps: editor loses "map-builder-scaffold" + Vite icon;
  table gets a favicon. Titles per §1.4 naming.
- Stale-facts pass from the audit: `packs/dungeon-classic/README.md` paths
  (map-builder → canvas/public/packs), `packages/core/README.md` "future session" line,
  `canvas/README.md` (7 presets not 8, dead mascot image fixed or removed, add the live
  runner to the feature story), gap-analysis §1 gets a one-line "current status lives in
  the tracker" note.
- New READMEs: `session/client`, `session/server` (core-README-sized: module registry,
  redaction-in-Broadcaster, panel registration), and a repo-root README presenting editor
  + Table as one product. All outbound text rules apply.
- PRODUCT.md gains the naming table, a voice section (goblin = marketing voice, warm/
  dramatic/dependable = product feel), and "Platform: web (Discord parked)". PRODUCT.md
  and docs/ remain untracked — repo convention.
- Art-guide housekeeping: restore or explicitly point the dangling `RECONCILIATION.md`
  licensing reference; add the one-sentence ink-weight reconciliation between
  `forge/STYLE.md` and the art guide (heavier ink on structure, seams on texture).

### §2.2 D2 — Chrome design system

- `docs/chrome-style-guide.md`: palette tokens, type scale, spacing, panel/button/toast/
  input anatomy, the 150–250ms ease-out motion rule, reduced-motion policy, and the
  PRODUCT a11y checklist as its release gate. Doc first; a shared component *package*
  only if divergence actually bites (audit's call, kept). The guide **transcribes**
  §1.6's decisions and `docs/design/moss-system.html` — that page already contains the
  six button variants, inputs/sliders/toggles, panels/sections/tabs/menus/dialogs and the
  two densities, built from the real components, so the guide documents it rather than
  re-deriving it. `chrome-directions.html` supplies the rules (one focal accent, tint by
  day / glow by night, ink-weight hierarchy, semantic ≠ accent, thresholds never during
  play).
- Session client: #25 — shared `Button` + `PanelListRow` primitives replacing the five
  hand-rolled button styles and duplicated row classNames; `aria-selected` review.
  Radius scale and Sonner tokens per §1.7 land here.
- Canvas: adopt the same token system (mirror session's tailwind tokens or equivalent
  CSS custom properties — canvas's stack decides the mechanism, the *values* are shared);
  panels/toolbars/dialogs restyled onto it.
- Typeface unification (§1.6): self-host the one shared text face, wire it into both apps
  with a system-sans fallback, and **remove the Google Fonts CDN link from canvas**.
  Verified touch points: `canvas/src/index.css:2` (the `@import url(fonts.googleapis…)`),
  `canvas/tailwind.config.ts:31-34` (display/mono/sans/body families),
  `canvas/src/index.css:72,103,161` (hard-coded `'Raleway'`/`'Space Mono'` families, two
  of them `!important`), and the `font-[Cinzel,serif]` utilities in `PackListPanel.tsx:35`
  and `AssetBrowserPanel.tsx:260`. **Also tighten `canvas/index.html:10-11`** — the CSP
  currently whitelists `fonts.googleapis.com` in `style-src` and `fonts.gstatic.com` in
  `font-src`; both come out with the import, which is how the gate row stays honest.
  No in-app surface loads a webfont over the network.
- Contrast is **measured, not eyeballed**, against PRODUCT's ≥4.5:1 commitment before
  this lane closes — day-mode `text-muted` on `surface-1` is the known-tight pair.
- Reduced-motion verification in canvas: map-switch fog transition, panel transitions,
  any JS-driven animation honors `prefers-reduced-motion` (audit §8) — or the PRODUCT
  claim gets scoped.

### §2.3 D3 — Editor (canvas) finish

- **Audit-first:** an editor UX review lane (impeccable method, art guide + chrome guide
  as gates) walks the full authoring loop — draw walls/rooms, place doors/lights/props,
  paint terrain, save/load/export — and produces the fix list. The fix lanes execute it.
  (The complaint is "looks shit"; the audit converts that into named, fixable defects.)
- ~~Door sprites~~ — **moved to the door overhaul workstream**
  (`2026-07-30-door-overhaul-spec.md` §4 DD5); E1 no longer carries it.
- PixiJS `loadParser` deprecation migration in core's asset loading (20 warnings per
  load — cosmetic but on every console, and it's engine debt).
- Pack-install join budget: verify whether S2 parallelized `firstBootInstall`/
  `AssetPackManager` (the ~2.7s serial fetch+upload, ~85% of join). If not, fix now:
  parallel fetches, batched texture upload. S1's join < 5s metric re-verified after.

### §2.4 D4 — Table finish

- **#17 layer cache** — pre-render static map content (floors, walls, terrain, props)
  into cached render textures; invalidate on geometry/terrain change only, never on
  camera/fog/token frames. Exit: player seat holds ≥55fps asserted (target 60 recorded)
  on the dressed gate map, solo-seat measurement, and the ratio guard stays as the
  load-immune backstop.
- ~~**#18** door-toggle hitch~~ — **moved to the door overhaul workstream**
  (`2026-07-30-door-overhaul-spec.md` §4 DD4), where the fix follows from the unified
  occlusion path rather than a special-cased skip.
- **#12** — render-loop blast door: a throwing renderer module hides its own layer and
  logs once (terrain containment pattern generalized), never kills the loop.
- **#21** — DM rejoin: closing the tab and returning restores the DM seat (token
  semantics unchanged; this is session lifecycle, not new auth).
- **#22** — server names party rooms on the wire (removes the derive-drift class; the
  fail-dark sentinel becomes the anomaly path, not the mechanism).
- **#23** — terrain splat redaction, crop-to-explored-AABB variant (costed in the task):
  players receive splats cropped to explored bounds; DM untouched; client re-upload
  throttled; player persist never writes the cropped variant back.
- **#14** — explored-dim brightness reviewed on a dark map next to torchlit rooms; tune
  `EXPLORED_TINT` if it fails readability.
- **#19** — undo-toast click hazard: a click that misses the just-expired toast must not
  become a fog action (grace period or hit-area shield).
- Token visual polish per chrome/art guide (rings, badges, selection) — scope-fenced to
  restyling, no new token features (those are Sprint 5's).

### §2.5 D5 — Forge maturation (parallel lane) — GitHub #35

- Fix the forge pipeline end-to-end against dungeon-classic as visual reference:
  generation runs, manifest/pack contract current (paths per the stale-facts pass),
  output passes the art guide's checks.
- Exit bar: **one category regenerated** (doors or floor textures) that passes an
  art-guide review side-by-side with the dev pack. Full pack replacement is explicitly
  out of scope this sprint.

### §2.6 Acceptance

| Row | Verified by |
|---|---|
| Editor tab: real title + favicon; table favicon; no "scaffold"/codename strings user-facing | Browser walk + string grep of built bundles |
| `chrome-style-guide.md` exists; changed chrome in both apps on tokens (no raw palette values in touched files) | Review + lint/grep |
| Shared Button/PanelListRow in session; canvas panels on shared token values | Code review + visual walk |
| Both apps render in the same self-hosted text face; zero webfont requests to any external host on either app | Network panel in the gate walk + grep for `fonts.googleapis`/`fonts.gstatic` |
| Chrome contrast ≥4.5:1 on measured pairs, `text-muted` on `surface-1` included | Measured values recorded in the gate doc (not eyeballed) |
| One focal accent per screen; no serif in any in-app surface; Goblin green absent from the interface | Review against `chrome-directions.html` rules |
| Radius scale declared (6/4/2) and `--radius-md` resolves; no `rounded-lg` mismatch | Grep + review |
| Editor full authoring loop on the deployed stack: zero console errors, zero failed requests | Docker+Chrome gate walk (editor is IN the gate this sprint) |
| Table replay of the S3 demo + polish checks: zero console errors/failed requests | Docker+Chrome gate walk |
| Player seat ≥55fps asserted (target 60 recorded), solo measurement, dressed map, post-#17 | sprint4 e2e fps row |
| Join < 5s preserved with parallel pack install | metrics spec re-run |
| Reduced motion honored in canvas JS animations | Playwright emulation row |
| DM closes tab, rejoins, full DM seat restored | e2e row |
| Player receives cropped terrain splats only; leak row asserts bytes bound | wire test |
| Forge: one category regenerated, passes art-guide side-by-side | Review lane |

Door rows (toggle hitch, sprites) moved to `2026-07-30-door-overhaul-spec.md` §6.
| All prior suites stay green; typecheck/lint clean | CI-equivalent local run |

### Gate

Standing verification gate applies, extended: `docker compose up`, then Chrome-walk
**both apps** — the full editor authoring loop *and* the table session — on a dressed
map, every acceptance row, zero console errors, zero failed requests. Findings reopen
the sprint. Gate results doc: `docs/2026-07-30-sprint4-gate-results.md` (naming may take
the actual gate date).

## §3 Plan — lanes & waves

Model routing: planning/synthesis on the main loop; Opus for execution and debugging
lanes; Sonnet for shell/browser walks; impeccable loaded for every UI lane; art guide +
chrome guide pointed at every visual lane. Lanes are file-fenced to avoid collisions.

- **Wave 0 (audits, parallel, read-only):**
  - E0 editor UX audit (impeccable walk of the authoring loop → fix list)
  - P0 perf truth: pack-install status (did S2 parallelize?), current editor + table
    baselines, layer-cache design note (invalidation keys)
- **Wave 1 (parallel, fenced):**
  - B1 brand & docs surface (§2.1 — titles, favicons, READMEs, stale facts)
  - C1 chrome guide + tokens (§2.2 — doc, then session primitives, then canvas adoption)
  - T1 table perf (#17 layer cache) — the long pole, starts first (#18 moved to the
    door overhaul workstream)
  - T2 table robustness (#12, #21)
- **Wave 2 (parallel, after their inputs):**
  - E1 editor fixes from E0's list + loadParser migration + pack install (door sprites
    moved to the door overhaul workstream)
  - T3 protocol (#22, #23)
  - C2 impeccable polish pass over both apps' chrome (needs C1)
  - F1 forge lane (independent, runs whenever)
- **Wave 3:** #14/#19 residuals · full-suite verification · Docker image rebuild ·
  Chrome gate walk of both apps · gate results doc.

## §4 Risks (sprint-local)

- **Layer cache invalidation** is the sprint's hardest correctness problem: a stale
  cached layer under fog is a *rendering lie*. Invalidation keys must cover geometry,
  terrain paint, pack swaps, and scene switches; fog/door/token state must NOT
  invalidate. Mutation-checked tests like the S3 lighting-signature suite are the bar.
- **Canvas token adoption churn:** restyling editor panels can break canvas tests and
  muscle memory; fence to values/tokens first, layout changes only where E0 names a
  defect.
- **Brand rename bleed:** user-facing strings only; grep-driven; frozen internal names
  (`@dnd/*`, dirs, protocol) untouched. No history rewrite.
- **loadParser migration** touches core asset loading used by both apps — regression risk
  on pack loads; needs the pack-install e2e row green on both surfaces.
- **Forge scope creep:** the exit bar is one category. Anything more is Sprint 5+.
- **DM rejoin** is session-lifecycle surgery near auth; token issuance semantics must not
  change (S1.6's DM-token-minting hole stays closed — test pins it).
