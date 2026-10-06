# Shell v2 — three directions

2026-09-14. Every earlier chrome ruling is scrapped (Moss, night default, right
rail + popover, log on right, panel layout, fonts). What is NOT scrapped is the
product itself: the map is the stage and is painted per the art style guide;
the server is the referee; the DM never loses visibility; zero setup; product
register (familiar affordances, no decoration); contrast ≥ 4.5:1; reduced
motion honoured; Good Goblin is the name.

Reflexes rejected before starting, in both orders:

- first order: parchment, gold trim, serif-everything, "dark fantasy" skins;
- second order: the dark near-black tool with one muted accent and a left
  toolbar + right tabbed panel (Figma-in-the-dark), which is what we had.

The three lanes differ in topology and in theme logic, not in palette. Each
answers "why this theme" with a physical reason, not a mood.

Probes live in `docs/mockups/2026-09-14-shell-v2/<lane>/{editor,table}.html`,
one 1440×900 board each, real map, real copy. Local only, never published.

---

## A. Darkroom

**Idea.** The editor is a photo editor for painted maps; the table is a stage
with a transport bar.

**Theme logic.** Photo editors put images on a neutral mid-grey (chroma 0,
L≈0.35) because it is the only ground on which colour judgement is true. Our
maps are painted; the DM is judging colour, light pools and grid tint. So the
editor chrome is mid-grey, not black and not white. The table is near-black
because the room is dark and the map must be the only bright thing.

**Editor topology.** Left tool rail 48px with the single-key legend printed on
every tool (V, W, D, L…). Right: ONE inspector column, 320px, Selection on top,
Layers below, a draggable divider between them. No maps sidebar: a map
switcher lives in the top strip. Top strip 40px: map name ▾, Build | Prep
mode switch, Search or command (Ctrl+K), Export, Publish. Status line 24px at
the bottom: cursor, zoom, fps, grid size. Chrome retracts to the rails after
2 s idle.

**Table topology.** Bottom conductor bar 56px, always present: Scene ▾ ·
clock/weather · Initiative (current name, Next) · a segmented tool group Fog ·
Doors · Lights · Tokens · a log ticker · Invite. Everything else is a sheet
that slides up from the bar, one at a time, and closes on Esc or on picking a
tool. Prep and Journal are sheets. Player seat: chromeless; turn pill
top-centre; roll bar summoned with R.

**Accent.** Amber taken from the map's torchlight. The chrome's one saturated
colour is the map's own light. Used on the active tool, selection, primary
action and live state only.

**Type.** Hanken Grotesk (UI) + JetBrains Mono (numerals, coords, keys).

**Risk.** Mid-grey editor chrome will look unfamiliar next to every dark tool
people use; that is the point, but it must be tuned so the map still reads as
the brightest thing.

## B. Atlas

**Idea.** A map is a page in the campaign's book. Authoring and prep are one
outline; rooms and notes are first-class named things.

**Theme logic.** The editor is used at a desk under a lamp, so day chrome:
light neutral, chroma 0, L≈0.95, no warmth, so a painted map sits on it like
a plate in a printed atlas. The table is used in a dark room, so the table is
dark. Two rooms, two themes, one vocabulary.

**Editor topology.** Left outline 280px with two tabs, Structure | Layers.
Structure is Campaign → Location → Floor (this map) → Rooms → Notes and
Triggers, each row a real named thing you can rename and jump to. Centre:
canvas. Right inspector 300px. Tools are a floating horizontal palette at the
bottom-centre of the canvas with key legends. Publish sits with the map title
at the top-left.

**Table topology.** A DM screen: a persistent left panel 380px with tabs
Prep · Party · Initiative · Journal · Log, one always open, fold to nothing
with G. Map fills the rest. Map verbs (Fog, Doors, Lights, Tokens) are a
compact top-right toolbar that arms a tool; the armed tool is named in a
top-centre chip with Esc. Player seat: a bottom character strip: your card
(HP, conditions), party portraits, turn marker; Journal is one button.

**Accent.** Deep teal ink. Named things (map titles, rooms, NPCs) set in a
serif; everything else in a sans.

**Type.** Instrument Sans (UI) + Instrument Serif (named things only).

**Risk.** The outline invites the floors/levels model (Game → Location →
Floor) early; the probe shows the hierarchy but the build would ship it flat
until floors land.

## C. Console

**Idea.** Contextual editor, control-deck table. Nothing is on screen unless
it is about the thing you are touching, except at the table where the DM has
a deck of live channels.

**Theme logic.** Both surfaces dark and cool (chroma toward blue, L≈0.14): a
cool cast is the complement of a torchlit map and makes the warm art come
forward. One theme, because the DM's laptop is the same in both rooms.

**Editor topology.** No persistent panels. A floating two-column tool palette
top-left, draggable. The inspector is a card anchored to the selection on the
canvas, showing that object's fields; nothing selected, nothing shown. Layers
is a summoned overlay (L) sliding from the right, Esc closes. A top-centre
mode pill: map name, Build | Prep. Ctrl+K palette. Status line bottom.

**Table topology.** A control deck under the map, 160px tall, channels as
columns: Scene · World · Fog · Doors · Lights · Tokens · Initiative · Log.
Each column shows its live state (Fog: revealed 38%, contained sight on,
look Cloud) and two or three large controls. H collapses the deck to a 32px
strip. Prep is a left drawer. Built for a DM at a laptop with the player view
on a TV. Player seat: chromeless, thin bottom strip with turn and own HP.

**Accent.** Signal green, used as an indicator colour only (live, armed, on),
like a console LED.

**Type.** Geist (UI) + Geist Mono.

**Risk.** Contextual inspectors fail for bulk edits and for a 400-child
layers list; the summoned overlay must be as capable as a panel.

---

## What to decide from the probes

1. Editor theme logic: neutral mid-grey (A), light day chrome (B), or dark
   cool (C).
2. Editor topology: one inspector (A), outline + inspector (B), contextual
   (C).
3. Table topology: conductor bar + sheets (A), DM screen panel (B), control
   deck (C).
4. Whether the player seat is chromeless (A, C) or carries a character strip
   (B).
5. Type pairing.

Lanes can be mixed; an editor from one lane and a table from another is a
valid answer.
