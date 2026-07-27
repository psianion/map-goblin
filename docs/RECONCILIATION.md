# Reconciliation Plan — one canonical `table` monorepo

**Date:** 2026-07-17
**Status:** Approved, not started
**Outcome:** This repo (map-goblin) becomes the single canonical `table` monorepo. `labs-docs/migrate/` is harvested and deleted. labs-docs is retired to a frozen archive. No new technology anywhere — this is consolidation, not redesign.

## Why this repo is the base

Two diverged copies of the table monorepo exist:

| | `map-goblin` (this repo) | `labs-docs/migrate/table` (snapshot) |
|---|---|---|
| Live git history, CI-shaped PRs | ✅ main, linear, through 2026-07-16 | ❌ frozen snapshot |
| SP1 shim cleanup (fa63d45) | ✅ | ❌ |
| Jul-16 PR wave (#24–#30: grid UI, context menus, error surfacing, cursors, delete confirm, Docker) | ✅ | ❌ |
| `@dnd/core` + `canvas` (37 + 9 unit tests, 35 Playwright e2e) | ✅ | ✅ (older) |
| `@dnd/mechanics` (dice + module contracts) | ❌ | ✅ |
| `@dnd/srd` (334 monsters / 319 spells, fuzzy search) | ❌ | ✅ |
| `@dnd/game-runner-server` (110 tests: WS, SQLite, auth/invites, command router) | ❌ | ✅ |
| `@dnd/session-client` (router/pages/WS client, 2 e2e) | ❌ | ✅ |
| Room detection / room-binding tooling | ❌ | ✅ |
| Door tooling | ✅ (predates split) | ✅ |

Neither is a superset. Live history + newer core/canvas wins as base; the snapshot's four packages and room tooling get ported IN.

## Target layout

```
table/                          (this repo, renamed)
├── packages/
│   ├── core/                   @dnd/core          engine — as-is
│   ├── mechanics/              @dnd/mechanics     ported from snapshot
│   ├── srd/                    @dnd/srd           ported from snapshot
│   └── cdn-contract/           @dnd/cdn-contract  NEW — Zod schemas for the CDN contract, one copy
├── canvas/                     editor SPA — as-is
├── session/
│   ├── server/                 @dnd/session-server   ported (rename from @dnd/game-runner-server)
│   └── client/                 @dnd/session-client   ported
├── vault/
│   ├── engine/                 @dnd/vault-engine  ported from migrate/vault (rename from @map-assets/engine)
│   └── cli/                    @dnd/vault-cli     ported (rename from @map-assets/cli)
└── docs/
    ├── ROADMAP.md              the only living roadmap
    ├── RECONCILIATION.md       this file (archive when done)
    └── archive/                dated design docs harvested from labs-docs
```

Runtime boundary unchanged: vault code never imports canvas/session code — the CDN contract (`@dnd/cdn-contract`) is the only shared surface. Enforce with a lint rule, not a repo wall.

## Steps

Each step ends with the full suite green (`pnpm -r test` + canvas e2e). Don't start a step with the previous one red.

### 1. Port the snapshot packages
- Copy `migrate/table/packages/mechanics` and `packages/srd` into `packages/`. Wire into `pnpm-workspace.yaml` + `tsconfig.base.json`.
- Copy `migrate/table/session/server` → `session/server`, `session/client` → `session/client`. Rename `@dnd/game-runner-server` → `@dnd/session-server`.
- Align React to 19 across the board (snapshot client may lag) and dedupe to the root lockfile.
- Gate: snapshot's 110 server tests + 2 client e2e pass here, alongside the existing 46 unit + 35 e2e.

### 2. Port room detection/binding
- The snapshot's core has room-detection/binding tooling this repo's core lacks. Diff `migrate/table/packages/core` against `packages/core` and port the room modules **only** — do not regress the SP1 cleanup or the Jul-13/16 fixes. This repo's core is newer everywhere else; when in doubt, this repo's version wins.
- Room detection is the fog-of-war primitive for the session vertical slice — it's the reason this step exists.

### 3. Extract `@dnd/cdn-contract`
- New package: the Zod schemas from the integration contract (IndexFile, CatalogMeta, CatalogEntry, PackManifest) + inferred types.
- Point canvas's AssetPackManager and (step 4) vault-engine at it. Delete any local schema copies. One schema, importers on both sides of the CDN.

### 4. Fold vault in
- Copy `migrate/vault` packages → `vault/engine`, `vault/cli`; rename scope `@map-assets/*` → `@dnd/vault-*`. Node-only deps (better-sqlite3, sharp) stay isolated in these packages.
- **Known hole:** `engine/src/build/` (spritesheet pack + manifest emit + buildPack) is missing from disk but imported by index.ts and the CLI — the pipeline cannot run. Rewrite it minimal against the `@dnd/cdn-contract` manifest schema rather than hunting for the lost code. It needs tests; it currently has zero.
- Do NOT port: the dashboard (TODO-stub mockup) and the vault-api-server design (exists only to serve the dashboard). Re-entry trigger: a second non-technical person needs to manage packs.
- ⚠️ **Licensing landmine:** `dungeon-classic` sources appear Forgotten Adventures-derived (`D:/map-dnd/assets` = ~148k purchased FA images). Nothing deploys to a public CDN (`cdn.mapbuilder.app`) until the pack is re-sourced from CC0/licensed art or the FA license is confirmed to permit redistribution.

### 5. Docs consolidation
- Harvest into `docs/`: `ROADMAP.md` (distilled from `labs-docs/dnd/upcoming/2026-03-28-ecosystem-roadmap.md`), the CDN contract one-pager (next to `packages/cdn-contract`), the module/protocol one-pager (next to the `GameModule`/`ClientModule` types in mechanics).
- Move dated design docs worth keeping (ecosystem roadmap, forge, vault-api-server, dm-apprentice, keep) to `docs/archive/` — history and future reference, not current truth.
- Root `CLAUDE.md`: regenerate from what's on disk. No hand-typed test counts, no checkboxes — this corpus proved both rot.
- Design-doc rule going forward: a plan gets written when its milestone is **next**, not before.

### 6. Retire the old locations
- Delete `labs-docs/migrate/` entirely (table, vault, and the four byte-dup doc dirs — ecosystem, dm-apprentice, forge-ai, vault-api-server). Its only value was the code, which steps 1–4 consumed.
- Delete `labs-docs/dnd/`, `labs-docs/map-goblin/`, `labs-docs/map-assets/`, `labs-docs/dm-apprentice/` after harvest. labs-docs keeps only non-dnd projects (scrypt, sup, uxie, para-raid, claude). Git history retains everything.
- Rename this repo `map-goblin` → `table` (dir + remote). Root package is already `@dnd/table`. "Map-Goblin" survives as the canvas product codename.

## What happens to the map-goblin repo

It doesn't get archived or replaced — **it is the table repo.** Its history, CI, Docker packaging, and open PR cadence all carry forward under the new name. Nothing about its remote history is rewritten; the rename and the ported packages are ordinary commits on main.

## Tavern

Cleared out of labs-docs (2026-07-17) — landing page will be rethought separately from scratch. The old longrest.gg overworld code (Act 1 wired, Act 2 unreachable, worker without persistence) is recoverable from labs-docs git history if anything is worth salvaging. It is NOT part of this monorepo.

## Explicitly out of scope (re-entry triggers, not roadmap items)

| Deferred | Trigger to revisit |
|---|---|
| keep (managed hosting) | Paying self-hosted DMs asking for it — Docker image IS self-hosting v1 |
| forge (AI asset gen, Python) | Vault pipeline green + pack demand outstrips manual sourcing; stays a separate repo (polyglot) |
| vault dashboard + api-server | Second non-technical pack manager |
| mods as separate repos / marketplace / D&D Beyond bridge | Public plugin API milestone (the internal GameModule API hardens by use first) |
| dm-apprentice | Separate product, separate stack; connects via MCP later |
| tavern | Rethought separately |

## After reconciliation: the next milestone

Session vertical slice — the thinnest playable loop as three GameModules: tokens (place/move/sync), room-based fog (uses the step-2 room tooling), doors-open-reveal. One DM + two players on one map. Everything else waits for it.
