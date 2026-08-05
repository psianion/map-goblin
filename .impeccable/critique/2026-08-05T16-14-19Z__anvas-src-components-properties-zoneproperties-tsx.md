---
target: M2 zones + triggers authoring UI
total_score: 17
p0_count: 3
p1_count: 1
timestamp: 2026-08-05T16-14-19Z
slug: anvas-src-components-properties-zoneproperties-tsx
---
Method: dual-agent (A: design review sub-agent · B: detector sub-agent)

# Critique — Zones + Triggers authoring UI (M2, worktree-zones-prep @ 6076214)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Trigger/action edits and deletes commit silently; no undo-stack visibility unlike door/light edits |
| 2 | Match System / Real World | 1 | Raw enums shown as labels: `ENTER-REGION`, `ABILITY-CHECK` (ZoneProperties.tsx:239, :357) |
| 3 | User Control and Freedom | 1 | Trigger delete is one-click, permanent, outside the undo stack (prep.ts:9-11) |
| 4 | Consistency and Standards | 1 | Two label systems in one file; captioned vs uncaptioned split at the zone/trigger boundary; button vs self-resetting select for the same "add" semantic |
| 5 | Error Prevention | 2 | Dice-format validation good; no prevention on trigger delete |
| 6 | Recognition Rather Than Recall | 2 | Unlabeled enabled-toggle on collapsed rows |
| 7 | Flexibility and Efficiency | 2 | No duplicate-trigger, no keyboard path to add-action |
| 8 | Aesthetic and Minimalist Design | 2 | Uncaptioned action bodies read sparse-on-information |
| 9 | Error Recovery | 2 | Two different warning styles for equivalent severity (:205 chip vs :397 plain text) |
| 10 | Help and Documentation | 2 | "Not inside a room" badge never says what breaks downstream |
| **Total** | | **17/40** | **Poor–Acceptable boundary; core shell native, trigger editor unfinished** |

## Anti-Patterns Verdict

LLM assessment: outer shell (header, Name/Shape via PropertyField) is native to the DoorProperties idiom; everything below "Triggers" reads bolted-on — raw enum labels, uncaptioned fields, two label systems, self-resetting select. Overlay colours are off-brand: MUTED 0x94a3b8 is stock slate-400 (blue against a moss-green neutral ramp), ACCENT 0x6c63ff is the generic unDraw/template violet, not either theme's accent (#345b25 day / #91c464 night). Accent *placement* rule (selected-only) is respected; the hue itself is foreign.

Deterministic scan: clean — 0 findings on all five files (file-list and directory invocations, exit 0). Greps: no #hex in TSX, no border-stripe accents, no gradient text, no z-index magic. Two 0x-hex Pixi constants (established sibling convention, but values off-palette per A), one static inline style (LeftToolbar.tsx:186). Browser visualization skipped: no dev server; surface needs multi-step canvas interaction; live inspection scheduled in the milestone's manual browser gate.

Where they agree: both flag the overlay hexes. Detector caught nothing A missed; A caught copy/caption/undo issues the detector cannot see.

## Priority Issues

- **[P0] Raw enum labels** — ZoneProperties.tsx:239/:357 render `when.kind`/`action.kind` verbatim; the label maps already exist in-file. Fix: lookup CONDITION_OPTIONS/ACTION_KIND_OPTIONS.
- **[P0] Unguarded permanent trigger delete** — outside undo stack, no confirm. Fix: two-step inline confirm now; wrap prep edits in Commands later.
- **[P0-brand] Overlay palette foreign to moss chrome** — replace 0x94a3b8→0x979e94 (--text-muted), 0x6c63ff→0x91c464 (--accent-active night).
- **[P1] Uncaptioned/inaccessible action fields** — no PropertyField wraps, no aria-labels on ability/DC/prompt/time/weather/light controls.
- **[P2] Warning-style inconsistency** — chip vs plain text for equivalent severity.
- **[P2] No trigger-count on zone rows in the layer tree** — can't tell armed zones from empty ones.
- **[P3] "Add action" self-resetting select** vs "Add trigger" button — same semantic, two affordances.

## Persona Red Flags

**Alex (power-user DM)**: will misclick trigger-delete while iterating fast and reach for Ctrl+Z, which silently does nothing — erodes trust in the whole undo system. No duplicate-trigger for authoring several similar traps.

**Jordan (first-time DM)**: stalls on unlabeled STR/DEX select over unlabeled number spinner; reads "ENTER-REGION" as a bug; never learns why "Not inside a room" matters until a trap silently never fires at the table.

## Minor Observations

- Crosshair icon fits point zones, mismatches circle/rect regions.
- fieldInputClass adds a fourth input padding/height combo (pre-existing fragmentation).
- "Remove action" aria-label doesn't name which action.
- Point marker draws solid while circle/rect idle are dashed — minor family inconsistency.
- Coordinate readouts (`Rect (12.00, 8.00) 4.00×3.00`) read as debug output; no unit.

## Questions to Consider

- Why is the highest-stakes prep content (traps) the one edit surface outside the undo stack?
- Does the trigger editor want a drawer once encounters land on ScenePrep v2, i.e. is the properties column already at capacity?
- Should the orphan badge teach ("this trigger can never fire") rather than state ("not inside a room")?
