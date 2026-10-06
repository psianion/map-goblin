# Phase 2 gate results — main-thread offload (2026-08-04)

Branch `perf-main-thread-offload` at `938eb66` (Phase 1 `d45a261..8db54bf` + Phase 2
`5ed54e7`+`938eb66`), walked against `main` at `4e70030` side by side.

## Environment

- Docker compose stack rebuilt at `938eb66`: editor :8080, session-client :8090,
  game-server :8787. Comparison editor image built from main at `4e70030` on :8081
  (`map-goblin:main-gate`, container removed after the walk).
- Chrome walk on the dressed Emberhold Crypt (13 rooms, 2 splat layers, doors,
  torches, props), light ambient `#E8E4D8` per test direction. Machine dpr 1.
- Perf numbers: PerformanceObserver longtask + raw rAF frame counts (the status-bar
  meter under-reads slightly; both recorded). Foreground tab throughout — hidden
  tabs suspend rAF and invalidate every number.
- Editor zoom slider caps at 100% (≈ 200 px/cell = full texture density), so the
  plan's "1×/2×/4×" series maps to 23% (fit) / ~90% / 100% captures.

## Numbers — branch vs main, same map, same actions

| Action | Branch @938eb66 | Main @4e70030 |
|---|---|---|
| Paint stroke (corner-to-corner) incl. 1.2 s persist | **0 longtasks** | 364 ms + 533 ms (897 ms frozen) |
| Undo of that stroke | **0 longtasks** | 649 ms frozen |
| Explicit save (Ctrl+S) | **0 longtasks** | (same code path as persist) |
| Continuous 16-tick zoom 22%→98% | **0 longtasks** | no equivalent — every frame 44–70 ms |
| Zoom-settle crisp re-bake | 2 one-off tasks, 65–100 ms | n/a (no bake; live shader every frame) |
| Map switch, both directions | 3 tasks at 50–60 ms | not cleanly isolable (500 ms+ class) |
| Editor idle FPS, dressed map | 38–57 | 3–24 |
| Session table load (Enter table) | 5 tasks ≤ 249 ms, behind route transition | n/a |
| Session table idle FPS | **60** | n/a |
| Console errors (full walk) | 0 | 0 |
| Network errors | one transient 503 on `/packs/index.json`; 200 on recheck and on reload | — |

## Feature verifications

- `preserveDrawingBuffer`: live `gl.getContextAttributes()` shows **false** on a
  plain load, **true** with `?e2e=1`. `powerPreference: "high-performance"` active.
- Session router keeps the query string across navigation — `?e2e=1` survived
  Landing → Host → Table (two `navigate()` hops) in the deployed client.
- Reload persistence: full dressed map (rooms, doors, props, splats, saved camera)
  restored after F5.
- Crisp viewport window: engages past 32 px/cell; terrain at 87–100% zoom visibly
  matches main's live-shader sharpness (screenshots in the walk log). WYSIWYG scale
  agreement between brush preview, painted terrain, and floor fill confirmed
  visually. Torch-lit scene under Moonless ambient renders correctly at 36–47 FPS.
- Import→host→table flow works end to end with the plain-JSON crypt fixture
  uploaded server-side; DM table shows fog, door list, scene state, 6 ms latency.

## Verdict

**Pass with notes.** Every Phase 1/2 offload target is met: painting, undo, save,
and zoom are stall-free where main froze for 0.4–0.9 s per action; the session
table holds 60 FPS; zero console errors. Two task classes sit at or just over the
50 ms line (below), and the editor's dressed-map idle FPS remains the pre-existing
known miss (#17) — materially improved (3–24 → 38–57) but not at 60.

## Notes / follow-ups

1. **Map switch 50–60 ms tasks** — worker seed + full-bounds bake on load; right at
   the bar. Candidate: chunk the seed/bake across frames.
2. **Zoom-settle re-bake 65–100 ms** — one-off, lands after motion ends, invisible
   in interaction but over the 50 ms line. Candidate: split the window bake.
3. **Editor idle FPS** on dressed maps still under 60 (known miss #17, pre-dates
   branch). Table side hits 60.
4. **Pre-existing import bug (also on main):** `loadMap()` runs `loadFromFile()`
   then `createNewMap()`, which saves the imported content into the *previous*
   map's IndexedDB slot, resets the canvas, and creates the new entry blank.
   File as issue.
5. **Fixture format:** `session/testdata/emberhold-crypt.mapbuilder` (and the tmp
   copy in `canvas/public`) are plain JSON without the `MPBLD` magic header — the
   session server accepts them, the editor's `decodeMapFile` rejects them. Either
   add a legacy plain-JSON fallback or re-save the fixtures. File as issue.
6. One transient 503 on `/packs/index.json` during a cold load; not reproducible.
7. To file at ship (carried from plan/review): export-resolution cap
   (`exportPipeline.ts` uncapped `extract.image`), and
   `wall-wood-b-corner-{d,e}-2x2` resolving to no pack frames.

## Tracked follow-ups (issue tracker entries removed 2026-08-05 — tracked here only)

### Importing a map file overwrites the previously open map and creates a blank entry

loadMap() in canvas/src/io/saveLoad.ts loads the file into the store with loadFromFile(), then calls store.createNewMap(). createNewMap() first saves the CURRENT store state (now the imported content) into the previously active map's IndexedDB blob, then resets to a blank canvas and creates the new entry from that blank state. Net effect: the old map is clobbered with the imported content and the new "imported" entry is empty.

Reproduced on main and on the perf branch during the Phase 2 gate walk (2026-08-04). Fix direction: create the map entry first (or pass the loaded data into the entry creation) so the imported content is serialized under the new id and the previous map is saved before loadFromFile touches the store.

### Cap export resolution in the export pipeline

exportPipeline.ts calls extract.image at the user-selected export resolution with no upper bound; a large map at high resolution allocates an unbounded render texture and readback in one shot. One-time user action so it was excluded from the main-thread offload work (2026-08-04 plan, finding 5) — cap the output dimensions or tile the export.

### wall-wood-b-corner-d-2x2 and wall-wood-b-corner-e-2x2 resolve to no pack frames

Re-deriving every non-LEGACY_MAP manifest id against the shipped dungeon-classic atlases (Phase 2 review, 2026-08-04): 77 of 79 resolve, these two derive pack ids whose stems have no frames in any atlas. Selecting them falls through to bundled /textures/ paths that are not shipped, so they 404. Either add the frames to the pack or drop the manifest entries.

### Editor cannot import the plain-JSON gate fixtures

session/testdata/emberhold-crypt.mapbuilder (and the floor-doors variant) are plain JSON without the MPBLD magic header. The session server accepts them, but the editor's decodeMapFile rejects them with "unrecognized header bytes", so the dressed gate map cannot be imported into the editor without manually wrapping it in the container (magic header + gzip). Either add a legacy plain-JSON fallback to decodeMapFile or re-save the fixtures in container format.

### Chunk the terrain worker seed and window bake to stay under 50 ms

Phase 2 gate walk numbers (docs/2026-08-04-phase2-gate-results.md): map switch onto a dressed map shows 3 tasks at 50-60 ms (worker seed + full-bounds bake), and the zoom-settle crisp-window re-bake costs a one-off 65-100 ms task. Both land outside interaction and are imperceptible in practice, but they are over the 50 ms long-task bar. Candidate fix: split the seed/bake work across frames.
