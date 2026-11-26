# Table lobby pass

One pass on the table, cut from `main` at 69b9b019: a lobby before the game starts, tokens players set up themselves, a party start area, handouts that stay hidden, mark tools that look and feel right, and undo for the DM. Four builders with separate file areas working at once, one tester, one browser run at the end.

## 1. Decisions

**Settled (2026-11-26).**

- A table is "not started" while the DM sets up. Players who join wait in a lobby with the other players. The lobby is its own state; Pause stays the mid-game freeze over the map.
- In the lobby a player picks a character the DM prepared or makes their own, and sets its picture (upload, crop, ring). A DM switch allows player-made characters, on by default.
- The lobby shows no map: the party list and the token editor. The scene name and picture show only if the DM turns that on.
- The map and its art download while the player waits, and the DM sees who is ready.
- The DM marks where the party appears when the lobby ends.
- A player who joins after Start gets the same pick step, then drops in.
- The DM can edit any player's token.

**Open.** Each has a default; the plan is written on the defaults.

| # | Decision | Default | If decided otherwise |
|---|---|---|---|
| a | Going back to the lobby | By hand: Session menu, "Back to lobby". Tokens stay where they are. | Automatic when the DM has been away for a set time: one timer in `SessionManager`, L1. |
| b | Ruler distance | Snaps to cell centres and counts cells, a diagonal as one cell. Alt held measures the straight line freely. | Straight line only: drop the count in M2. |
| c | Ring colours | Ten fixed swatches and "no ring". The default is the seat's own colour. | A free colour picker: one more control in P1. |
| d | Characters nobody picked | Stay off the map at Start unless the DM placed them by hand. | Place every character at Start, as today: one filter in L2. |
| e | What undo covers | Section 5.2. Dice, pause, lock, start, scene switch, rename and delete, templates and drawings are not undoable. | Each module can be added to or dropped from the list in U2. |
| f | Roll requests left unanswered | Not in this pass. They stay until the DM closes them. | Close them on "Back to lobby": two lines in L3. |

## 2. Root causes

All verified by reading the code at 69b9b019 unless marked.

### 2.1 Handouts come back on every load

1. "Show" writes `story.shown` into the campaign's stored state (`packages/mechanics/src/story/module.ts:144`). The state is one row per campaign (`session/server/src/modules/registry.ts:185`), so it outlives the session.
2. Only the DM's Hide clears it (`module.ts:148`). No session start, session end or scene switch does.
3. Every connect snapshot carries the slice (`registry.ts:229`), and `redact` keeps `shown` for anyone in the audience (`module.ts:89`).
4. The player's "Hide for me" is a `useState` in `session/client/src/modules/story/StoryOverlay.tsx:14`. It is never sent and never stored, so a reload forgets it.
5. `shown` has no "which showing" id. The client key is `handoutId:mode` (`StoryOverlay.tsx:19`), so a second showing of the same handout cannot be told from the first.

The title card has the same fault (`StoryOverlay.tsx:41`), with the same in-memory dismissal.

Why tests missed it: the unit test clicks Hide for me and checks the card is gone without a remount (`story.test.tsx:117`); the browser spec uses the DM's Hide and never reloads the player (`e2e/story-dice.spec.ts:7`).

Found on the way, not part of this fault: unanswered roll requests also stay across nights (decision f). Handout journal rows no longer duplicate; trigger toasts, initiative prompts and answered roll requests do not replay.

### 2.2 Undo does not exist

- There is no undo stack, no undo command and no key. `session/client/src/shell/hotkeys.ts:141` returns on every Ctrl, Cmd or Alt key, and `BINDINGS` (`:83`) has no undo entry.
- The only undo is a toast on Fog's "Clear all" and "Fog all" (`session/client/src/modules/fog/FogTab.tsx:57`). It snapshots the whole cleared record in the browser and sends `fog.restore`.
- That toast is one slot with a 5 s timer (`session/client/src/session/toasts.ts`); any other toast replaces it.
- The snapshot is the whole record, so restoring it also wipes what players explored in those 5 s.

Every other DM action (tokens, doors, lights, sky, fight, story, pins, fog brush) has nothing behind it.

### 2.3 Mark tools are a first draft

`session/client/src/shell/marks/MarksLayer.tsx` is 96 lines. Verified there and in `markInput.ts`, `marks.ts`, `rail/tools.ts`:

- Every mark shares one 2 px line style. Text has no backplate and is sized in map cells, so it is unreadable zoomed out and huge zoomed in.
- Nothing fades or moves. A ping is a still ring that pops out after 3 s; rulers and drawings vanish the same way.
- No snapping anywhere. The ruler is a straight-line distance with no grid count.
- Templates: the server accepts circle, cone, line and square (`session/server/src/ws/marks.ts:23`); the client only ever makes and draws a circle, and has no shape picker and no "clear all".
- Drawing appends every pointer move unsmoothed. Over 500 points the server refuses the stroke and the DM alone still sees it.
- Esc does not cancel a ruler mid-drag (reported, not run). The ruler's last position is not always sent.
- A pin is a dot. Its text box allows 280 characters; the server caps at 200.
- The DM's "pull everyone's view" is Shift+Alt+click with no hint anywhere.
- An armed tool shows nothing but a pressed rail button. `toolLabel()` in `session/tools.ts` is unused.
- A refused mark (paused table) is silent.
- Marks carry a scene id the client does not filter on (reported, not run).
- `packages/ui/src/theme/tokens.css` has no motion tokens.

### 2.4 What the lobby and the start area have to be built on

- A new table is open to players at once. There is no "started" flag: `sessions` has `paused` and `movement_locked` only (`session/server/src/db/migrations.ts:129`).
- The pause gate refuses every player command (`registry.ts:124`); the pause overlay makes the player's page inert (`session/client/src/shell/PauseOverlay.tsx`). A lobby cannot reuse it.
- Sessions are long-lived: opening the table again reuses the live session (`session/server/src/http.ts:1166`). So "started" must be able to go back to "not started".
- Joining always mints a new identity (`http.ts:1084`); a same-session seat is renewed by `POST /api/seat/refresh`. A returning name gets its PC back through `reattachPc` (`session/server/src/party.ts:95`).
- A player cannot create a character: `tokens.library-upsert` is DM only (`packages/mechanics/src/tokens/module.ts:128`). A player may edit `name`, `sheet`, `imageAssetId`, `nameplate` of a token they own (`:100`).
- Any seat may upload art already, 2 MB, png, jpeg or webp (`http.ts:771`). There is no crop, resize or ring field. The ring drawn today is the disposition colour (`session/client/src/modules/tokens/TokenRenderer.ts:261`).
- The party is placed once, when the session is created, around one point or room anchor: `spawnParty` (`party.ts:25`). It places every PC def, picked or not. Nothing places a PC whose player arrives later.
- The canvas "party start" is a single point in `mapSettings.partyStart`, read only by the host wizard (`session/client/src/pages/startingRoom.ts:73`). The server never sees an area.
- `prefetchSceneMap` (`session/client/src/session/loadSceneMap.ts`) already downloads a scene and warms its art without the renderer; `prepareTableForJoin.ts` uses it. Token pictures are not part of it, and no "ready" signal exists.
- A seat's colour is a hash of its identity id (`session/client/src/shell/seatColour.ts`), not stored anywhere.

## 3. Lobby, characters and the party start

### 3.1 Table state

`TableFlags` grows from two flags to five, all on the `sessions` row and mirrored into the `table` slice the way `paused` is.

| Flag | Meaning | New session | Rows that exist today |
|---|---|---|---|
| `started` | Players are on the map | false | true (a live table keeps running) |
| `playersMakePcs` | Players may make their own character | true | true |
| `lobbyShowsScene` | Lobby shows the scene name and picture | false | false |

The `table` slice also holds `ready: Record<identityId, string>`, the `sceneId:mapId` each seat has finished loading. It is not on the row.

Commands on `table`:

- `start {on}`, DM. On: section 3.5 runs. Off ("Back to lobby"): players return to the lobby, tokens stay, and the handout and title card on show are cleared.
- `set-lobby {playersMakePcs?, lobbyShowsScene?}`, DM.
- `ready {key}`, any seat.

### 3.2 Gates

In `ModuleRegistry.dispatch`, after the role check: a player's command on a table that is not started is refused with a new `TABLE_NOT_STARTED` ("the DM has not started the table yet"), unless it is on the lobby list. The lobby list also passes the pause gate.

Lobby list: `tokens.pc-create`, `tokens.pc-claim`, `tokens.pc-release`, `tokens.pc-update`, `table.ready`, `story.dismiss`.

`SessionManager` refuses a player's mark on a table that is not started, beside the pause check at `SessionManager.ts:208`.

A player seat is still sent the scene and the slices as today; the lobby is what the client shows, not a secrecy rule. Fog redaction is unchanged.

### 3.3 Characters

A character is a `kind: 'pc'` def in `tokens.library`, as today. New player commands on `tokens`:

| Command | Rule |
|---|---|
| `pc-claim {defId}` | The def is a PC with no owner name and no owner id. The sender owns no PC. Sets `ownerIdentityId` and `ownerName` on the def and `ownerId` on every token placed from it. |
| `pc-create {name, imageAssetId?, ring?}` | Refused when `playersMakePcs` is off or the sender owns a PC. Creates a medium PC def owned by the sender. |
| `pc-update {name?, imageAssetId?, ring?}` | The sender's own PC. Writes the def and every token placed from it. |
| `pc-release {}` | Clears the owner on the sender's PC and its tokens. The def stays in the library. |

- One PC per seat.
- A PC the DM saved for a name (`ownerName` set, nobody holding it) cannot be claimed; it attaches through `reattachPc` when that name joins, as today.
- The DM's `assign` and Token type sheet keep working.
- `ring` joins `PLAYER_FIELDS`, so a player can also change it on their token mid-game.

### 3.4 Token picture and ring

- `TokenDef.ring?: string`: `#rrggbb`, or `none`. Absent keeps today's disposition ring.
- `TokenRenderer`: a PC with a ring colour draws its ring in that colour in place of the disposition colour; `none` draws no ring. `ring` joins `signature()`.
- `TokenPortrait` shows the same ring, so the library, party list, turn order and cards match the map.
- New `TokenArtEditor` in `session/client/src/modules/tokens/`:
  - pick a file (png, jpeg, webp);
  - pan by drag and zoom by wheel, pinch or slider inside a circle;
  - ring swatches (ten colours and "no ring"), default the seat's colour;
  - a live preview at map size;
  - Save draws a 512 px square webp (png when webp encoding is missing), uploads it through the existing route, then sends `pc-update` or `library-upsert`.
- The editor is used in three places: the lobby, the player's own token card ("Edit my token"), and the DM's Token type sheet.

### 3.5 Party start and placement

- `tokens.partyStart: Record<sceneId, {x0, y0, x1, y1, levelId?}>`, a rectangle of cells. DM command `set-party-start {sceneId?, rect | null, levelId?}`. Removed from what players are sent. `forgetScene` drops it.
- `openSession` stops placing the party when it creates a session. It stores the wizard's choice as the area when the scene has none: the 3 by 3 cells around the chosen point or room anchor.
- `spawnParty` becomes `placeParty(defs, target)`: the standable, free cells of the rectangle from the centre outward, then `fanAround` the centre when the rectangle is full. It still places through `tokens.place` as the DM.
- **At Start:** every PC owned by a seat at this table and not on the live scene is placed in the live scene's area. PCs already on the scene do not move. Unpicked PCs stay off the map (decision d).
- **After Start:** a `pc-claim` or `pc-create` by a seat with no token on the live scene places that PC beside the party (fan around the centre of the PC tokens on the scene), else in the area. With neither, nothing is placed and the DM is told.
- **DM tool:** "Party start" in the Tokens tab and in the lobby roster arms a rectangle drag on the map, snapped to cells. Esc cancels. The area shows on the DM's map as a dashed rounded rectangle with a "Party start" label, always while not started and while the tool is armed.

### 3.6 Player screens

`GameTable` renders the lobby in place of the renderer and the table chrome for a player while `started` is false.

- **Header:** the table's name, "Waiting for the DM to start". With `lobbyShowsScene`, the scene name and thumbnail.
- **Your character:** with none, a grid of PCs (picture, name, and free, taken by a name, or saved for a name) and a "Make your own" tile when allowed. With one, the token editor and "Choose a different one".
- **At the table:** every seat with its colour, name, character and a ready mark or progress.
- **Footer:** "Getting the map ready" with progress, then "Map ready". Leave table.
- Works at 390 px wide, one column.
- **Loading:** the lobby runs `prefetchSceneMap` for the live scene and fetches every token picture on it, then sends `table.ready`. It runs again when the live scene or its map changes.
- **At Start:** the lobby gives way to the map and the camera goes to the player's token.
- **A seat with no character on a started table** (late joiner, or one who never picked) sees the map with a "Pick your character" card that opens the same picker. It sits above the pause overlay.

### 3.7 DM screens

- While not started, the title card area shows "Not started", "2 of 3 ready" and a primary "Start the table". Starting with seats still loading is allowed; the count says so.
- The count opens the roster: each seat with its character and ready mark, a picker to hand a seat a character, "Edit token", the two switches of 3.1 and "Set party start".
- After Start, Session menu has "Back to lobby" with a confirm line: "Players go back to the lobby. Tokens stay where they are."
- The host wizard's start step keeps its choices; its heading becomes "Where the party starts".

## 4. Handouts and title cards

- `shown` and `titleCard` each gain `shownAt` (the handout has none today) and `dismissed: {id, name}[]`.
- New player command `story.dismiss {what: 'handout' | 'title', shownAt}`. It adds the sender when `shownAt` matches what is on show.
- `redact` drops `shown` or `titleCard` for a viewer in `dismissed`, and never sends the list to players.
- Showing again mints a new `shownAt` and an empty list, so a second showing reaches everyone.
- A returning name keeps its dismissals: the join path that calls `reattachPc` also adds the new identity to any dismissal under the same name.
- "Back to lobby" clears both (3.1).
- Client: "Hide for me" hides at once and sends `dismiss`. The handout stays in the player's journal.
- DM: the Story tab's "showing" row says how many seats still have it up.

## 5. Undo for the DM

### 5.1 How it works

History lives on the server, per session, in memory, 100 steps.

- `CommandRouter` runs a DM's command through a recording dispatch. The registry notes each module's state before its first write in that dispatch, including the writes the command causes (trigger cascades, auto-explore). When the dispatch returns it diffs before and after.
- The diff walks plain objects and treats arrays and other values as leaves. A step is the list of changed leaves with their before and after values. An empty diff records nothing.
- **Undo** puts the before values back onto the current state, leaf by leaf, so anything else that changed since stays. It persists, broadcasts each module's slice tagged with the step's scene, and re-sends the slices in `RETRACTS`. It runs no trigger cascade and no after-write rule.
- **Redo** puts the after values back the same way. Any new recorded command empties the redo list.
- **Fog** is the one module with its own merge: a step restores only the cells that step changed, and leaves cells the players explored since.
- **Grouping:** the command message gains an optional `group` string. Steps with the same group from the same seat merge into one. A token drag and a fog brush stroke each send one group id for the whole gesture.
- Commands the server sends as the DM (clock, effect ticks, party placement) are not recorded: they do not come through `CommandRouter`.
- Deleting a scene empties the session's history.
- New wire messages: client `{type: 'history', op: 'undo' | 'redo'}`, DM only; server `{type: 'history', undo: {module, action} | null, redo: {module, action} | null}` to the DM after every change to the lists.

### 5.2 What is recorded

Recorded: `tokens`, `fog`, `doors`, `triggers` (lights, sky, world, room keys, spawned encounters), `initiative`, `story`, `pins`, `crossings`.

Not recorded: `table` (pause, lock, start), `rolls`, `ping`, `scenes`, and anything whose truth is not in `module_state`. Builder U checks every module registered in `session/server/src/index.ts` against this rule and lists the result in its report.

Templates and drawings are not module state. They keep their own clearing (section 6).

### 5.3 Client

- Ctrl or Cmd+Z undoes, Ctrl or Cmd+Shift+Z and Ctrl+Y redo. DM only. They are handled before the modifier guard at `hotkeys.ts:141` and never while typing in a field.
- Undo and Redo buttons in the top bar, disabled when the server says the list is empty, each with a tooltip naming the step ("Undo token move").
- Each undo shows a short toast ("Undid token move") with a Redo action. Step names are a client table keyed by `module.action`.
- Fog's bulk toast keeps its Undo button, now calling history undo. `fog.restore` and its tests go.
- Both keys join the shortcuts sheet.

## 6. Mark tools

One design job for ping, ruler, template, drawing and pin. The marks stay an SVG layer over the map.

**For all of them**

- Lines, glyphs and labels keep one size on screen at every zoom. Sizes in map cells are for geometry only.
- Labels sit on a pill (`--panel` fill, `--line` edge), never bare on the map.
- Marks arrive in about 150 ms and leave in about 400 ms. Nothing pops. New motion tokens in `packages/ui/src/theme/tokens.css`; `prefers-reduced-motion` gets a plain fade.
- Other seats' marks carry their seat colour; the grayscale tokens do the rest. Light and dark.
- Panning and zooming do not re-render marks; the layer's transform follows the camera as today.
- A mark shows only on its own scene.
- A refused mark says why in a toast.
- An armed tool shows an options strip beside the rail: the tool's name, its options, its one-line hint, and its clear button.

**Ping.** A dot with two rings that ripple outward and fade over the 3 s. The sender's name on a pill. A ping off screen shows an arrow at the screen edge pointing to it. The strip names the DM's "pull everyone's view" (Shift+Alt+click) and gives it a button.

**Ruler.** Snaps to cell centres (decision b), with end dots and a label pill at the far end: "30 ft". Alt measures freely. Esc or right-click cancels the drag. The last position is always sent. It fades 1.5 s after release.

**Template.** A shape picker in the strip: circle, cone, line, square. The origin snaps to cell corners and centres, the size to whole cells. A cone and a line aim at the pointer. A soft fill, a crisp edge, a label pill ("20 ft cone"). Templates stand until removed: click one with the tool, or "Clear templates" in the strip.

**Drawing.** A smoothed stroke with round caps and joins. Points are thinned as they are drawn so a stroke never passes 500. It fades over its last second. "Clear drawings" in the strip.

**Pin.** A proper marker glyph with its text on a pill. A DM-only pin carries a small hidden badge. The text box matches the server's 200.

## 7. Builders, contract, steps

Builders P and M load `design-taste-frontend` before writing any interface code and work inside the v2 tokens: grayscale, no accent, light by default, dark one click away. Seat colours and ring colours are the only colour.

Each builder does each thing once. A failure it cannot explain stops and is reported; nothing is retried without a decision. Each step ends with its package's typecheck, lint and the builder's own tests. One `pnpm -r check` over the whole tree runs when all four are done.

Four builders, split by feature so that only one waits on another. All four work at once in the main checkout on the branch `table-lobby-pass`. Each owns its files outright, stages them by name, and commits only those paths.

| Builder | Feature | Owns |
|---|---|---|
| L | Lobby rules: table flags, gates, characters, party start, placement, story dismissals | `packages/mechanics/src/{table,tokens,story}`; `session/server/src/{db,http.ts,party.ts,index.ts,modules/table.ts,ws/SessionManager.ts}` and their tests |
| U | Undo, both ends | `session/server/src/modules/{registry.ts,history.ts}`, `ws/CommandRouter.ts`, `packages/mechanics/src/fog`, `packages/core/src/shared/protocol.ts`; client `shell/hotkeys.ts`, `shell/top/HistoryButtons.tsx` and its mount line, `session/store.ts`, `modules/tokens/drag.ts`, `modules/fog` |
| P | Lobby, token editor, DM strip, story on the client | `session/client/src/pages/{GameTable,HostSetup}.tsx`, `shell/lobby/`, `modules/tokens/` except `drag.ts`, `modules/story/`, `shell/top/{TitleCard,SessionMenu,sessionActions}`, `shell/{pause.ts,PauseOverlay.tsx,WaitingCard.tsx,portrait.ts}`, `session/{loadSceneMap,prepareTableForJoin}.ts` |
| M | Mark tools | `session/client/src/shell/{marks,rail}`, `session/tools.ts`, `session/useRefusalToasts.ts`, `packages/ui/src/theme/tokens.css`, `session/server/src/ws/marks.ts` |

**The contract commit.** L's first commit, before anything else of its own. It carries every shared edit so no two builders ever change one file:

- `protocol.ts`: the optional `group` on a command, both `history` messages, the version bump.
- `registry.ts`: the injected `pausedOf` becomes a seat gate, `(sessionId, module, action) => CommandError | null`, asked for every player command; an empty `forgetHistory(sessionId)`.
- `CommandRouter.ts`: `history(conn, op, scope)` and `sayHistory(conn)`, both empty.
- `SessionManager.ts`: routes the client's `history` message to the router, calls `sayHistory` for a DM after the join snapshot, calls `forgetHistory` when a session ends.
- `mechanics`: the state shapes, command names and refusal constants of sections 3 and 4, with handlers that refuse.

After it lands, `protocol.ts`, `registry.ts` and `CommandRouter.ts` are U's. Until it lands, U, P and M work only on files that do not need it: U on the diff and merge in `history.ts`, P on the token art editor, M on everything.

| Step | Builder | Work |
|---|---|---|
| L0 | L | The contract commit |
| L1 | L | Table flags, migration, the gate, `openSession` stores the area and no longer places the party |
| L2 | L | PC commands, `ring`, party start area, `placeParty`, placement at Start and on a late pick |
| L3 | L | Story dismissals, carry-over by name, clear on "Back to lobby" |
| U1 | U | `history.ts`: diff, apply, grouping, cap; the fog cell merge |
| U2 | U | Recorder in the registry, undo and redo in the router, wire messages; `fog.restore` goes |
| U3 | U | Keys, buttons, toasts, group ids on the token drag and fog stroke, fog toast; `undo.spec.ts` |
| P1 | P | Token art editor, ring on the map and in portraits; `token-art.spec.ts` |
| P2 | P | Lobby screen, loading and ready, the no-character card; `lobby.spec.ts` |
| P3 | P | DM strip and roster, "Back to lobby", party start tool and outline, wizard heading |
| P4 | P | "Hide for me" sends `dismiss`, the Story tab's count; `handout-hide.spec.ts`; the specs of 9.2 that now need Start |
| M1 | M | Marks layer: fixed-size glyphs and pills, motion tokens, scene filter, edge arrows |
| M2 | M | Input: snapping, cancel, shapes, point thinning, last position |
| M3 | M | Options strip, clear buttons, refusal toast, pin glyph and card; `marks.spec.ts`, `shell` and `player-phone` specs |

Builders write browser specs and do not run them. A builder that needs a change in another's file says so in its report; it does not make it.

## 8. Speed

Measured on `main` before the first step and on the branch after the last, cold and warm, on the outdoor cave test map.

| Path | Budget |
|---|---|
| DM opens the map | No slower than `main` |
| A recorded token move, 200 tokens on the scene | History adds under 0.5 ms |
| A fog stroke flush on a 200 by 200 scene | History adds under 5 ms |
| Start pressed to map on screen, for a ready seat | Under 1.5 s, and no slower than join to map on `main` |
| Pan and zoom with 20 marks up | No dropped frames against `main` |

Guard tests that count work, not time:

- one diff per recorded dispatch, none for a player's command or a server tick;
- the diff of one token move on a 200-token scene visits under 1,000 nodes;
- a camera move re-renders no mark;
- the lobby fetches the scene once per `sceneId:mapId`.

## 9. Tests

### 9.1 Unit (each builder, with its step)

- **History:** move, delete, hide and HP change undo and redo; a drag is one step; a fog stroke is one step and undoing it keeps cells explored since; a trigger fired by a move is undone with it; a player's move after the DM's is kept when the DM undoes something else; nothing is recorded for `table`, `rolls`, `scenes`, players or server ticks; the 100-step cap; a new command empties redo.
- **Table:** a new session is not started and an existing row is; the not-started gate refuses a move and passes the lobby list; the pause gate passes the lobby list.
- **Characters:** claim, create, update, release; one PC per seat; a saved PC cannot be claimed; create refused when the switch is off; `ring` validated.
- **Placement:** the area fills from the centre; a full area fans out; PCs on the scene do not move; unpicked PCs stay off; a late pick lands beside the party.
- **Story:** a dismissal survives a fresh snapshot; a second showing reaches a seat that dismissed the first; a returning name keeps its dismissal; players never receive the list.
- **Client:** `StoryOverlay` stays hidden after a remount with a fresh store; the art editor's output is 512 px and under the cap; ruler snapping and the cell count; stroke thinning stays under 500; Esc cancels a ruler drag.

### 9.2 Browser specs (in `session/client/e2e/`)

| Spec | Covers |
|---|---|
| `lobby.spec.ts` | Join lands in the lobby; pick one PC, make another; DM sees ready; Start puts both tokens in the area; a late joiner picks and lands beside the party; Back to lobby |
| `token-art.spec.ts` | Upload, crop, ring; the token on the map and the portrait match |
| `handout-hide.spec.ts` | Hide for me, reload, still hidden; rejoin under the same name, still hidden; the DM shows it again and it appears |
| `undo.spec.ts` | Token move, delete, fog stroke, door, by key and by button; redo |
| `marks.spec.ts` | Ping appears and leaves; ruler label snaps; each template shape; both clear buttons |

Existing specs that change: `host-join`, `rejoin`, `pause`, `fog-map`, `outdoor-cave` (the party now appears at Start), `shell`, `player-phone`, `story-dice`.

### 9.3 The one run, awaiting approval

One tester, one run of the specs above after the last builder step, scoped to these files. Failures are reported and confirmed before any rerun.

## 10. Risks

- **Whole-slice diff cost.** The diff relies on handlers keeping unchanged subtrees by reference. A handler that clones its state makes the diff walk everything. U2 measures each recorded module once and reports any that clone.
- **Undo across a republish.** A step may name a room, door or level the new map no longer has. Undo applies leaves as stored; a module that validates ids on read must tolerate it. U2 tests one republish between a step and its undo.
- **Party placed at Start, not at open.** Every test and habit that expects tokens on the map straight after hosting changes. The DM sees the area outline instead.
- **Lobby gate and old clients.** A client from before this pass on a not-started table would mount the map and have every move refused. The protocol version is bumped so it reloads.
- **Renewed seats.** A seat renewed by `seat/refresh` keeps its identity and so its PC and dismissals; a rejoin by name goes through `reattachPc`. Both paths are in the unit tests.
- **Not run on screen in this plan's research:** the mark tools' current look, the Esc and scene-filter gaps in 2.3, and how long `prefetchSceneMap` takes from a lobby with no renderer.

## 11. After the pass

- Place the party at a scene's start area on a scene switch too.
- A seat's colour chosen by the player (today it is a hash) and shared by ring, pings and rulers.
- Ruler and ping on the phone bar.
- Roll requests closed at the end of a night (decision f).
