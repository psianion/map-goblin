# Levels and plateaus: what the tower test map shows

Written while building `session/testdata/tower-test.mapbuilder`: a stone tower standing on a raised mound one cell high, with a cellar below and a first floor above. The map has three Levels (Cellar, Ground, First floor), each holding one layer of its own. The mound has stairs down its south side, the tower has a door, and there is a torch by the door. The cellar has a small raised dais, so there is a plateau below ground as well as one above it.

This note is input for deciding what Levels should become. It describes what the map does today, what is unclear or wrong, and what a Level base height would need.

## How the pieces fit together today

- **A Level is a set of layers, and only one Level is shown at a time.** In the editor, picking First floor shows the tower's top room on its own. The mound, the field and the cellar are not drawn at all, not even faintly. At the table, a player sees the Level their token stands on.
- **Plateaus live inside one layer.** Heights, cliffs, slopes, stairs and the bands they form are worked out layer by layer. The mound on the Ground layer knows nothing about the cellar's dais, and the reverse is true too.
- **Every Level starts at height zero.** A height is always measured from that layer's own ground. Nothing says the cellar is below the field or that the first floor is above the mound.
- **Moving between Levels is the DM's call.** The DM moves a token to another Level by hand. Stairs on a cliff only join two heights on the same layer. Nothing on the map joins the mound's top to the first floor, or the field to the cellar.
- **Sight, light, fog and shadows stay on their own Level.** Walls and cliffs only hide things from eyes on the same Level. A light only lights its own Level, and a shadow only falls on the layer that cast it.

## What the test map shows going wrong or unclear

1. **A token upstairs reads height 0.** Standing in the tower's top room, a token's height comes out as 0 because the First floor layer has no plateau. In the real building it stands a full storey above the mound, which is itself one cell above the field. A token standing in the tower hall on the Ground Level reads 1, which is right. Seen side by side, the two numbers suggest the first floor is lower than the hall below it.
2. **The cellar's dais reads +1, as if it were above the field.** In fact it is below ground. Any rule that compares heights across Levels would get this backwards: who can see whom, or how far a fall from the first floor is.
3. **The stairs and the Levels are two separate systems.** A token can climb the mound's stairs and stand at height 1, but there is no way up into the tower except the DM moving it to another Level. A player expects stairs inside the tower to take them up. Today the DM has to remember to make that move.
4. **Fog is per Level, so looking down is impossible.** From the first floor nobody can look down over the mound into the field, even through a window. From the field, nobody can see the tower's upper room lit up. For a tower that is mostly fine. For a balcony over a courtyard, or a gallery over a hall, it is wrong.
5. **The tower's shadow is the walls' shadow only.** On a sunny map the tower casts the short shadow a ground-floor wall casts. A building two storeys tall on a mound should throw a long one. The upper floor's walls cast a shadow only onto the upper floor's own floor.
6. **One picture shows one Level.** The picture export draws what the editor shows, so the tower comes out either as the field with the ground floor, or as the top room floating on its own. There is no "whole building" view.
7. **Rooms inside rooms.** While building the map, the tower hall first took over the whole field as its room, because the field's room wraps around the tower. This is fixed now: a room takes the smallest space that holds its marker, and a raised room's own walls now cut it out of the ground around it. Older maps with a walled chamber inside a bigger room will now place that chamber's room correctly. It is noted here because it shows up the moment buildings stand in open ground.

## What a Level base height would need

- **One number per Level, in cells:** how high the Level's ground stands above the map's ground. Cellar −2, Ground 0, First floor +3 for this tower. Every height on that Level would be read on top of it, so a token upstairs would read 3 + whatever it stands on.
- **A rule for plateaus on any Level.** The cellar dais would be −2 + 1 = −1, still below the field. Plateau heights would stay relative to their Level, which keeps today's maps unchanged with every base at 0.
- **Stairs that change Level.** An opening, or a mark inside a building, that hands a token to the Level above or below, so the DM no longer has to. It needs a clear way for the DM to refuse or allow it, the same way crossing kinds work now.
- **A decision on looking between Levels.** Either Levels stay sealed, as now, or an opening such as a window, a balcony edge or a hole in the floor lets sight and light pass to the Level below. The second is a much bigger change: fog, lights and shadows would all have to look at more than one Level.
- **Shadows from tall things.** A building's shadow on the ground would be as long as its top Level is high, not a wall's height. The cliff shadows already work this way and could serve as the model.
- **A way to see the whole stack in the editor,** with lower Levels drawn faint under the one being edited, so a builder can line the floors up. Today the first floor was lined up with the hall below it by typing the same coordinates, because the hall cannot be seen while working upstairs.
- **What the picture export should do:** one image per Level, or one image of the stack.

None of this is needed for maps that use one Level, and none of it changes how plateaus behave inside a Level today.
