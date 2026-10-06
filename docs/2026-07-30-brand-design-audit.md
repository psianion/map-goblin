# Brand, Vision & Design Audit — 2026-07-30

Scope: every doc that defines what map-goblin is, sounds like, or looks like, across all apps — canvas (editor), session (runner client + server), forge, packs, packages/core — checked against each other and against the shipped surfaces (titles, favicons, package names, in-app naming).

## Inventory

| Doc | Governs | Verdict |
|---|---|---|
| `PRODUCT.md` (root) | Product vision, brand personality, design principles, a11y | Strong, but **untracked in git** |
| `docs/art-style-guide.md` | All visual output (release gate) | Strong; one dead link |
| `forge/STYLE.md` | Asset generation style | Strong; explicitly reconciled with art guide |
| `docs/2026-07-26-game-runner-gap-analysis.md` | Runner vision/architecture | Coherent; §1 snapshot now stale |
| `docs/2026-07-27-game-runner-5-sprint-tracker.md` | Roadmap + competitive bar | Current, ACTIVE |
| `canvas/README.md` | Editor identity + features | Stale facts, editor-only story |
| `packages/core/README.md` | Engine architecture | Good; one stale line |
| `packs/dungeon-classic/README.md` | Pack contract | Stale paths throughout |
| session/client, session/server | — | **No README at all** |
| Repo root | — | **No README at all** |

## Findings

### 1. One product, four names (high)

The vision docs agree on what the product is; nothing agrees on what to call its parts:

| Name | Where it appears | User-facing? |
|---|---|---|
| Map-Goblin / map-goblin | canvas README, PRODUCT.md, session tab title | yes |
| map-builder / **map-builder-scaffold** | canvas package.json, **canvas browser-tab title** | **yes — tab title** |
| Game Runner | gap analysis, tracker, core README | docs only |
| session | directory, `@dnd/session-client`, all client code | internal |
| table | root pkg `@dnd/table`, session tab title `map-goblin — table` | yes |
| `@dnd/*` | every package scope | internal |

Shipped brand surface today: the editor tab says `map-builder-scaffold` with a stock Vite favicon; the session client has no favicon at all; `canvas/README.md` opens with an image (`public/readme-goblin.png`) that does not exist.

**Recommendation:** canonize in PRODUCT.md — product **Map Goblin**; runner surface **the Table** (already the emergent name: root package, session tab title, and PRODUCT.md's own "must read as a table, not an admin panel"); pick the editor's public name (canvas or just "the editor"). Fix the two tab titles and favicons. Leave frozen internal package names alone.

### 2. Vision docs are coherent (pass)

PRODUCT.md, the gap analysis, and the sprint tracker tell one traceable story: zero-setup ("the map you drew is the game you run"), server-enforced redaction as trust model, DM-never-loses-visibility, same anti-references (Owlbear's client-side fog, Foundry's setup tax, Roll20's layer confusion). PRODUCT.md's design principles are literally the competitor pain points from gap analysis §4.6 promoted to principles. This is the healthy part of the doc stack.

Two deltas:
- **PRODUCT.md says Platform: web.** The tracker's Sprint 5 and gap analysis §5 commit to Discord Activity as a release surface. Add it (or explicitly defer it) in PRODUCT.md.
- **PRODUCT.md is not committed.** The brand's source of truth exists only on this machine.

### 3. Two brand voices, neither chosen (medium)

canvas README speaks cheeky goblin ("scrawl at goblin speed, no nonsense, just maps", goblin mascot). PRODUCT.md's personality is "warm, dramatic, dependable" and never mentions the goblin, the mascot, or copy voice. These can coexist (goblin = marketing voice, warm/dramatic = product feel) but no doc says so, and the runner shipped with neither — its only copy is utilitarian. Add a short Voice section to PRODUCT.md deciding the goblin's role.

### 4. Art direction stack (pass with notes)

The art-style-guide ↔ forge/STYLE.md split (asset contract vs scene contract) is explicit and correct; the guide's code line-refs still verify (`GRID_CELL_PX = 200` at textureManifest.ts:368).

- **Dead link:** the guide calls `docs/RECONCILIATION.md` "load-bearing" (licensing — FA-derived pack not redistributable), but the file exists nowhere in the repo; it presumably lives in the labs-docs archive. Restore it to `docs/` or point at the archive path explicitly. A licensing doc should not be a dangling reference.
- **Linework calibration tension:** STYLE.md says "not heavy comic outlines — structural dark seams"; the art guide says "dark ink outlines on every prop." Same intent, different prompt language — and prompt language is exactly what forge runs on. One reconciling sentence (ink-weight spectrum: heavier on structure, seams on texture elements) prevents drift.

### 5. No design guide for the chrome (high — this is the runner-shaped hole)

The art guide gates the canvas art exhaustively. The chrome — panels, toolbars, toasts, join screen, connection status — is governed by one sentence ("quiet, dark, restrained"). With one app that was survivable; now two apps build UI independently (canvas panels vs session panels/Toast/ConnectionStatus) with no shared tokens, palette, type scale, or component conventions. The "quiet dark chrome" will fork into two dialects sprint by sprint.

**Recommendation:** a short `docs/chrome-style-guide.md` — palette tokens, type scale, spacing, panel/button/toast anatomy, the 150–250ms motion rule, and PRODUCT.md's a11y checklist as its release gate. Doc first; a shared component package only if divergence actually bites.

### 6. Stale facts in shipped docs (low each; one cleanup pass)

- `packs/dungeon-classic/README.md`: "Ships with map-builder", source path `map-builder/public/textures/` — app is `canvas/` and that directory no longer exists (assets live under `canvas/public/packs/`).
- `packages/core/README.md`: "the **future** session (Game Runner)" — session exists and is three sprints in.
- `canvas/README.md`: claims 8 style presets (registry has 7: Stone Dungeon, Wood Tavern, Cave/Natural, Sewer, Crypt, Classic Dungeon, Dark Stone); broken mascot image; unexplained progress bar; and the feature story ends at "export or use them directly in your game" — the actual live runner, the product's whole differentiator, is absent.
- Gap analysis §1 "where we actually are" is now false (session/, mechanics, vault-engine all exist). It's a dated snapshot so this is expected — add one line at the top of §1 deferring to the tracker as current status.

### 7. The runner has no doc identity (medium)

session/client and session/server — the flagship of the 5-sprint plan — have no README. Architecture constraints (module registry, redaction in Broadcaster, panel registration) live only in sprint specs and code. A core-README-sized doc each is enough.

### 8. Accessibility claims need one verification (low)

PRODUCT.md commits to prefers-reduced-motion "on every animation." The session client has a `motion.ts` helper wired into components; in canvas the only hit is `App.css`. Verify canvas's JS-driven animations (map-switch fog transition, panel transitions) honor it, or scope the claim to the runner.

## Ranked actions (smallest diffs first)

1. Commit PRODUCT.md.
2. Fix canvas tab title + favicon; add session favicon. (Two files.)
3. Stale-facts pass: packs README paths, core README "future", canvas README (presets count, image, runner section), gap-analysis §1 note, RECONCILIATION link.
4. PRODUCT.md additions: naming table (§1), voice section (§3), Discord platform line (§2).
5. Write `docs/chrome-style-guide.md` (§5) — before Sprint 4 builds the combat UI, which is the biggest chrome surface yet.
6. session/client + session/server READMEs (§7).
7. Root README presenting editor + Table as one product.
8. Verify canvas reduced-motion coverage (§8).
