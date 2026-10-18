# Product

## Register

product

## Platform

web (Discord Activity parked — the seams exist in endpoints.ts and auth.ts and stay dormant; nothing new is built for it until after web release)

## Naming

| Name | What it is | Where it may appear |
|---|---|---|
| **Good Goblin** | The product | All user copy, tab titles, marketing, READMEs |
| **the Editor** ("Good Goblin — Editor") | The map-authoring app (canvas) | User copy, editor tab title |
| **the Table** ("Good Goblin — Table") | The live session surface | User copy, table tab title |
| map-goblin | Repo codename | Internal only — never in user copy |
| `@dnd/*`, `session/`, `canvas/` | Frozen internal names | Code and directories only |

Retired names — never use: Map-Goblin (user-facing), map-builder, map-builder-scaffold, Game Runner.

## Voice

Two registers, one product:

- **Marketing voice — the goblin.** Cheeky, quick, a little feral. Lives on the landing page, README openers, the mascot, release notes. Goblin yellow-green is the brand color and lives here only.
- **Product voice — the table.** Warm, dramatic, dependable. In-app copy is calm and short: labels name things, errors say what happened and what to do, nothing jokes mid-session. A DM in a dim room with players waiting never has to parse a bit.

The goblin invites you in; the table never interrupts the game. Marketing voice never appears inside the app; product voice never markets.

## Users

DMs first: they author battlemaps in the editor and run live sessions at the table or over voice — often in a dim room, mid-game, with players waiting, so every interaction happens under time pressure and split attention. Players second: they join from an invite link with zero install, see only what the DM has revealed, and mostly touch tokens and doors.

## Product Purpose

map-goblin is a battlemap editor and virtual tabletop in one: maps authored in the editor are immediately playable in live multiplayer sessions — fog, doors, walls, and lighting derive from the authored data with no re-tracing or manual masking. Success looks like a DM finishing prep in the editor and running the session minutes later, and players trusting what they see because the server never sent them anything else.

## Positioning

The map you drew is the game you run — authored walls, doors, and rooms become live fog, sight, and lighting with zero setup.

## Brand Personality

Warm, dramatic, dependable. The canvas looks like a hand-painted battlemap — torchlit, ink-outlined, painterly, per docs/art-style-guide.md, which is the release gate for all visual output. The chrome around it is quiet, dark, and instantly familiar so the map stays the stage. Drama belongs to the DM: reveals, darkness, and light are play tools, not UI decoration.

## Anti-references

- Owlbear Rodeo's trust model: fog as a client-side courtesy, hidden entities ghosted on the DM's own view. Here redaction is server-enforced and the DM never loses visibility.
- Foundry's setup burden: re-tracing walls and lighting before a map is playable.
- Generic SaaS dashboard chrome wrapped around a game canvas — the tool must read as a table, not an admin panel.
- Photorealism, pixel art, or flat vector on the canvas (art style guide bans all three).

## Design Principles

1. The map is the stage — chrome stays quiet, dark, and restrained; the canvas carries the art.
2. The server is the referee — players see exactly what's revealed, enforced by redaction, never by styling.
3. The DM never loses visibility — hidden and secret things render full-opacity with a badge on the DM view, never ghosted.
4. Zero setup — authored map data is play data; a feature that needs re-authoring is wrong.
5. Motion conveys state (150–250ms); the slow dramatic exception (the fog reveal fade) is a play beat, not decoration.

## Accessibility & Inclusion

prefers-reduced-motion is honored on every animation (reveal fades become instant cuts). Text contrast ≥4.5:1 on the chrome. State encodings never rely on color alone — explored-dim must read as "explored, stale" at a glance on a bad panel, clearly distinct from both black and live. Escape always exits the active tool.
