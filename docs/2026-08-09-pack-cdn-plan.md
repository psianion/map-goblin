# Pack CDN — plan

2026-08-09. Goal: publish a pack without rebuilding or redeploying the app. Forge stays a
local tool the DM never sees.

## Status — Phases 0–4 built 2026-08-09

Code is done and green (963 core / 259 canvas / 214 vault-engine, plus new tests). What
remains is yours: create the R2 bucket and fill in `.env` (see the runbook below), then
Phase 5 — the floor batch — is the first real publish.

Five defects surfaced while building; all fixed:

| # | Defect | Why it mattered |
|---|---|---|
| 1 | `ensureBundledPack` had no version comparison | Reinstalled the bundled pack over a newer CDN copy on every reload — updates could never stick. The blocker. |
| 2 | `resolveManifestPath` returned the index's root-relative path, callers re-prefixed the pack id | Every manifest fetch would have 404'd at `/packs/<pack>/<pack>/pack-<hash>.json`. Invisible until a real generated index existed. |
| 3 | `updatePack` never refreshed `manifestCache` | Post-update readers saw the pre-update manifest until the next reload. |
| 4 | `cdnConfig` used `??` on an env var the Docker build sets to `""` | An empty build arg would rebase every pack URL to the site root. |
| 5 | `PackCard` used `bg-accent` / `text-accent` for the update affordance | `--accent` is the surface-3 token, not the brand green — the Update button and its label rendered as flat near-invisible surface colors. Same bug in the cache bar, which also used a raw `bg-yellow-500` outside the token system. |

Two more things found and *not* changed, flagged instead:

- `packages/vault-engine` schema rejected `door`, a type the shipped pack has used since
  PR #49 — the schema was stale, so `door` was added to the enum.
- `vault-cli`'s `forge.test.ts` fails on `forge/workflows/txt2img.json`, one of the files
  deleted in the working tree. Pre-existing, unrelated, left alone.

## What already exists

This is mostly a wiring job, not a build. Inventory:

**Server/build side — `packages/vault-engine/src/deploy/`** (all with tests)

| Module | What it does |
|---|---|
| `r2-upload.ts` | Cloudflare R2 S3 client, `uploadToR2`, `listR2Files`, `deleteFromR2`. Cache-Control already correct: content-hashed files (`-[a-f0-9]{8}.webp`) get `immutable, max-age=1y`, metadata gets `max-age=300` |
| `atomic-deploy.ts` | Three-phase publish: content files → pack manifests + catalog meta → `index.json` LAST. The index is the only mutable pointer, so the switch is atomic |
| `rollback.ts` | Restores an archived `index.json` from `_archive/<packId>/<version>/index.json` |
| `cache-purge.ts` | Cloudflare zone purge by URL |

**Build side — `packages/vault-engine/src/build/`**: `index-gen.ts` (`generateIndex`),
`catalog-gen.ts`, `manifest.ts`, `pack-sprites.ts`, `preview.ts`, `bundle.ts`, `pipeline.ts`.

**CLI — `packages/vault-cli`**: `validate`, `build`, `compose`, `index`, `forge`.

**Client — `packages/core/src/engine/assetPackManager.ts`**

- `fetchIndex()` → `GET ${cdnBaseUrl}/index.json`, 5s timeout
- `checkForUpdates()` → compares installed versions to the index
- `installPack(packId, onProgress)` → resolves manifest from index, downloads, stores blobs in IndexedDB
- `updatePack(packId)` → **differential**: re-downloads only files whose checksum moved, returns `{changedFiles, unchangedFiles, downloadedBytes}`
- `uninstallPack`, `rehydrate`, 200 MB cache cap, hourly install rate cap
- `config/cdnConfig.ts` → `baseUrl: VITE_CDN_BASE_URL ?? '/packs'`

**UI**: `PackListPanel` lists installed packs, shows per-pack update badges, has a
"Check Updates" button, cache-usage bar.

## The four actual gaps

1. **No `index.json` exists.** `pack-builder index` can generate it; it has never been run
   against `canvas/public/packs/`. So `checkForUpdates()` 404s today, silently.
2. **No `deploy` command.** `vault-engine` exports `atomicDeploy` + `createR2Client` +
   `purgeUrls`; nothing calls them. `cli.ts` registers five commands, none is `deploy`.
3. **No bucket, no origin.** `VITE_CDN_BASE_URL` is set nowhere — not in any Dockerfile,
   not in compose. Everything falls back to `/packs`, i.e. the bundle.
4. **No browse-and-install UI.** `PackListPanel` only renders *installed* packs. A DM has
   no way to see a pack that exists on the CDN but isn't on their machine yet.

## Target architecture

```
  YOUR MACHINE (never shipped)                      CLOUDFLARE R2 + CDN
  ┌────────────────────────────┐                   ┌──────────────────────────┐
  │ ComfyUI (local GPU)        │                   │ index.json      ← mutable│
  │   ↓ forge/ scripts         │                   │ dungeon-classic/         │
  │ forge/dist/GG_Xxx/*.png    │                   │   pack-<hash>.json       │
  │   ↓ pack-builder build     │  pack-builder     │   atlas-<hash>.webp      │
  │ dist/<pack>/  (webp+atlas) │  deploy           │   preview-<hash>.webp    │
  │   ↓ pack-builder index     │  ───────────────► │ fieldstone-set/          │
  │ dist/index.json            │  atomicDeploy     │   ...                    │
  └────────────────────────────┘                   │ _archive/<pack>/<ver>/   │
                                                   └───────────┬──────────────┘
                                                               │ GET (public, read-only)
                                                   ┌───────────▼──────────────┐
                                                   │ DM's browser             │
                                                   │  fetchIndex()            │
                                                   │  installPack() → IndexedDB
                                                   │  updatePack()  → diff only
                                                   └──────────────────────────┘
```

**Trust boundary**: the bucket is public-read, write-only-with-credentials. The R2 keys live
on your machine in `.env`, never in an image, never in the client bundle. The DM's browser
does plain `GET`s of static files. Forge, ComfyUI, `vault-cli` and the R2 credentials are all
on the publish side of the line and none of them appear in any Docker image today — verified:
the canvas runtime stage copies only `canvas/dist`, session-client only `session/client/dist`
+ `canvas/public`, game-server only `packages/core`, `packages/mechanics`, `session/server`.

**Bundled vs CDN**: `dungeon-classic` stays baked into the bundle via `firstBootInstall.ts`.
That is the zero-config, works-offline, works-on-first-paint baseline and it should not move.
But it is also the pack being continuously republished (see Roadmap), so the bundled copy and
the CDN copy share an id and precedence between them has to be explicit. See Phase 0 — today
the bundle silently wins, which is wrong.

## Phases

### Phase 0 — Fix the silent downgrade (blocking)

`ensureBundledPack` in `firstBootInstall.ts` runs on every boot and compares the installed
copy's content key to the *bundled* manifest's. If they differ **in either direction**, it
uninstalls and reinstalls from the bundle. There is no version comparison anywhere in it.

With one pack that only ever ships in the bundle, that is correct — it was written to stop a
browser pinning itself to its first-ever copy. With the same pack also coming from a CDN it
inverts:

1. DM has bundled `dungeon-classic` 1.2.0.
2. You publish 1.3.0 with the new floors. Their client updates. Good.
3. They reload. Bundled manifest is still 1.2.0, content keys differ → **uninstall 1.3.0,
   reinstall 1.2.0 from the bundle.**

Silent downgrade on every reload, and the CDN update can never stick. This blocks the whole
plan and it is the first thing to fix.

Fix: reinstall from the bundle only when nothing is installed, or when the bundled version is
*newer* than the installed one. Content-key comparison stays as the tiebreak within the same
version (it exists to catch art swaps that forgot a version bump — still worth keeping).
Needs a semver compare; there isn't one in `core` yet, and this needs ~10 lines, not a dep.

Test: install 1.2.0, simulate a CDN update to 1.3.0, boot twice, assert still 1.3.0.

### Phase 1 — Make the index real (small, no infra)

- Run `pack-builder index -d canvas/public/packs` and commit the resulting `index.json`.
  This alone makes `checkForUpdates()` stop 404ing against the local path.
- `index-cmd.ts` currently hardcodes `chunkCount: 0` and reads `dist/`; point it at the real
  pack dir and confirm `preview` fields resolve. `generateIndex` wants a `preview` per pack —
  `build/preview.ts` exists but no preview file is in `canvas/public/packs/dungeon-classic/`.
  Either generate one or make preview optional in the schema.
- Verifiable end state: dev server, "Check Updates" returns a clean result instead of an error.

### Phase 2 — `pack-builder deploy`

One new command file, ~80 lines, composing what already exists:

```
pack-builder deploy --dist dist --pack <id>      # publish one pack + refresh index
pack-builder deploy --dist dist --all            # publish everything
pack-builder rollback --pack <id> --to 1.1.0     # restore archived index
```

- Reads `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`,
  `CF_ZONE_ID`, `CF_API_TOKEN`, `CDN_BASE_URL` from `.env` (gitignored).
- Builds the `DeployContext` from `createR2Client` + `uploadToR2` + `purgeUrls`, hands the
  file map to `atomicDeploy`. Archives the index under `_archive/` for rollback.
- `--dry-run` prints the key list and cache headers without uploading. Non-negotiable for
  the first run.

### Phase 3 — Bucket + origin

- Create the R2 bucket, enable public read, attach a custom domain
  (e.g. `packs.<domain>`). R2 has no egress fees, which is why the code targets it.
- **CORS**: the client `fetch`es JSON and image blobs cross-origin. Bucket needs
  `Access-Control-Allow-Origin` for the app origins.
- Set `VITE_CDN_BASE_URL` as a build arg in `Dockerfile` and `session/client/Dockerfile`,
  plumbed through `docker-compose.yml` like `GAME_SERVER_URL` already is.
- Caveat worth being explicit about: Vite inlines env at build time, so *changing the CDN
  origin* still needs a rebuild. Adding, updating, or removing *packs* does not — which is
  the whole point.

### Phase 4 — Update UX (not browse UX)

There is one pack and it stays one pack, so "browse the catalog and install something new"
is not the flow that matters — **update-in-place is.** What a DM needs to see:

- an update is available, without hunting for the "Check Updates" button
- what they're getting ("6 new floor textures"), not just a version number
- how much it will download — `updatePack()` already returns `changedFiles` /
  `unchangedFiles` / `downloadedBytes`, and none of it is surfaced today
- progress, then a confirmation that the new art is live

`PackListPanel` + `PackCard` already render an update badge; this is mostly wiring the diff
numbers through and adding an apply action. A browse/install view only earns its place if a
second pack ever exists — defer it.

Run the `impeccable` skill on this per the standing rule.

### Phase 5 — Republish dungeon-classic with the new floors

The real test of the loop, and the next art batch anyway (see Roadmap). Forge 5–6 floor /
terrain textures, `pack-builder build` + `index` + `deploy`, bump to 1.3.0, then confirm on
a DM-side browser that the differential update pulls *only* the changed files — not 8.3 MB.
That number is the proof the whole plan works.

## Publishing runbook

### One-time Cloudflare setup (manual — needs your account)

1. **R2 → Create bucket**, e.g. `good-goblin-packs`. Location auto.
2. **Bind a custom domain** to it (R2 → bucket → Settings → Public access → Custom domain),
   e.g. `packs.<yourdomain>`. Use the custom domain, *not* the
   `*.r2.cloudflarestorage.com` endpoint — that one is the S3 write API, not a CDN, and
   browsers must never be pointed at it.
3. **CORS** on the bucket. The browser fetches JSON and image blobs cross-origin, so
   without this every install fails with an opaque CORS error:
   ```json
   [{ "AllowedOrigins": ["https://<your-app-origin>"],
      "AllowedMethods": ["GET", "HEAD"],
      "AllowedHeaders": ["*"],
      "MaxAgeSeconds": 3600 }]
   ```
   Add `http://localhost:5173` and `http://localhost:8080` while developing.
4. **API token**: R2 → Manage API Tokens → Object Read & Write, scoped to this bucket only.
5. `cp .env.example .env` and fill it in. `.env` is gitignored — keep it that way.

### Publishing a new version

```bash
# 1. build the pack from source art (forge output → webp + atlases + manifest)
pnpm --filter @dnd/vault-cli cli build   -d <pack-source> -o dist

# 2. regenerate the index — this is what tells clients a new version exists
pnpm --filter @dnd/vault-cli cli index   -d dist

# 3. look before you leap: prints every key, its size, and its cache header
pnpm --filter @dnd/vault-cli cli deploy  -d dist --dry-run

# 4. publish. index.json uploads last, so clients never see a half-deployed pack
pnpm --filter @dnd/vault-cli cli deploy  -d dist
```

Rolling back is one command — `index.json` is the only mutable pointer, so restoring an
archived copy reverts every client:

```bash
pnpm --filter @dnd/vault-cli cli rollback -p dungeon-classic --to 1.2.0
```

### Pointing the app at the bucket

`PACK_CDN_URL` in the environment feeds `VITE_CDN_BASE_URL` into both image builds:

```bash
PACK_CDN_URL=https://packs.example.com docker compose build map-goblin session-client
```

Empty (the default) keeps the bundled pack and needs no bucket at all.

## Roadmap — dungeon-classic gets reshaped, not replaced

`dungeon-classic` is not legacy to be split away from. It is the one pack, and forge output
progressively replaces every set inside it. Each batch is a version bump and a republish.

| Batch | Set | Status |
|---|---|---|
| 1 | Fieldstone walls (29 entries) | done, in pack, uncommitted |
| 2 | Palisade walls (29 entries) | done, in pack, uncommitted |
| 3 | Floor / terrain, 5–6 textures | next |
| … | remaining floors, edges, objects, doors, props | after |

This is why differential update is the load-bearing feature. A DM should download the 6 new
floors, not re-download the pack.

**The bloat lever is deletion, not splitting.** The pack currently holds 100 wall entries
because the replaced sets are still in it alongside the replacements: `Wall_Wood_Ashen` 21 +
`wall-stone-slate` 21 (procedural) + Fieldstone 29 + Palisade 29. If every batch adds without
removing, the always-bundled baseline grows forever. Each batch needs an explicit answer to
"which old entries does this retire?" — and retiring them is a manifest change plus a map
migration for anything already placed, which is the part that isn't free.

## Decisions

1. **Storage: Cloudflare R2.** DECIDED 2026-08-09. The deploy code already targets it and
   egress is free.
2. **Offline / self-hosted DMs: not supported, deliberately.** A DM with no internet is pinned
   to whatever `dungeon-classic` shipped in their build — app works, maps open, new art waits
   until they're online once. The bundled pack is the offline floor. A `game-server` pack
   mirror would be a real feature; build it when a self-hoster asks, not before.
3. **Retire legacy sets as each batch lands.** Cheaper than it looked: `legacyMigration.ts` and
   the `LEGACY_MAP` table in `legacyAssetMapping.ts` already exist, and Fieldstone + Palisade
   are already registered there. Retiring a set = point its old ids at the new equivalents and
   drop the entries from the manifest.

   Do this **now, pre-release**, while the only maps at risk are internal test maps. After
   public launch every retirement needs a real migration against real DMs' saved maps. The
   window is open and it closes at launch.

## Not doing

- No pack marketplace, no accounts, no paid packs, no signing. Static files behind a CDN.
- No server-side pack registry in `game-server` — the index is a file in a bucket.
- No CI publish. Publishing is a deliberate act you run from your machine.
