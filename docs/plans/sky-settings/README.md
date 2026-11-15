# Sky settings: four times of day, three places, one way to set them

Plan written 2026-11-15 against `main` at 100fe5e, after a review of six mock boards. Two waves, three builders in sequence, one tester per wave. Branch `sky-settings` off `main`; one commit per wave.

## 1. Problem

The light of a map is set in too many places with too many names. The editor has a "Sky and mood" sheet hidden behind the Light tool, a Lit preview switch, and a separate set of Hour / Sky / Weather pickers in Export. The table has a World tab with a time slider, hour jumps, clock speed, moon options, weather chips, a darkness slider, light switches, level controls and a room-moods list. Rooms are graded Lit / Dim / Dark while maps are Outdoor / Indoor / Underground, which are the same three steps under two names.

Underneath, the cut was never finished. Map weather, moon, fixed hour and palette are stripped from every file on load and save, yet the table, the export and the sky maths still read them. Room mood was removed from the editor but is still set live at the table. An older light resolver runs beside the current one. A command and several helpers have no callers.

## 2. Decisions (taken)

| # | Decision |
|---|---|
| 1 | Time of day is four values: Dawn, Day, Dusk, Night. No dial, no hour jumps, no running clock. A map does not carry a time; the campaign does. |
| 2 | Weather and moon options are removed for now. Their light maths stays in core, pinned to clear and full moon, so they can return as controls only. |
| 3 | One vocabulary for how much sky reaches the ground: Outdoor, Indoor, Underground ("Place"). It replaces Lit / Dim / Dark everywhere. |
| 4 | Place is set on the map, and can be overridden on a level and on a room, in the editor, saved in the map. The DM can still flip a room live at the table for the current scene. |
| 5 | Darkness slider with Auto stays at the table and is remembered per scene, not per campaign. |
| 6 | The same picture tiles pick the time in the editor preview, in Export and at the table, and the same tiles pick Place on the sheet, the cards and the room key. Tiles, not dropdowns. |
| 7 | Where a dark room meets a brighter region across an open edge, daylight fades about two squares in. It never passes a wall. What is drawn lit there also counts as lit for player sight. |
| 8 | Sun and moon shadows fall only on Outdoor ground, region by region. |
| 9 | Sundial: while the Sky sheet is open, a ring carries one sun handle. Dragging it sets where the sun and moon rise. Nothing else is on the ring. The ring is part of the editor's interface, not of the map: it fills the clear canvas area and stays put through pan and zoom, so shadows on one zoomed-in piece can be checked from every direction. No change to the sun maths. |
| 10 | The table tab is named Sky. Levels, seat views and All lights live in the Map tab only. |
| 11 | The zone "Environment" action is removed. Zones no longer change time or weather. |
| 12 | A campaign-wide darkness saved before this change is dropped; every scene starts on Auto. |

## 3. What exists today (file references)

- **Sky maths** (`packages/core/src/shared`): `sky.ts` (`skyFrame` `:105`, `daylightAt` `:94`, `skyMinutes` `:100`, `cliffSunAt` `:135`, `WEATHER_LIGHT`, `SkyEaser`); `world.ts` (`MapEnvironment` `:151` with `orientation` in degrees, 0 = screen-right; `BANDS` and `timeOfDayAt` `:185-194`; `advanceClock` `:211`; `resolveWorldLight` `:374`; `sunAt` `:429`, which casts only when the whole map is outdoor; `TIME_PALETTES`, `composeGrade`, `DAMPING`, `MOON_INTENSITY`). `TimeOfDay = dawn|day|dusk|night` already exists (`prep.ts:12`).
- **Region grade**: `regionGrade.ts` (`MOOD_SKY`, `regionGrade` `:62`, `regionLight` `:82`, `isDarkRegion` `:88`, `levelMood` `:96`, `roomMood` `:111`); `lookScope.ts` (chain room → area → layer → level → map, `LOOK_KEYS` still lists `mood`, `moodTint`, `moodVision`; `ENVIRONMENT_MOOD` `:72`); `types.ts` (`RoomLook` `:612`, `Mood` `:625`, `Level` `:676`); `store/removedFields.ts` strips those three keys and the five map keys at `migration.ts:120`, `store.ts:210` and `canvas/src/io/mapFile.ts:227`.
- **Drawing** (`packages/core/src/engine`): `renderLoop.ts:65-120` builds `Regions {level, rooms[{id, face, mood}]}` and feeds `lightManager.setRegions`; `lighting/LightingRenderer.ts` draws the grade mask (`gradeBg` rect plus one polygon per room in `gradeFaces`, blurred 3 buffer px, `:418`, `:934-957`), `gradeAt` `:818`, cell-based blur widths via `PENUMBRA_CELLS` `:190`. `shadowPass.ts` is the only natural-shadow caster: walls swept into nested bands and clipped with Clipper2 to the layer ground (`:235-255`), props as multiply sprites (`:419-468`), cliffs with their own sun (`:340`). No per-region clip exists. `worldOverride.ts` (`worldFrame` `:93`, `setTableRoomMoods` `:71`, `worldGrade` `:112`). `export/exportPipeline.ts` takes `lighting?: boolean | {minutes, nightSky, weather}` (`:37`, `:285-298`).
- **Sight**: `shared/visionGate.ts` (`darkTest` `:48`, one dark/lit answer per room face, `darkFaces` / `litFaces`), used by `session/server/src/fog/vision.ts:289-302` and `session/client/src/modules/fog/FogRenderer.ts:867`. `FogRenderer.ts:775` and `FogOverlay.ts:173` still call the old `worldLightOf`.
- **Rooms**: a room's face is the floor face holding its anchor (`store/roomSync.ts:97`, `engine/roomDetection.ts:67`). Faces are cut by walls, painted cave edges and thresholds; a split divider is a `ThresholdSegment` in `layer.thresholds` (`roomCommands.ts:395-425`). Ground outside every room takes the level's grade. Nothing marks which part of a face boundary is open.
- **Editor** (`canvas/src/editor`): `families/environment/index.ts` (one tool, Light), `SkyMoodSheet.tsx` (Environment seg, Natural shadows, Orientation slider outdoors only, Mood tint, Lit preview; commands `SetEnvironmentSettingsCommand` and `SetAmbientLightCommand`, `store/commands.ts:717,770`), `LightControls.tsx:126` (`SkyButton` as the Light tool's `panelExtra`), `surfaces/Sheet.tsx:29`, `shell/shellStore.ts:11`. `ToolDef` has `onPick` and a required `engine[]` (`registry/types.ts:142-188`). Lit preview: `viewPrefs.ts:333-394`, `App.tsx:47-54` → `engine/editorDesk.ts:55` → `renderLoop.ts:293,349`. `ui.previewClock/previewSky/previewWeather` exist with no writer (`store/slices/ui.ts:105-121`). `dialogs/ExportModal.tsx:122-143, 283, 477`. `families/text/ZoneSheet.tsx:667-684` (Time and Weather select rows). Cards: `families/text/roomCards.ts:136,154,192`, `RoomFields.tsx:90-166`, `models/roomLook.ts:90`, `models/roomModel.ts:152-197`. Tiles: `SwatchPicker.tsx:27`, `packages/ui/src/components/Tile.tsx:14`. Overlays: `canvas/src/canvas/lightOverlay.ts` is the model for a draggable handle (`pressAt` `:474`, registered through `registerCanvasPressHandler`, `useCanvasInput.ts:73`); `GridCalibrationOverlay.tsx` is the model for an interface overlay drawn over the canvas in React. Global key `k` is free (`shortcuts/defaultShortcuts.ts:777-917`).
- **Table state** (`packages/mechanics/src/triggers`): `WorldState {clock, nightSky, timeSpeed, weather?, darkness?}` stored once per campaign (`types.ts:187-197, 238`); `worldOf` and `legacyDarkness` `:261-277`; `worldSkyOf` `:286`; `worldLightOf` `:348`; per-scene `SceneTriggers` with `roomEdits[roomId].mood`, `seatLevel`, `dmLevelId`, `env` (`:146-172`). Commands in `module.ts`: `set-world` `:386`, `set-room` `:556`, `set-lights-all` `:541`, `set-environment` `:344` (no sender). The zone `environment` action (`:1210-1222`) narrates its time and writes weather through `pendingWeather` (`:249-259`). `redact` `:186-194`. There is no load-time migration; old shapes are read through `worldOf`, `roomEditsOf`, `sceneTriggersOf`, `normalizePrep`.
- **Server**: `session/server/src/ws/WorldTicker.ts` advances the clock every 2 s, wired in `SessionManager.ts:142, 277, 352`.
- **Table client** (`session/client/src`): `modules/world/WorldTab.tsx` (`WorldBody` `:80-207`, `WorldStrip` `:210-273`), `worldSync.ts` (`:66-128`), `worldPrefs.ts`, `world.ts` (only `hhmm`, `JUMPS`, `nearestJump` are used; `worldBadge`, `worldProvenance`, `ribbonGradient`, `ribbonAt` are not), `shell/top/titleData.ts:13`, `shell/dock/tabs.ts`, `modules/triggers/RoomKeySheet.tsx:145`, `modules/map/MapTab.tsx:63-73, 220-244`.

## 4. Design

### 4.1 Wave 1, Builder A: the model, the table

**One place table** (`regionGrade.ts`). `SKY_SHARE: Record<Environment, number> = { outdoor: 1, indoor: 0.4, underground: 0 }` replaces `MOOD_SKY`, `ENVIRONMENT_MOOD` and `DAMPING`. `RegionLight = { place: Environment; tint: string }`; `regionGrade(region, sky)`, `regionLight(place, sky)`, `isDarkRegion(place, sky)`, `levelPlace(map, level)`, `roomPlace(state, layer, room)`. The tint is always the map's `ambientLight`. The `Mood` type is deleted.

**Look chain.** `RoomLook` gains `place?: Environment` and loses `mood`, `moodTint`, `moodVision`; `LOOK_KEYS`, `ResolvedLook` and `mapDefaults` follow (`mapDefaults.place = environmentOf(map)`). Place has no layer value, so it resolves room ?? area ?? level ?? map by the existing default order. `removedFields.ts` is unchanged: old files still shed the three mood keys.

**Time.** New in `world.ts`:

```ts
export const TIME_MINUTES: Record<TimeOfDay, number> = { dawn: 395, day: 720, dusk: 1045, night: 0 };
```

06:35 and 17:25 put the sun just above the horizon, so Dawn and Dusk read about 0.3 dark with long shadows; exactly 06:00 would be as dark as night with no sun. `skyFrame` takes `time: TimeOfDay` in place of `minutes`, `nightSky`, `weather`, `timeMode` and `fixedTime`, and computes as today with `TIME_MINUTES[time]`, `'full-moon'` and `'clear'`. `WEATHER_LIGHT`, `weatherLight` and `MOON_INTENSITY` stay.

**Deleted from core**: `resolveWorldLight` and its types, `levelAt`, `composeGrade`, `worldGrade`, `advanceClock`, `TIME_SPEEDS` and its rates, `TIME_MODES`, `mapClock`, `skyMinutes`, every palette but temperate (`timeColorAt(minutes)` keeps one ramp), and the five stripped fields on `MapEnvironment`. `BANDS` and `timeOfDayAt` stay for reading old clocks.

**Table state.**

```ts
interface WorldState { time: TimeOfDay }
// SceneTriggers: darkness?: number  (0..1; absent = Auto)
//                roomEdits[roomId].place?: Environment
//                env: removed
```

Read-time compatibility, in the existing style: `worldOf` returns `time ?? timeOfDayAt(legacy clock ?? noon)` and ignores stored `nightSky`, `timeSpeed`, `weather` and the campaign-wide `darkness` (every scene starts on Auto); `roomEditsOf` maps a stored `mood` lit / dim / dark to outdoor / indoor / underground. `legacyDarkness` and `worldLightOf` are deleted. `worldSkyOf(state, map, sceneId)` builds the frame from the time and that scene's darkness.

Commands: `set-world {time}` (keeps the "it is now dusk" log line); new `set-darkness {sceneId?, value: number | null}`; `set-room {sceneId?, roomId, patch: {place: Environment | null}}`; `set-environment` is deleted. The zone `environment` action is deleted with it: the `TriggerAction` variant (`shared/prep.ts:217`), its case in the fire switch, `envText`, `pendingWeather` and `SceneTriggers.env`; `normalizePrep` drops any saved action of that kind, so old maps load clean. `useTriggerToasts.ts` loses the kind from `WORLD_KINDS`. `redact` ships the scene's `darkness` to players.

**Server.** `WorldTicker` and its wiring are deleted. `vision.ts` passes the scene id to `worldSkyOf` and room places to `darkTest`, whose last parameter becomes `Record<string, { place?: Environment }>`.

**Shared tiles** (`packages/ui`). `TimeTiles` and `PlaceTiles`, both rows of the existing `Tile` with a small drawn picture as its child (appendix). `TimeTiles` takes `value`, `onPick` and an optional leading `unlit` entry. `PlaceTiles` takes `value`, `onPick` and an optional leading inherit entry with its label ("Follows", "As built") and the place it would resolve to, drawn faded.

**Table client.**
- `tabs.ts`: label "Sky"; the tab id stays.
- `WorldTab.tsx`: Time (`TimeTiles` → `set-world`), Darkness slider with an Auto button (`set-darkness`, live preview through `worldPrefs` as today), "Show me everything lit". Everything else in `WorldBody` and all of `WorldStrip` goes.
- `MapTab.tsx`: the per-seat "Seats see" pin moves into the Levels strip beside the existing per-level Go; All lights is already there.
- `RoomKeySheet.tsx`: `PlaceTiles` with "As built" first and a line naming what the room was built as; a change lasts for the scene.
- `titleData.ts`: the chip is the time name alone.
- `worldSync.ts`: new `worldSkyOf` signature and `setTableRoomPlaces`. `FogRenderer.ts` and `FogOverlay.ts` read the `SkyFrame` (darkness, grade through `regionGrade`) instead of `worldLightOf`.
- `modules/world/world.ts` and its test are deleted; `parity.test.ts` compares the frame per time instead of per clock minute.

A signature change that breaks the editor gets the smallest compile fix; the editor's surfaces belong to Builder B.

### 4.2 Wave 1, Builder B: the editor

- **Sky entry.** A second entry, Sky, key `K`, in the Environment flyout. Picking it opens the Sky sheet; closing the sheet returns to the tool that was active. Use `ToolDef.onPick` if the registry can express an entry that owns no engine tool of its own; otherwise add an optional `sheet` field to `ToolDef` that the flyout opens instead of activating a tool. `SkyButton` is removed from the Light tool.
- **Sky sheet** (`SkyMoodSheet.tsx`, title "Sky"): Place (`PlaceTiles`, three wide tiles, with a hint that a level or room can differ on its card); Sun and moon: "Cast shadows" switch and, in this wave, the existing orientation slider, now shown whatever the map's place; Tint. The Lit preview switch leaves the sheet.
- **Preview as.** `viewPrefs.ts` holds one pref, `preview: 'unlit' | TimeOfDay`, default unlit, reading the old lit key once as a fallback (lit → day). `ui.previewClock/previewSky/previewWeather` collapse to `ui.previewTime: TimeOfDay`, pushed from the pref in the same `App.tsx` effect that sets the desk's `lit`. `worldFrame(map, previewTime)`. The status chip reads "Preview · Dusk" or "Unlit" and opens a popover of `TimeTiles` with the unlit entry; `I` toggles between unlit and the last picked time; `litOnForEdit` turns on the last picked time.
- **Export.** `LightingPick` becomes `{ time }`, seeded from the preview (Day when unlit); `exportPipeline` takes `lighting?: boolean | { time: TimeOfDay }`. Under "Apply lighting" there is one `TimeTiles` row.
- **Zone sheet.** The Environment action is removed from `ACTION_KINDS`, `defaultAction` and the action editor (`ZoneSheet.tsx:68, 106, 667-684`).
- **Cards.** A Place section on the room card and the level card: `PlaceTiles` with "Follows" first, written through `setLook(target, { place })`, labelled by the existing `sectionLabel` ("Inherits Map", "Pinned") with Reset. The area keeps its place in the chain but gets no control this pass. `MOOD_KEYS` is replaced.

### 4.3 Wave 2, Builder C: natural light

**Spill geometry** (new `packages/core/src/shared/daylightSpill.ts`, pure):

```ts
interface Spill { roomId: string; from: Environment; bands: [number, number][][][] }  // bands[k]: polygons at depth k
daylightSpill(map, layers, levelId, roomPlaces): Spill[]
```

For each segment of each threshold on the level, find what lies on either side by sampling 0.3 cells off its midpoint (room through `buildRoomIndex`, else the level). When the two sides have different places and the darker side is a room, sweep the segment `SPILL_CELLS = 2` cells towards the dark side in four nested steps and intersect each step with that room's face (Clipper2, as `shadowPass` does). The face already excludes walls, so a wall ends the band. Only thresholds count as open edges in this pass.

**Drawing** (`LightingRenderer.ts`). A `gradeSpill` Graphics drawn into the grade mask after `gradeFaces`: each band filled in the brighter side's `regionGrade` colour at rising alpha, innermost last, under its own blur of half a cell (width from cells, like the penumbra). `renderLoop.ts` passes the spills with the regions; export gets them through the same path.

**Sight** (`visionGate.ts`). `darkTest` takes the spills: a point in a dark room that lies inside a spill's first cell is not dark; `darkFaces` have those polygons cut out and `litFaces` gain them. Server and client both go through `darkTest`, so the two agree.

**Shadows by region** (`shadowPass.ts`, `world.ts`). `sunAt` casts whenever `naturalLight` is on, without asking the map's place. The sunlit area of a layer is its ground minus the faces of rooms that are not Outdoor when the level is Outdoor, else the union of faces of Outdoor rooms. Wall shadows are clipped to that area instead of the whole ground; a prop's shadow sprite is skipped when the prop stands outside it. Cliff shadows keep their rule.

**Sundial** (new `canvas/src/editor/families/environment/Sundial.tsx`, a React overlay over the canvas like `GridCalibrationOverlay`). It belongs to the interface and the Sky tool, not to the map: it never reads the map's bounds or the camera. Shown while the Sky sheet is open and "Cast shadows" is on. One SVG ring centred on the canvas area left clear by the rail and the open sheet, its diameter the smaller of that area's width and height minus 48 px, recomputed on resize only. One sun handle at the direction the dawn light comes from, labelled "Rises here". The overlay passes pointer events through everywhere except the ring's stroke and the handle, so the map still pans, zooms and selects inside the ring. Pressing the ring jumps the handle there; dragging turns `orientation` live through the same coalesced `SetEnvironmentSettingsCommand` the slider uses (`'sky.orientation'`, one undo step), snapping to the eight compass points within 6 degrees. The sheet's slider is replaced by a readout row, "Rise at the left", which takes focus and turns the sun 45 degrees on Left and Right. The handle's angle and the readout come from the same conversion `sunAt` uses, so at Dawn shadows fall straight away from the handle.

## 5. Build order

1. Builder A. `pnpm -r check` clean before handing over.
2. Builder B. `pnpm -r check` clean. Wave 1 tester. One commit.
3. Builder C. `pnpm -r check` clean. Wave 2 tester. One commit.

Each builder does each step once; a failure stops and is reported before any retry. Nothing is pushed without a go-ahead.

## 6. Tests

**Wave 1, unit.** `sky.test.ts`: each of the four times gives the expected sun kind, a sun intensity above 0.1 at Dawn and Dusk, darkness 0 at Day, 0.25 to 0.4 at Dawn and Dusk, 0.65 at Night. `regionGrade.test.ts`, `lookScope.test.ts`: place resolves through the chain; Underground is dark at Day. `triggers/module.test.ts`: the three commands, the deleted command rejected, old state read (clock 1050 → dusk, mood dim → indoor, stored storm ignored), a saved zone Environment action dropped on load. `useTriggerToasts.test.ts`. `lighting-vision.test.ts`, `vision-mode.test.ts`, `integration.test.ts`: rewritten off `set-environment`. `WorldTab.test.tsx`, `RoomKeySheet.test.tsx`, `worldSync.test.ts`, `FogRenderer.test.ts`, `parity.test.ts`. Editor: `environment.test.tsx`, `ExportModal.test.tsx`, `viewPrefs.test.ts`, `defaultShortcuts.test.ts`, `roomModel.test.ts`, `editorDesk.test.ts`. Deleted with their code: `WorldTicker.test.ts`, `world.test.tsx`.

**Wave 2, unit.** `daylightSpill.test.ts`: a cave room split from outdoor ground gets bands on the cave side only; a wall across the opening gives none; equal places give none. `visionGate`: a point one cell inside the mouth is lit, three cells in is dark. `shadowPass.test.ts`: no wall shadow inside an Underground room on an Outdoor map; shadows inside an Outdoor room on an Underground map. A pure test of the sundial's angle conversion against `sunAt`, and a component test that the ring's size depends on the clear canvas area alone.

**Browser, scoped, one run per wave, on a go-ahead.** Editor (`canvas/tests/e2e`): `environment-light.spec.ts` (Sky entry and key, Preview as, `I`), `export-dialog.spec.ts` (Night export darker than Day; the weather case removed), `lighting-render.spec.ts` (Underground room dark on an Outdoor map at Day), `text-tools.spec.ts` (Place on room and level cards, Reset). Wave 2 adds one sundial drag and one render check of the fade. Table (`session/client/e2e`): the Sky tab sets the time for a second seat; a room flipped to Outdoor in the room key lights up.

## 7. Not in this plan

- Weather and moon controls, and any change to their maths.
- Open doors, unwalled floor edges and openings other than thresholds as sources of spill.
- Spill out of a lit room onto darker level ground.
- A Place control on the area card.
- The sundial at the table.
- Tuning of sun strength at Dawn and Dusk: under today's maths the sun casts at about 0.15 there, so those shadows are long but faint. Judge on screen after Wave 1.

## Appendix: tile pictures

Each tile picture is a 40 px tall strip of a small landscape (`linear-gradient(115deg, #b7c38c 0 48%, #8fb9cf 48% 62%, #cfc6b2 62%)`) multiplied by one colour, with one mark on top.

| Tile | Multiply colour | Mark |
|---|---|---|
| Dawn | `#c2ac9c` | half sun `#ffd9a0` rising at the bottom left |
| Day | `#ffffff` | sun `#ffe27a`, ring `#c9a52e`, top centre |
| Dusk | `#b8907a` | half sun `#ff9d5c` setting at the bottom right |
| Night | `#48526e` | moon `#eef1f9`, top right |
| Unlit | none | the plain strip, no mark |
| Outdoor | `#ffffff` | the Day sun |
| Indoor | `#b4b4b4` | plank floor (`#c9ad84` / `#b0946c` stripes) inside a 3 px wall line `#5b5148` |
| Underground | `#3a3a3a` | rock `#8b867f` with one warm torch glow in the middle |
| Follows / As built | as the place it resolves to | drawn at 45% opacity |

The selected tile is marked by outline only, as elsewhere in the editor.
