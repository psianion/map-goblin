# Map import — UVTT and Foundry scenes into the canvas

Status: BUILT + GATE WALKED on the dev lane — 2026-09-08, branch `map-import`, awaiting the
user's canvas look and a PR go-ahead. Approved same day (image cap 4096, Roll20 deferred,
"keep a way open to 8192" = the one `IMPORT_MAX_PX` constant in `canvas/src/io/importMap.ts`).

Gate log (dev lane 560x, Chrome, zero console errors on editor, DM and player tabs):
- Icespire folder → 36 rows with thumbnails and counts, 10 composites unchecked. Imported
  Axeholm lower + upper; lower downscaled 6580×5880 → 4096, upper has no image in the pack
  (the file the scene names does not exist there) and came in walls-only as designed.
- Walls sit on the drawn walls at 74% zoom, doors sit in the doorway gaps, 94 lights present.
- Reload reopens both from the map store intact.
- Published lower to a throwaway dev campaign; DM seat lists 26 doors, Vision mode fogs the
  player, a darkvision token the player owns sees the round room and its four stubs clipped
  by the imported walls and stopped at the closed doors; DM opening a leaf extends the
  player's view through it.
- Two live findings fixed during the walk: the file input's FileList is live and emptied by
  clearing the input (picks were silently dropped); creating each map resets the UI slice and
  closed the dialog before its summary (the dialog now holds itself open through the import).
- Impeccable critique 30/40 with every P0–P2 fixed (stop-after-current, button drop zone,
  focus, thumbnail fallback, Enter, toast, progress end). Open: filter/sort for very large
  modules; retry failed rows.
- Docker images NOT rebuilt for this branch; the docker two-surface walk is still owed before
  ship if the user wants it on the deployed stack.

Question that started it: how hard is it to bring a map "configured for Roll20"
(walls, doors, lights) into the canvas and table? Findings, in order of what
people actually have on disk:

1. **Universal VTT** (`.dd2vtt` / `.uvtt` / `.df2vtt`) — what Dungeondraft,
   Dungeon Alchemist, Inkarnate and Arkenforge export, and what people feed
   Roll20's UniversalVTTImporter script. Grid units, embedded image, tiny spec.
2. **Foundry scenes** — the Icespire Peak pack at `D:\DownLs\uchideshi34-doip-maps`
   is this: `packs/*.db` with one JSON scene per line, 2-point walls in pixels,
   lights with dim/bright in feet, image as a separate webp at 140 px/cell.
3. **Roll20 pages** — no file format. Data lives in Firebase; getting it out needs
   the R20Exporter extension or a Pro API script. Paths with bounding-box
   transforms, doors with inverted y, lights as invisible tokens.

Decision this plan proposes: one importer core, two thin readers now (UVTT,
Foundry), Roll20 reader deferred until a real dump exists to test against.

---

## 1. Shape

```
file ──▶ reader (pure, core) ──▶ ImportedMap ──▶ apply (canvas, store) ──▶ new map
          readUvtt / readFoundryScene                 image base + walls + doors + lights
```

### `ImportedMap` — `packages/core/src/shared/import/types.ts`

Everything in **cells**, origin top-left, y down. Readers do all unit work so
`apply` never sees pixels or feet.

```ts
export interface ImportedMap {
  name: string;
  size: { width: number; height: number };            // cells → MapSettings.fixedSize
  image: { dataUrl: string; width: number; height: number; pxPerCell: number } | null;
  walls: { points: [number, number][]; wallType: WallType; direction: WallDirection }[];
  doors: { a: [number, number]; b: [number, number]; state: DoorState; isSecret: boolean }[];
  lights: { x: number; y: number; radius: number; featherRadius: number; color: string; intensity: number }[];
  ambient: { darkness: number } | null;
  warnings: string[];                                   // every dropped thing, named
}
```

A door is its own segment in both source formats. `apply` emits it as a
one-segment `WallSegment` plus a `DoorChild` whose `wallId` is that segment,
`position` its midpoint, `width` its length. `resolveDoors` already handles
that; no new geometry.

### Reader: `readUvtt(json)` — `packages/core/src/shared/import/uvtt.ts`

| UVTT | ImportedMap |
|---|---|
| `resolution.map_size`, `pixels_per_grid`, `map_origin` | `size`, `image.pxPerCell`; subtract origin from every point |
| `line_of_sight[]` polylines | walls, `normal` |
| `objects_line_of_sight[]` | walls, `normal`, warning "N object walls imported as walls" |
| `portals[]` `bounds` two points, `closed`, `freestanding` | door `closed` / `open`; `freestanding=true` → warning, skipped |
| `lights[]` `position`, `range`, `intensity`, `color` (`aarrggbb`) | radius = range, feather = range / 2, color `#rrggbb`, intensity |
| `environment.ambient_light`, `baked_lighting` | ambient.darkness from luminance; warning if baked |
| `image` base64 | `image.dataUrl` |

Existing `packages/core/src/shared/uvttMapping.ts` (wall-type code table) is
kept and used for the UVTT wall-type extension some exporters write.

### Reader: `readFoundryScene(scene, imageDataUrl)` — `packages/core/src/shared/import/foundry.ts`

Accepts one scene document: Foundry's per-scene **Export Data** JSON, or one
line of a compendium `.db`. Pixel → cell divides by `grid` (v10, number) or
`grid.size` (v11+, object). Feet → cell divides by `gridDistance` / `grid.distance`.

| Foundry | ImportedMap |
|---|---|
| `walls[].c = [x1,y1,x2,y2]` | one 2-point wall |
| `sight`/`move` codes: 20 normal, 10 limited, 0 none | sight 20 → `normal`; sight 10 → `terrain`; sight 0 + move 20 → `invisible`; move 0 + sight 20 → `ethereal`; all 0 → skipped with warning |
| `dir` 0/1/2 | `both` / `left` / `right` |
| `door` 1/2, `ds` 0/1/2 | door; `isSecret` when 2; state closed/open/locked |
| `flags.wall-height` `{top,bottom}` | keep walls whose band contains elevation 0 or that have no band; warning with the skipped count. The pack's single-floor scenes have one band; the "(levels)" composites are multi-band and come in as ground floor only |
| `lights[].x,y`, `config.dim/bright/color/alpha/angle` | radius = dim, feather = dim − bright, color, intensity from alpha (0.025 → 0.25 floor, 1 → 1); `angle ≠ 0` → warning |
| `darkness`, `globalLight` | ambient |
| `img` | not readable from JSON (module-relative path) — the dialog asks for the image file |

Dropped on purpose: tiles, drawings, tokens, notes, sounds, Levels holes,
Better Roofs polygons. Each adds one warning line with a count.

### Apply: `canvas/src/io/importMap.ts`

Runs the existing New Map path, then fills it:

1. `createNewMap(name)`, `setFixedSize(size)`.
2. Base layer renamed `Battlemap`: `AssetChild` for the image at
   `width = px / pxPerCell` cells, positioned so its top-left is `(0,0)`. No
   grid calibration — the scale is known. Lock the layer (same
   `PropertyCommand` calibration uses).
3. Layer `Walls`: `updateLayer(id, { standaloneWalls })` + `addChild` for each
   `DoorChild` and `LightChild`. Wall style from `createDungeonLayer` defaults;
   color/width/roughness from the layer style, not the file.
4. `mapSettings` ambient from `ImportedMap.ambient` if present.
5. One `notify` with the warnings list; `saveCurrentMap()`.

Not undoable as a unit — it is a fresh map, Delete Map is the undo.

### Image size

`importImageFile` downsizes anything over 4096 px to 2048. The DoIP maps are
6580×5880 at 140 px/cell. Proposal: the import path takes a `maxPx` option and
uses **4096**, so a 47-cell map lands at about 87 px/cell — sharper than the
70 px battlemap default and well inside the GPU texture limit. Full-resolution
import is not built; add a checkbox if a real map needs it.

### Dialog: `ImportMapsDialog` — folder or files, pick which maps

Reached from the maps list ("Import maps"). One flow for one file or a whole
module folder; a single file is a one-row list.

1. **Input.** Dropped folder (drag-drop entries), picked folder (directory
   input, works in every browser), or loose files. Scan recursively for
   `.db .json .uvtt .dd2vtt .df2vtt`; ignore everything else. Keep a map of
   relative path → `File` for image lookup.
2. **Parse.** Every scene in every `.db` line, every JSON, every UVTT file goes
   through the readers. Foundry `img` is module-relative
   (`modules/<id>/map-assets/Name%20v1.webp`): strip the first two segments,
   URL-decode, look it up in the path map. Missing → row still imports as
   walls-only with a warning.
3. **Picker.** One row per scene: thumbnail (Foundry scenes carry a base64
   `thumb`; UVTT rows decode their embedded image small), name, size in cells,
   wall / door / light counts, image status (found · missing · will downscale).
   Checkboxes, select-all, count of checked. Scenes with
   `flags.levels.sceneLevels` are tagged "multi-floor composite" and start
   unchecked; single-floor scenes start checked.
4. **Import loop.** For each checked row: `createNewMap` → apply → `saveCurrentMap`.
   Progress bar with the current name. A row that throws is skipped and named
   in the summary; the loop continues. Summary at the end: imported N, skipped
   M, total stored size, and every warning grouped by map.

Storage note for the summary: images stay base64 inside each map, so the full
36-scene Icespire pack at 4096 px is on the order of 150 MB in IndexedDB.
Floors of one building land as separate maps sharing a name prefix; building
grouping waits for the floors work.

Impeccable pass on the dialog before ship (memory rule).

---

## 2. Files

| File | Change |
|---|---|
| `packages/core/src/shared/import/types.ts` | new, `ImportedMap` |
| `packages/core/src/shared/import/uvtt.ts` | new, ~80 lines |
| `packages/core/src/shared/import/foundry.ts` | new, ~120 lines |
| `packages/core/src/shared/uvttMapping.ts` | unchanged, imported by uvtt.ts |
| `canvas/src/io/importMap.ts` | new, ~120 lines |
| `canvas/src/canvas/importImage.ts` | `maxPx` option on `importImageFile` |
| `canvas/src/io/importFolder.ts` | new, ~60 lines: walk dropped/picked entries, find map files, path → File map |
| `canvas/src/components/maps/ImportMapsDialog.tsx` | new, ~200 lines: picker list, progress, summary |
| maps list | one "Import maps" action opening the dialog |

No new dependencies. `.db` is newline-delimited JSON; LevelDB packs are out of
scope (the same data always ships as `.db` too, or as per-scene Export Data).

---

## 3. Tests

- `uvtt.test.ts`: hand-written 4×4 fixture — two walls, one portal closed, one
  freestanding, one light; asserts cells, door state, warning for the
  freestanding portal, origin subtraction.
- `foundry.test.ts`: fixture is one DoIP scene trimmed to ~12 walls covering
  every code combination seen in the pack (normal, door open/closed/locked,
  secret, sight-0 doorway, all-zero wall, two elevation bands) plus two lights;
  no image. Asserts wall types, band filtering, feet→cells, warnings.
- `importMap.test.ts`: store-level — apply a small `ImportedMap`, assert two
  layers, base locked, wall count, every `DoorChild.wallId` resolves, light
  radii, `fixedSize`.
- Existing `NewMapDialog.test.tsx`: one case per new source path.

The DoIP webp and full scenes are **not** committed — third-party art.
Fixtures are trimmed JSON only.

## 4. Gate

Docker canvas + table, Chrome, per the sprint-verification rule:

1. Drop the whole `uchideshi34-doip-maps` folder. Picker lists 36 scenes with
   thumbnails, composites unchecked, every image resolved. Import `Axeholm
   (lower)` and `Axeholm (upper)` together: walls sit on the drawn walls at
   every zoom; doors sit in doorways; 94 lights present on lower; both maps
   appear in the maps list; summary reports sizes and warnings.
2. Import a Dungeondraft `.dd2vtt` (any small one) as a loose file — same checks.
3. Publish to a table, two seats: doors toggle for the DM, fog respects the
   imported walls, lights show at night. Zero console errors.
4. Save, reload, reopen — the map round-trips through `.mapbuilder` unchanged.

## 5. Out of scope, on purpose

- Roll20 reader. Shape is known (see the 2026-09-08 research notes in chat);
  build when a real R20Exporter dump is on disk to test against.
- Multi-floor composites, Levels holes, roof tiles — floors are separate maps
  by design; import each single-floor scene.
- Tokens, journal notes, sounds, drawings.
- Full-resolution images over 4096 px.
- Directional (cone) lights and light animations — warned, not modelled.

## 6. Decisions needed

1. Image cap: downscale to 4096 (proposed) or keep native up to 8192.
2. ~~Foundry input~~ — settled 2026-09-08: whole-folder drop with a multi-select
   picker; loose files are the one-row case (section 1, Dialog).
3. Confirm Roll20 stays deferred.
