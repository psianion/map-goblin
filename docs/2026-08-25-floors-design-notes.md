# Floors / levels — design notes (2026-08-25)

Status: discussion settled on the model below. No plan approved, no code yet.

## Model

A floor is a map; a building is a group of scenes. No second "levels" system inside a
map document — vision, fog, lighting, room detection all stay per-map.

Grounding facts (verified in code today):

- `SessionState` already carries `scenes[]` + `activeSceneId`; `scene-changed` exists.
- Server module state (fog, tokens, doors, lights, triggers) is stored, cached and
  redacted **per sceneId** (`CommandRouter` tags every state-update with its scene).
- Fog already has vision-share modes: `party` vs `individual` (`visionShareOf`), and
  per-identity explored memory per scene (`identityRegion`).
- Client map cache is keyed `(sceneId, mapId)`.
- `WorldTicker` ticks only the active scene — must tick every occupied scene when the
  party splits.

## Hierarchy (settled 2026-08-25, second discussion)

**Game → Location → Floor.** Today's code: campaign → scenes, each scene owns exactly one
map (scene = published map snapshot; all module state keyed per sceneId).

- **Internally flat** (user decision): each floor stays its own scene row — fog/token/
  vision/redaction machinery untouched. Grouping is metadata only: `locationId` + floor
  order on the scene.
- **UI presents Locations**: the rail shows "Watchtower" once with floors nested; travel
  and teleport targets are locations; floors are reached by stairs/portals only.
- **Scenes = travel between places** (narrative jumps, no spatial relation needed);
  **floors = movement within a place** (every adjacent pair needs at least one link).
- **Links are universal**: a link object doesn't care what its ends are — stair between
  floors, teleport circle between locations, ladder into a cave. One object, one
  `tokens.travel` mechanism covers stairs AND teleportation.
- **No one-canvas multi-floor compositing** (user: "tabs make more sense"): one floor
  rendered at a time, tabs + PiP as decided. Render composition was decoupled from data
  nesting anyway; ghost tokens remain a possible later layer, not v1. Fog/vision never
  merge across floors regardless.

## Decisions (user, 2026-08-25)

1. **View model: floor tabs + PiP inset.** Each seat renders ONE full-size scene (its
   *viewed scene*, default = the scene its own token stands on) with a tab strip of
   floors it may view. A small live picture-in-picture inset shows the other occupied
   floor; clicking it swaps. `activeSceneId` becomes the DM's spotlight (default for
   new joiners + "everyone look here").
2. **Travel: DM-only in v1.** Stair/gate link objects pair positions across two maps;
   crossing floors is a DM action (drag / context menu → linked position). Player
   self-serve walk-through comes later.
3. **Spectate fog: full party vision.** In party-share mode, a player viewing a floor
   their token isn't on sees the party's combined live sight there — same as seats on
   that floor. Under `individual` share, spectators get explored-memory only (falls
   out of existing rules).

Viewing permission rule: a seat may view scene S iff its own token is on S, or
(party-share) any party token is on S, or the DM spotlights/marks it visible.

## Build phases (sketch, unapproved)

1. Grouping metadata — `buildingId` + floor label/order on scenes; nested scene rail
   with per-floor token counts ("Ground ×3 · Cellar ×1").
2. Onion-skin authoring — editor renders the floor below as dimmed underlay; shared
   origin/grid within a group ("new floor = copy of below" creation gesture).
3. Stair links + DM travel — link object on both maps; `tokens.travel` command moves a
   token between scenes; travelling player's viewed scene follows.
4. Per-seat viewed scene — client renders viewed scene instead of table-global active
   scene; WorldTicker ticks occupied scenes; tab strip UI.
5. PiP inset — second (cheap) live render of the other occupied floor. Perf-gated;
   possibly DM-first.

Skipped deliberately: cross-floor vision/sound physics (holes, balconies) — not unless
asked. Side-by-side split view — shelved (halves map readability, doubles render cost).

## Prior art (surveyed 2026-08-25)

- **Foundry "Levels" module** — the in-map approach we rejected: elevation is the real
  coordinate, a "level" is a named elevation band (bottom/top), every token/tile/light
  sits at an elevation. Stairs travel between two elevations; polygon "holes" in floor
  tiles make balconies; lights spill through stairwells. Powerful, notoriously fiddly to
  author. Steal: stairs-as-paired-travel, hole polygons *if* we ever do cross-floor vision.
- **Foundry Multilevel Tokens module** — teleport regions (= our stair links) plus
  **token cloning**: mirror tokens from one region into another so another floor's
  activity shows on yours. Direct prior art for our ghost-token idea — validated.
- **Foundry overhead tiles (core)** — the "canopy" technique: a roof/canopy tile drawn
  over the map with an occlusion mode — `fade` (whole tile fades when a token is under),
  `radial` (reveals a circle around the token), `vision` (reveals what the token can
  actually see under it, e.g. through a door). This is a LIGHTER tool than a whole floor:
  right for tree canopies, roofs, bridges, tents within ONE map. Candidate future feature
  for us (canopy overlay layer with fade/radial), orthogonal to floors=scenes.
- **Dungeondraft** — authoring-only levels: "+ Create level" with **clone the level
  below**, flip levels with up/down arrows, transparency underlay of the level below
  while drawing, roof generator. Exactly our phase-2 onion-skin; validated.
- **Talespire** — true 3D stacked slabs; great cinematic verticality but players report
  it is harder to read the map. Validates picking readability-first (tabs+PiP) over the
  dollhouse stack as the primary view.

## Open items

- PiP cost: needs a second resident map + fog pass; decide player vs DM-only after a
  perf spike.
- New-joiner default when their token's scene ≠ spotlight.
- Notification when something happens on an unwatched floor (probably later; log lines
  already route per player).

Mockup: `docs/mockups/2026-08-25-floors-table.html`.

Alternate for reference: `docs/mockups/2026-08-25-floors-table-alt-stack.html` — "Floor
Stack": dollhouse slab stack (current floor full-size, adjacent floors tilted/translucent,
click to travel) + ghost tokens from adjacent floors projected at their true grid position
(shared origin makes this cheap: marker sprites, no second fog pass; party tokens only,
never NPCs). Not chosen; could layer onto tabs+PiP later since it shares the per-seat
viewed-scene model.
