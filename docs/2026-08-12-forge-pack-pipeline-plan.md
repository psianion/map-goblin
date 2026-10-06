# Forge → pack → client pipeline — plan (draft)

2026-08-12. Goal: make art delivery scale past a bundled 8 MB pack, before the floor batch
lands. Nothing here is broken for users today. All of it is urgent *relative to floors*, because
floors are the first batch that rewrites multi-MB atlases on every publish, and that is the
point where the cost stops being reversible without a history rewrite.

Status: P1–P3 BUILT 2026-08-13 on branch `forge-pack-pipeline`, awaiting review/commit. P4
(floor batch) is the remaining phase. Decisions resolved below.

Implementation notes vs. the plan as written:
- P1 landed as a merge-based `integrate` command (vault-cli) rather than a full
  `pack-builder build` re-run — the legacy pack has no source images in the repo (F3), and
  `detectAssetType`'s heuristics would have mistyped 22/29 forge pieces. Same goals delivered:
  per-(set,type) atlases (`atlas-<set>-<type>-<hash>`), content-addressed manifest
  (`pack-820544e4.json`, v1.3.0), hand-patch scripts deleted, entry-id gate passed (167
  byte-identical), 118 → 64 pack files, deploy dry-run ~119 → 66 objects.
- P2 mostly collapsed into the P1 swap: the committed pack dir now IS the bundle
  (starter + legacy-awaiting-regeneration); `forge/dist/` gitignored explicitly.
- P3 join prefetch needed no server change: JoinSession connects, awaits the first
  `session-state` snapshot (5s cap), prefetches the active scene's doc + asset sets (10s cap),
  then navigates. Client code names the concept "asset set" (`ensureAssetSets`,
  `ensureTexturesForMap`) — plain "set" was taken by wall material families.

---

## Why now

Three problems, one root cause. `forge/build-pack-files.mjs` and its palisade twin write loose
webp straight into `canvas/public/packs/` and hand-patch `pack-4a9bdbee.json`, bypassing
`pack-builder build` entirely.

**1. Request explosion.** `'wall'` is in `ATLAS_TYPES` (`vault-engine/src/types.ts:15`), so the
real pipeline would pack a set into one sheet. It never gets the chance.

| | Objects | Bytes |
|---|---|---|
| 58 forge wall pieces (Fieldstone + Palisade) | **58** | 276 KB |
| 21 legacy walls, same job, atlased | **1** | 144 KB |

Twice the bytes for five times the requests — 5 KB files compress badly and each carries its own
overhead. First visit currently fetches 111 objects at 8-way concurrency. Every future set adds
~29 more:

```
today                111 objects   ~14 round-trips
+5 more forge sets   256 objects   ~32 round-trips
+10 more forge sets  401 objects   ~51 round-trips
+20 more forge sets  691 objects   ~87 round-trips
```

**2. The manifest is no longer content-addressed.** `pack-4a9bdbee.json` now hashes to
`1c381e18`. `pipeline.ts:222` names it `pack-<contentHash>.json`; the hand-patch keeps the old
name deliberately (its header says so). That makes the manifest key mutable across versions,
which is exactly what `atomicDeploy`'s "index.json is the only mutable pointer" guarantee
assumes away — a client reading the old index mid-publish can fetch that key and get the new
manifest. Narrow window, `max-age=300`, and the purge covers it, but it is real.

**3. A generated artifact is edited by hand**, so 1 and 2 cannot self-correct.

---

## Agreed design

**Atlas per set, not per type.** Fieldstone one sheet, Palisade one sheet, each floor batch its
own. Per-type sheets mix every set's art together, so any one set's republish invalidates art it
does not own — today's `atlas-floor` is 3.75 MB, so retouching one floor texture would cost
every DM 3.75 MB. Per-set keeps the differential update meaningful *and* collapses request count.

**The CDN is load-bearing, not optional.** A catalog heading past 200 MB cannot be bundled into
a Docker image. The 200 MB figure is the client's IndexedDB cache cap, not a catalog ceiling —
the catalog can be far larger provided a DM caches only the sets they use.

**The install unit is the set.** Authoring and publishing units stay free: publish a set into a
pack, or regenerate the whole pack, either is fine. Only the *download* unit has to shrink,
because `installPack` fetching the entire manifest is the actual ceiling — a single pack larger
than the cache cap has nothing to evict but itself.

**Git holds frozen art; the bucket holds churning art.** Masters are write-once. Atlases are
rewritten every publish, and because they are content-hashed each rewrite is a whole new
multi-MB blob in permanent history, uncompressible against its predecessor. Repo keeps one small
starter set; everything that moves lives only in R2.

**Masters stay local.** `forge/dist` is 1.6 MB / 60 PNGs and stays gitignored. Revisit only if a
second machine, CI, or a Docker build ever needs to rebuild packs from source.

**Keep the bundled baseline.** The offline, zero-config, works-on-first-paint start is worth
keeping. This plan shrinks it to a starter set; it does not remove it.

---

## Phases

### P1 — Route forge output through `pack-builder build`

Closes all three root problems at once. Largest phase; everything else depends on it.

- Group atlases by **(set, type)** rather than type alone. `set` already exists in forge's own
  manifest — `{set, family, grid, band, tint, pieces}` — it just dies at the hand-patch. Carry
  it into the pack manifest so each entry knows which sheet it belongs to.
- Feed `forge/dist/<Set>/` into `pack-builder build`. Delete the hand-patching from both
  `build-pack-files*.mjs`.
- Content-addressed manifest filenames return. `firstBootInstall`'s hardcoded
  `BUNDLED_PACK_PATH = '/packs/dungeon-classic/pack-4a9bdbee.json'` must resolve dynamically.
  **This lands inside P1, not after** — the moment the filename changes, first boot 404s.

**Hard gate — entry id stability.** Every saved map references art through
`layer.textureId` → `legacyAssetMapping` → pack entry id. If the build mints ids differently
from the hand-patch, every existing map breaks silently and without an error.

Early read says it will not. `autoTag`'s pattern is `^(.+)-([A-Z])$` (hyphen); forge filenames
use underscores, so it falls through to `{material: <stem>, variant: 'A'}`, and
`localId = ${material}_${gridSize}_${type}_${variant}` reproduces
`GG_Fieldstone_Straight_3x1_A_3x1_wall_A` — exactly today's id. `gridSize` derives from pixel
dimensions against the 200 px grid and also matches.

Verify rather than trust: build into a scratch directory and assert the entry-id set is
**identical** to today's 167. Any diff stops the phase and is re-planned.

**Done when:** 29 objects per set collapse to 1 atlas; the manifest filename hash matches its
content; entry ids byte-identical; full suite green; `deploy --dry-run` object count drops
accordingly.

### P2 — Starter set and the git boundary

- Carve the starter subset — same pack id, same entry ids. It is a *subset* of
  `dungeon-classic`, not a second pack, so the one-pack decision is untouched.
- **Starter = Fieldstone + Palisade**, the two forge sets. The legacy assets (floors, doors,
  props, old walls) are reference art awaiting regeneration — they are not starter material, but
  they **stay bundled as-is until regenerated**, or a fresh no-bucket clone renders walls and
  nothing else. Each regeneration publishes to the bucket and the legacy version leaves the
  bundle; the bundle shrinks toward the starter over time rather than being cut in one stroke.
  Whether a regenerated floor set joins the starter (so first paint keeps floors) is decided
  with the floor batch.
- **Decided: `git rm`** generated pack output beyond the bundle (starter + not-yet-regenerated
  legacy), and gitignore it; the bucket owns it from here. History is not reclaimed either way —
  this keeps the working tree honest about what git owns.
- 37 e2e specs exist. `asset-packs.spec.ts` and `visual-cdn-integration.spec.ts` reference the
  pack directly and need checking against a starter-only checkout. `session/client`'s Vite
  serves `canvas/public` as `publicDir`, so dev depends on this too.

**Done when:** a fresh clone runs `pnpm dev` and renders a map with no bucket configured; e2e
green.

### P3 — Install by need

- Manifest carries set grouping from P1, so the client resolves
  `layer.textureId` → entry → its set → that set's atlas.
- `firstBootInstall` installs the bundle only (starter + not-yet-regenerated legacy — see P2).
- `installPack` gains a subset path — fetch the sets a map actually references instead of the
  whole manifest. This is what makes a >200 MB catalog work against a 200 MB cache.
- Player join prefetches the DM's map's sets at the join screen, so the latency lands before the
  canvas is on screen rather than after it.

**Done when:** opening a map that uses two sets downloads two atlases, not the catalog; LRU
eviction behaves correctly at the cap.

### P4 — Publish the floor batch through the new path

The validation, and the next art batch anyway. Forge the floors, `build` → `index` → `deploy`,
then confirm a DM already on the previous version pulls only the changed sheets.

---

## Risks

| Risk | Impact | Handling |
|---|---|---|
| Entry id drift | Every saved map breaks silently | P1 hard gate; evidence says low probability |
| `firstBootInstall` hardcoded manifest path | First boot 404s | Must land inside P1 |
| Atlas exceeds GPU max texture (4096/8192) | Set fails to render | Check before assuming one sheet per set always fits; spill across sheets if needed |
| e2e coupled to the full pack | CI red on a starter-only tree | P2 scope |
| Versioning granularity | Schema fork | Keep one pack version, let checksums drive updates |

---

## Not doing

- Browse/install UI — already deferred, still correct while there is one pack.
- Per-set versioning or per-set rollback.
- Chunking finer than a set.
- Moving masters into git.
- Rewriting existing git history.
- Removing the bundled baseline entirely.
- Making the app "lighter" by unbundling — established as no user-facing performance win. The
  8.1 MB is fetched after boot and cached in IndexedDB, so it is a one-time first-visit cost of
  roughly 0.7–2.6 s on desktop broadband, and identical on every subsequent visit either way.

---

## Sequencing

**Decided: P1–P3 run together, before the floor batch.** P4 is the floor batch itself,
published through the finished pipeline.

## Findings during P1 (2026-08-13) — pre-existing, tracked here, not P1 scope

- **F1:** `atlas-wall-ffcc1679.json` carries 18 frame keys with no matching manifest entry
  (e.g. `Fence_Stone_Slate_A_Connector_A_1x1_1x1_wall_A`) — orphans present in the baseline
  before this work. Harmless at runtime (frames without entries are just never referenced);
  clean up when the legacy wall set is regenerated.
- **F2:** 3 `LEGACY_MAP` targets in `packages/core/src/engine/legacyAssetMapping.ts` point at
  entry ids that exist in no manifest version: `stone-slate_1x1_floor_A`,
  `wood-ashen_1x1_floor_A`, `Fence_Stone_Slate_A_Straight_A_3x1_3x1_wall_A`. Any map using
  those legacy ids renders the magenta fallback today. Fix with the floor batch / legacy wall
  regeneration, when correct target ids exist.
- **F3 (fixed in P1):** the legacy pack's source images are not in the repo at all
  (`packs/*/source/` gitignored and empty) — the base pack is not rebuildable from source,
  which is why P1 became a merge-based `integrate` step rather than a full
  `pack-builder build` re-run.

- **F4:** 12 canvas e2e tests across 5 specs (19-asset-browser, 23-transform-controls,
  26-floor-textures-spline-saveload, 27-layer-tree-v2, 28-doors-walls) are stale against
  behavior shipped by the maps→scenes rework and earlier overhauls (specs last touched
  2026-08-01 at b7371d3): they expect map version 3.0 (code: 3.1), state version 1.3
  (code: 1.4), and pre-overhaul layer-tree child ordering. Confirmed failing identically
  with and without this branch's changes; the other 55 tests in those specs pass. Needs a
  spec-reconciliation pass as its own task — version expectations are trivial, but the
  ordering/transform cases need the intended post-overhaul behavior confirmed.

## Decisions (resolved 2026-08-13)

1. `git rm` committed pack output beyond the bundle — working tree honesty; history unchanged
   either way.
2. First run is P1–P3 together, then P4.
3. Starter set is Fieldstone + Palisade only. Legacy assets are references awaiting
   regeneration and stay bundled until each is replaced (see P2).
