# Shortcut standard proposal — canvas + table

Status: PROPOSED 2026-08-27, awaiting approval. No code changed.

## Principles

1. **Follow the donor tools people already know.** Photoshop/Figma own editing muscle memory (B brush, E eraser, T text, V select, H hand, Space-pan, brackets = brush size, Shift = constrain, Alt = from-center). VTT convention (Foundry-style) owns the table (Esc backs out layer by layer, `/` talks to chat). Roll20/D&D Beyond have almost no shortcuts worth copying.
2. **Same function → same key on both surfaces.** Doors D, Lights L, Brush B, zoom keys, Esc ladder.
3. **One key, one meaning per surface.** Context-scoped overrides (node edit, brush size) are fine because they're modal and innermost-first — that ladder already works and stays.
4. **Break muscle memory now, not after release.** Pre-release (web release is S6) is the only cheap time to do this.

## The changes

### Canvas — renames

| Function | Today | Proposed | Why |
|---|---|---|---|
| Pan (hand) | `G` | `H`, plus **hold-Space to pan** with any tool | H = hand in Photoshop/Figma; Space-pan is the single biggest convention gap we have. `G` retired. |
| Terrain brush | `T` | `B` | B = brush in Photoshop. Also gives cross-surface parity: table fog **b**rush is already B. |
| Label / text | `N` | `T` | T = text in Photoshop/Figma. `N` freed on canvas. |
| Regular polygon | `H` | `O` | H is taken by hand. O = Figma's shape/ellipse slot, the nearest analog; nothing else uses O. |

### Canvas — additions

| Keys | Function | Why |
|---|---|---|
| `Space` (hold) + drag | Pan with any tool | Universal in PS/Figma/Foundry. Middle-drag stays too. |
| `[` `]` | Brush size down/up (Terrain, Stamp/Scatter) | Photoshop brackets. No clash with node-edit `[` `]` (stone rotate) — that's modal and claims keys first, same as today. |
| `+` `-` | Zoom in/out about center | Parity with table, keyboard-only zoom (a11y). Node-edit `-`/`=` stone scale still wins while a stone is selected — same modal rule as arrows. |
| `Ctrl+A` | Select all (children on visible, unlocked layers) | Universal; currently falls through to the browser. |

### Canvas — unchanged on purpose

- `V R P A W D L Z M E X C`, all Ctrl combos, Shift+H/V flips (Figma), arrows nudge, Alt = from-center, Shift = constrain/15°, Ctrl = invert snap, the Esc/Delete ladders, all three node-edit key tables.
- `Z` stays Zone, not Photoshop zoom — zones are a real GG tool, a zoom tool isn't, and wheel/`+`/`-`/Ctrl+0 cover zoom fully.
- `M` stays Measure (Photoshop's M-marquee has no analog here; measure is the mnemonic).

### Table — changes

| Function | Today | Proposed | Why |
|---|---|---|---|
| Log drawer | `L` (players only; DM's L opens Lights) | `J` for every role | Kills the role-dependent meaning of L. L = Lights (DM), J = journal/log, both roles. |
| Fit map | `0` | `0` and `Ctrl+0` | Ctrl+0 is what canvas trains; keep bare 0 as the table alias. |
| Fog brush size | — | `[` `]` while a fog tool is armed | Same brackets as canvas brushes. |

Unchanged: `M T D I F S W G` panels, `R/H/B` fog (DM), `N` next turn, `/` composer, `Shift+D` diagnostics, Esc ladder, drag/wheel camera, `+`/`-` zoom.

### Cross-surface parity after the change

| Function | Canvas | Table |
|---|---|---|
| Doors | `D` | `D` |
| Lights | `L` | `L` (DM) |
| Brush | `B` terrain | `B` fog (DM) |
| Brush size | `[` `]` | `[` `]` |
| Zoom | wheel, `+` `-`, `Ctrl+0` | wheel, `+` `-`, `Ctrl+0`/`0` |
| Pan | Space/mid-drag, `H` tool | drag (always) |
| Back out | Esc, innermost-first | Esc, innermost-first |

Note the intentional asymmetries: table `H` = fog hide (DM) vs canvas `H` = hand — acceptable because the table needs no hand tool (drag always pans). Table `T` = Tokens vs canvas `T` = text — different domains, both are the convention for their surface.

## Open decisions (need a call)

1. **Table `M` = Me panel** blocks a future table measure tool from matching canvas `M`. Option: move Me → `C` (character) now and reserve M. Or defer until a table ruler exists. Recommendation: defer — don't rename ahead of a tool that isn't built.
2. **Retire `G` outright vs keep as silent alias for pan.** Recommendation: retire — one standard, no ghosts; nothing shipped yet.

## Implementation sketch (after approval)

- `canvas/src/shortcuts/defaultShortcuts.ts` — remap G/T/N/H → H/B/T/O, add Ctrl+A, `+`/`-` zoom entries, update the `createDefaultShortcuts()` reference list (feeds the `?` dialog).
- `canvas/src/canvas/useCanvasInput.ts` — hold-Space pan (keydown/keyup, cursor swap, suppress while typing), `[` `]` → brush-size for terrain/scatter settings.
- `session/client/src/shell/hotkeys.ts` — Log `L`→`J`; `session/client/src/renderer/cameraInput.ts` — accept Ctrl+0; fog brush brackets in the fog module.
- Toolbar tooltips/popovers showing the letters; tests touching remapped keys; regenerate `docs/goblin-keys-cheatsheet.html` + artifact.
