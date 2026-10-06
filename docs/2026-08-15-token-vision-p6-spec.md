# P6 spec — token-vision fog: the gate

Parent plan: `docs/2026-08-15-token-vision-fog-plan.md` §Phases P6. Prereqs: P1-P5 all
committed (HEAD 8b86133). Baselines: mechanics 338, server 215, client unit 413,
core 1007, canvas 261, typecheck 7/7, sprint3 e2e 28 rows (fog 10 + vision 12 +
share 6). The gate is
where the plan's budgets stop being ponytail notes and start being pinned assertions,
and where the sprint-verification rule applies: Docker-deployed e2e walked in a real
browser on a fully-dressed demo map, zero console/network errors.

## Gate checklist → coverage map (from the plan)

| Plan gate item | Already covered by | P6 work |
|---|---|---|
| 30 ft honored | vision row 11 + unit | — |
| Wall blocks sight | rows 11/13 + unit | — |
| Door opens → vision extends live, two contexts | row 12 | — |
| Darkvision in an unlit room | row 18 | — |
| Ambient dial flips visibility | row 19 | — |
| Locked zone resists auto-explore | server unit only | NEW e2e row |
| Partial reveal renders half a room | rows 14/21 | — |
| Token-position redaction | wire tests only | NEW e2e dump row (sprint3-fog §2.6 pattern) |
| fps mid-drag + rebuild budget | row 16 (generous <16ms, two-room map) | GATE MAP row with the real budgets |

## 1. Perf work first (the named ponytail upgrades, now due)

The P2/P3 ponytails measured `visionRegion` at ~8-9ms (11-14 Clipper calls) on the
TWO-ROOM map; the gate map (Emberhold Crypt, 13 rooms) will be worse, and the plan
pins **<2ms mask rebuild with 8 sighted tokens** and **60fps held mid-drag**. Do the
named upgrades before pinning:

- Memoize the `held` and revealed-room reaches on the identity of the room set + fog
  slice (they only change when the map or the room record does — the P2 ponytail
  names exactly this).
- Reuse per-source polygons across rebuilds (already memoized) and cache the
  region-rects union on region identity (the FogOverlay cache pattern, applied in
  `visionRegion`'s input prep).
- Profile on the gate map BEFORE and AFTER (probe `lastRebuildMs`, median of a
  scripted drag); if <2ms is genuinely unreachable with Clipper in the loop, STOP and
  report the measured floor with the breakdown — the budget line moves only with an
  honest number attached, not silently.

## 2. Gate e2e (new spec file, e.g. e2e/sprint3-vision-gate.spec.ts, same config)

Runs on the DRESSED map (`session/testdata/emberhold-crypt.mapbuilder`, the GATE
fixture in table.ts). Setup: DM flips vision mode, places/claims 8 sighted tokens
(mix of ranges, one darkvision, one carried torch), ambient darkness on at least one
row. Rows:

1. Locked zone resists auto-explore: mark a zone `blocksAutoExplore` (the fixture may
   need the flag authored into a zone — edit the testdata file), party walks past it,
   assert the locked room stays void on the player seat and unlatched in the DM's fog
   slice; DM manual reveal still works.
2. Token-position redaction dump (the sprint3-fog §2.6 memory-dump pattern): player
   loads a vision-mode session mid-fight; byte-search the loaded state for every
   token id outside their entitlement; positive control included.
3. The budget row: 8 sighted tokens + fog mask on the player seat — `lastRebuildMs`
   median over a scripted mid-drag ≤ the §1 outcome (target 2ms), fps ratio vs DM
   control ≥ the sprint3-fog row's bar, mid-drag. `[metric]` log lines in the
   existing style.
4. A no-page-errors row over the whole walk (the dressed map draws with vision mode
   on, zero console errors — the sprint3-fog row 5 pattern).

## 3. Full-suite gate

Everything green, real numbers, no flake-rounding: mechanics, server, client unit,
core, canvas, typecheck, FULL sprint3 e2e (fog 10 + vision 12+ + gate rows), plus
the time-weather config (env selects were touched in P3).

## 4. Docker + browser walk (the sprint-exit rule)

- Rebuild the Docker images at the gate commit; deploy the compose stack (host port
  lane 562x per the port-lanes memory); seed the dressed demo campaign.
- Live browser-automation walk on the DEPLOYED stack (not the dev server), per the
  canvas-table-check skill: DM seat + player seat side by side. Walk: host → flip
  vision mode → claim tokens → move (sweep follows, walls occlude) → door toggle
  (both seats live) → darkness + torch → darkvision look (screenshot, judge vs
  art-style-guide) → brush a partial reveal → lock a zone in the editor and verify
  it resists → sight-link a familiar → share flip party↔individual with two player
  seats → reload persistence. Zero console errors, zero failed network requests
  (filtered reads per the skill).
- Screenshots at each station; final judgment against the approved mockups and
  docs/art-style-guide.md.
- Gate report written to docs/ (untracked as always): checklist verdicts, metrics,
  screenshots referenced, known-misses tracked with issue-worthy notes (do NOT file
  issues — the user files/approves those).

## 5. Non-goals

New features of any kind; fixing pre-existing canvas e2e failures unrelated to fog
(the stale-spec backlog noted elsewhere); shipping/PR (user say-so).
