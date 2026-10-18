# Chrome Style Guide — Moss

The release gate for **chrome**: panels, toolbars, inputs, dialogs, toasts, status bars, join
screens. The canvas art is governed separately by `docs/art-style-guide.md`; this file governs
everything drawn *around* it, in both the editor and the table.

Closes the gap flagged in `docs/2026-07-30-brand-design-audit.md` §5 ("no design guide for the
chrome"), which is why the two apps were drifting into separate dialects.

## Colour strategy: Restrained

This is a product surface, not a landing page, so the floor is **Restrained**: tinted neutrals
plus one accent held to roughly 10% of what you see.

- **Surfaces are tinted greys, not green.** 8–10% saturation with a green cast. Green is the
  temperature of the neutral, not a colour in its own right.
- **Moss is the only saturated thing on screen.** It is spent on exactly four jobs: the active
  tool, the current selection, the primary action, and live state. Never ambient fill, never
  decoration, never "brand presence".
- **One focal per screen.** Three accents mean none.

The saturated goblin yellow-green stays a *marketing* colour — mascot, landing page, release
notes. The brand colour does not have to be the interface colour.

> This replaces the "Achromatic Shell" (`canvas/tailwind.config.ts`), whose premise was an
> achromatic accent "so colour never becomes the only state encoding." Moss keeps that
> guarantee by shape instead of hue — see State encoding below.

## Modes

**Night is the default.** A DM runs a session in a dim room with the map carrying every bright
pixel; a light chrome is the thing you squint past all evening. Day exists and is a real pair,
not an inversion — it is reached by dropping `.dark` from `<html>`.

Night uses **wider steps between surfaces** than day. On a near-black ground, evenly spaced
values collapse into one flat sheet, panels stop reading as panels, and the chrome turns to mud.

## Tokens

Declared in `canvas/src/index.css` as raw RGB channels, so Tailwind's opacity modifier works on
every one of them (`bg-surface-1/80`, `ring-ring/50`). Raw CSS reads them as `rgb(var(--x))`.

| Token | Night (default) | Day |
|---|---|---|
| `surface-0` ground | `15 16 14` | `223 227 222` |
| `surface-1` panel | `24 26 23` | `239 241 238` |
| `surface-2` card | `35 37 34` | `213 218 211` |
| `surface-3` active | `48 51 46` | `200 206 197` |
| `text-primary` | `234 236 233` | `27 31 26` |
| `text-secondary` | `182 188 179` | `67 74 63` |
| `text-muted` | `151 158 148` | `72 80 68` |
| `border-structure` | `77 84 74` | `139 153 133` |
| `border-default` | `58 62 56` | `179 188 174` |
| `border-subtle` | `35 37 34` | `213 218 211` |
| `accent-active` / `border-focus` | `145 196 100` | `52 91 37` |
| `accent-dim` | `102 139 75` | `100 129 86` |
| `on-accent` | `15 17 14` | `244 247 243` |
| `danger` | `224 133 123` | `136 42 32` |
| `warning` | `212 174 84` | `104 77 13` |
| `info` | `114 165 202` | `33 75 105` |

`on-accent` is the foreground for **both** accent and danger fills. It works for both because in
day both fills are dark and at night both are light.

### Contrast

Every text token clears **4.5:1 on all four surfaces in both modes** — including `surface-3`,
which is where selected rows put text and where the naive ramp fails first. Re-verify with the
ratio check whenever a value moves; "close enough" is how muted grey text ships unreadable.

Two vocabularies point at these same values: the Tailwind names components use
(`surface-*`, `text-*`, `border-*`, `accent-*`) and the shadcn names (`primary`, `muted`, `ring`,
`border`, …). Both are declared in `canvas/tailwind.config.ts`. Keep it that way — when only half
was declared, `bg-muted`, `bg-primary`, `border-border` and `ring-ring` compiled to nothing
across ~124 call sites, which is why hovers and focus rings silently did not exist.

## Ink weight

Line weight is heavier on structure and lighter on ground clutter — the same hierarchy the map
art uses. Weight is carried by **colour, not thickness**; 2px accent borders are not a tool here.

| Level | Token | Used on |
|---|---|---|
| Structure | `border-structure` | Panel frames, floating surfaces (menus, popovers, pickers), region separators |
| Control | `border-default` | Buttons, inputs, chips, toggles |
| Clutter | `border-subtle` | List dividers, row separators |

## Grain

`.gg-grain` blends a fine SVG turbulence into the element's own background via
`background-blend-mode: multiply`. It is **day only** — a lightening blend on a near-black panel
does not read as paper tooth, it reads as dirt on the screen.

It must never be a pseudo-element overlay: that lays a veil over every label in the panel.

## Hover

Mode-dependent by design, via `.gg-row`:

- **Day** — a flat accent tint.
- **Night** — light rising from below (`--hover-glow`).

Glow only works on a dark ground; on paper it looks like a printing error.

## State encoding

With a green accent, `success` and `accent-active` are the same hue. Fighting that would be worse
than accepting it, since green already means "fine" to everyone. So **presence never leans on
hue** — it leans on shape:

- filled disc — connected / here
- hollow ring — away, reconnecting
- triangle — lost the table

This is what preserves the Achromatic Shell's original guarantee, and it survives a bad panel in
a dim room, colour-blind or not.

Selection is a **raised surface** (`surface-3`), never an accent side-stripe. Coloured left
borders on rows are banned.

## Type

| Role | Family | Notes |
|---|---|---|
| UI text | IBM Plex Sans | Humanist and legible at the 10–12px authoring density the property panels run at |
| Panel & section headers | Newsreader | Old-style ink traps and optical sizing, so headers read as *set*, not as bigger body text |
| Numerals | IBM Plex Mono | Coordinates, latency, zoom — tabular figures so ticking numbers do not jitter |

Fixed rem scale, not fluid: users view product UI at consistent DPI, and a heading that shrinks
inside a sidebar looks worse, not better.

**Open:** the canvas loads these from the Google Fonts CDN while the table deliberately refuses
webfonts so a live session never waits on a CDN. Right now the two apps can render in different
faces. Resolve by self-hosting one shared text face for both.

## Motion

150–250ms on state transitions, ease-out (`cubic-bezier(0.16, 1, 0.3, 1)` — the `settle` token).
No bounce, no elastic. Motion conveys state; it is not decoration.

The one slow dramatic exception is the fog reveal, which is a play beat, not UI.
`prefers-reduced-motion` is honoured on every animation — reveals become instant cuts.

## Release checklist

1. Night is the default; day is reachable and fully styled, not an inversion.
2. Count the green on screen. Active tool, selection, primary action, live state — anything else
   green is a bug.
3. Surfaces read as tinted grey, not as a colour.
4. Every text token clears 4.5:1 on all four surfaces, both modes.
5. Panel frames, controls and dividers use three distinct ink weights.
6. No accent side-stripes; selection is a surface.
7. State reads without colour — shape carries presence.
8. Grain is present in day and absent at night.
9. Focus rings are visible on every interactive element (they compile — check the built CSS, not
   just the class name).
10. `prefers-reduced-motion` honoured.
