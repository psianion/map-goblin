# Rooms that work on every kind of floor

Branch `table-lobby-pass`, on top of `055280da`. One pass, editor and table.

## 1. Why

The owner's report (2026-11-27): setting rooms and suggesting rooms is broken in the editor and at the table, for walled rooms, for brush-made floors and caves, and for rooms marked by hand. "There are no provisions." At the table a whole brush cave came through as one room.

Decisions taken with the owner:

- Rooms appear on a **button** (Suggest rooms), never by themselves.
- Rooms **and corridors** can be marked as rooms.
- Floor with no walls round it is marked by **drawing an outline**. No click-to-fill, no room brush. On a layer with no walled floor and no wall, the painted floors stand in as the floor for Suggest and are accepted as pinned rooms that follow the floor; with walls or walled floor present, loose patches are still outline only (§3.4).
- The table gets **nothing new**. Rooms made in the editor must arrive and work.

## 2. What is wrong today (checked in code and on the owner's maps)

| # | What happens | Cause |
|---|---|---|
| 1 | "FA cave dungeon" (seven joined cave floors) has no rooms, and Suggest can only offer the whole cave as one room. | A face is one connected floor. Nothing splits it at passages (`roomDetection.ts:67`). |
| 2 | A floor drawn with the Floor tool at its default, or any brush stroke, never becomes a room. | Both are stored as ground, and ground is left out of the floor union on purpose (`mergedFloor.ts:26`, `newFloor.ts:25`, `MaterialTool.ts:189`). |
| 3 | Walls over ground, then Suggest, then Accept: the rooms read "No floor here". At the table they have no shape, so notes, lights, Place and the start list fail. | Suggest uses the map frame as floor (`suggestRooms.ts:73`); the sync that places rooms does not (`roomSync.ts:78`). |
| 4 | A picture-only map with such rooms refuses every move: "There is no ground there". | `hasRooms` counts rooms with no shape (`walk.ts:64`, `levelGrid.ts:84`). |
| 5 | A room inside another (a cave in a field) is answered wrongly by point lookups. | `roomIndex.roomAt` takes the first hit, not the smallest (`roomIndex.ts:59`). |
| 6 | No way to mark a room over floor that already exists. | Nothing writes `Room.boundary`; Draw room always lays a new walled floor. |
| 7 | The owner could not find the room controls. | The Rooms tool sits under the Text family on the rail. |
| 8 | Suggest proposes specks. | A 0.3-cell sliver on "Testing" is offered as a room (`minArea` is 0.25 of a cell). |

What works and stays: divide lines. "Testing" has three and its four rooms come out separate in the editor code and on the server (probed, areas 37.3 / 29.1 / 24.5 / 25.5 cells).

Other tools, for reference: the ones that cope with caves and open ground treat a room as a named region over any art (Foundry Regions, Shard fog regions). The quick ones add a suggestion step with correction tools on top (click inside walls; Owlbear's auto-trace with slice and join). Tools that only know "room = floor and walls drawn together" have no answer for caves.

## 3. The model after this pass

A room is still what it is today: a pin (`anchor`) that takes the face under it, or a hand-drawn outline (`boundary`). No new stored field, no format change, no migration.

Three changes to how faces are found, all in shared core so editor and server agree:

**3.1 Passages split faces (Suggest only).** Suggest proposes divide lines where a floor narrows, so chambers and corridors come out as separate ghosts.

- Sample the face at a quarter of a cell. Clearance = distance to the nearest edge.
- Chamber cores: samples with clearance of 1.25 cells or more (a space at least 2.5 cells across). Drop cores under 4 square cells.
- Grow each core back by the same distance, nearest core wins. What is left is passage.
- A passage that touches one chamber and is under 3 square cells joins that chamber. Otherwise it is a corridor.
- One straight divide line per place a chamber meets a corridor or another chamber, run 0.3 of a cell past the floor edge at both ends.
- Keep a line only if it raises the count of faces of at least 1 square cell. A scrap under 1 square cell beside a wall is let be; it is never offered as a room.
- A face with a chamber core is never named a passage.
- A face with fewer than two parts gets no lines.

Accepted lines are ordinary `ThresholdSegment`s, the same as the Divide tool makes. Constants are fixed in code, not settings.

**3.2 Ground counts as floor when walls enclose it.** Only on a layer that has at least one standalone wall (so wall-less layers cost nothing extra):

- Room floor = walled floors ∪ ground pieces ∪ the map frame (when the level has base ground, or the layer has no floor at all).
- Extra cutters: a thin cut along every walled floor's ring (what `caveCutters` already does for caves), and one across every door's width.
- A face in ground is **closed** when, grown by 0.2 of a cell, it stays inside the room floor. Only closed faces are suggested or given to a pin. The open outdoors is never a room by itself.
- Suggest and the sync share this one function, so an accepted room keeps its face.

**3.3 Outlined rooms.** `boundary` gets its author. The room's face is the outline cut down to the standable ground under it (largest part); on a picture-only map it is the outline as drawn. So a loose outline round a cave chamber becomes that chamber.

**3.3a Short walls and doors.** For room faces only, a standalone wall or a door that stops short of the floor's edge by less than 1 cell is run on along its own line to that edge, closing the gap; a full cell or more stays open. A door across a gap cuts room faces on walled floor too, not only on ground. Sight, light, walking and drawing read the walls as drawn.

**3.4 Painted floors on a layer without walls.** When a layer has no walled floor and no standalone wall, Suggest reads its visible ground pieces as the floor: pieces of one texture that touch are one area, different textures stay apart (a later piece covers what it lies over), and base ground is never a room. Each area is split at passages as in 3.1. The ghosts are ordinary pinned rooms, an anchor inside each part, and the kept lines become thresholds. The sync places a pin that no walled or closed ground face holds in the painted area under it, cut by the layer's walls and thresholds, on any layer: so a painted-floor room follows its floor when it is repainted or reshaped, and keeps it when walls or walled floor are added later. A pin on bare base ground stays open. With walls or walled floor present, Suggest does not propose loose patches; they are outline only.

Also:

- Point lookups return the **smallest** room holding the point (`roomIndex.roomAt`, and true area in `roomSync` in place of the box area).
- Suggest's smallest face is 1 square cell.
- A cave mouth keeps cutting the face: a mouth is a room edge. Not a bug under this model.

## 4. Editor

1. **Rooms is its own family on the rail** (out of Text), key R if free. Tools: Outline (default), Divide, Draw room (floor and walls, as today). Panel: Suggest rooms, Room outlines switch, Rooms list.
2. **Outline tool.** Drag a rectangle or click a polygon; Enter or a click on the first point closes it. Makes a numbered room, one undo step. Double-click an outlined room to move its points, with the handles a floor polygon uses.
3. **Suggest rooms.** Shows numbered ghosts and the dashed divide lines it would add. Each line and each ghost has a ✕. Removing a line redraws the ghosts. Accept all is one undo step: lines, then rooms. Existing rooms are never replaced; a room keeps the part its pin is in. Corridor ghosts are named "Passage N".
4. **Words when Suggest finds nothing:** "No closed spaces without a room. A gap in the walls needs a door, or draw the room's outline."
5. **A room that lost its floor** says why on its card ("This space is open") with an "Outline it" button that starts the Outline tool.
6. **Publish** shows the room count, and when the map has floor and no rooms, a "Suggest rooms" link.

The editor screens are built straight from this plan, inside the v2 styles, and shown to the owner as screenshots of the working build.

## 5. Table (correctness only)

- The server derives faces with the same core function, passing the frame and base ground.
- Walking: outline-only rooms never restrict it. `hasRooms` becomes "has authored floor".
- Lights-in-room, Place, notes and triggers use the smallest-room lookup.
- The Host wizard's start list leaves out rooms with no shape.
- No new table controls.

## 6. Builders and order

Two builders and one tester.

- **A, core and server:** section 3, section 5, unit tests, the speed guard. First commit is the shared signature (`roomFloor`, `suggestDivides`, the `syncRooms` context) so B can build against it.
- **B, editor:** section 4. Loads a design skill, stays inside the v2 tokens.
- **Tester:** the scoped browser files in section 8, one run, after the on-screen walk.

`pnpm -r check` after each builder pass. One commit per builder pass, plus one for fixes found on the walk.

## 7. Speed

Suggest runs on a button, so its cost is felt once. Budget: under 150 ms on "FA cave dungeon".

The sync runs on every edit. Measure `syncRooms` before and after on `goblin-warren`, `testing-cave` and a copy of "Stairs check" (walls and floors): no slower on the first two (their layers take the old path or one extra union), at most 20 % slower on the third. A guard test counts union calls per sync. Map open is timed in Chrome after deploy, cold and warm, against the live build.

## 8. Tests

Unit (core and server):
- seven joined cave floors: Suggest returns four chambers and their passages; accept, sync, every room keeps a distinct face;
- ground plus walls: Suggest, accept, sync: no room is orphaned; server faces equal editor faces;
- a walled yard with a gap is not suggested; with a door in the gap it is;
- base ground alone suggests nothing;
- an outline over a cave chamber is cut to the floor; over a picture it is kept as drawn;
- a point in a nested room answers the inner room;
- a picture-only map with outlined rooms stays walkable;
- no suggestion under 1 square cell on `testing-cave`;
- `goblin-warren` and `testing-cave` keep their rooms and faces unchanged.

Browser, scoped, one run:
- editor: find Rooms on the rail; brush a cave with two chambers and a passage (brush strokes, not rectangles); Suggest; remove one line; accept; outline a room on open ground;
- table: publish that map; the start list and the Map tab show the same rooms; a token walks through all of them.

Acceptance on the owner's maps, by hand on a copy: "FA cave dungeon" gets its four cave rooms and passages from one Suggest; "Stairs check" gets its walled rooms; both arrive at a test table with the same rooms.

## 9. Risks

- Organic caves can split in odd places. The lines are proposals, each removable, and Divide and Outline correct the rest.
- Counting ground as floor changes faces on layers that have walls. The fixture tests in section 8 pin today's rooms.
- Overlapping rooms (an outline inside a larger room) are allowed; the smaller one wins every lookup. Areas are not subtracted from each other.

## 10. Not in this pass

Click-to-fill, a room brush, automatic rooms while drawing, room controls at the table, one-click room reveal.
