# P5 spec — token-vision fog: individual vision

Parent plan: `docs/2026-08-15-token-vision-fog-plan.md`. Prereqs: P1-P4 (35e7478 +
its findings-fix commit). P4's landed closure API:
`packages/mechanics/src/tokens/links.ts` — `claimed(t)`, `sightParty(tokens, isSeed =
claimed)` (BFS over sharesSightWith, hidden excluded and non-conducting),
`sightPartyIds(tokens, isSeed?)`. The per-viewer eye set below is
`sightParty(tokens, t => t.ownerId === viewer.identityId)` — the seed predicate
parameter exists for exactly this. Consumers already on the helper: sweep.ts
partyVision, vision.ts party rooms, tokens module inSight/redact, client
visionSight.sighted, FogRenderer partyRoomIds. Suite baselines (will be slightly
higher after the P4 findings-fix commit — read the suites' own output): mechanics
312+, server 202+, client unit 400+, core 1007, canvas 261+, typecheck 7/7, sprint3
e2e 22 rows (fog 10 + vision 12). This phase makes `visionShare: 'individual'` real: per-viewer live
sight, per-identity region memory, per-viewer token redaction. Party mode stays
byte-identical (it is the default and every existing test pins it).

## Adjudicated architecture (decided, not open)

- **Room record stays SHARED across viewers.** Geometry shipping is per-scene, not
  per-viewer, exactly as today: any viewer's auto-explore latches a room for everyone.
  Divergence is presentation + entity redaction, per the plan's stated trust boundary
  (geometry is low-secret; the region mask gates presentation client-side; entity
  secrets stay server-filtered). Per-viewer geometry clipping remains the recorded
  non-goal/escalation path. This keeps D5 deltas, sceneMap, and the reveal pipeline
  untouched.
- **Entitlement per viewer V** = transitive closure of V's claimed tokens over sight
  links (the P4 helper — ONE function, reused; hidden excluded inside it). V's live
  sight = union of sweeps of eyes(V), light-gated per P3 (eyes(V)'s carried lights +
  placed lights; darkvision per eye). This is the same seen() rule with a narrower
  eye set.
- **Region memory per identity**: in individual mode the fog scene keeps
  `regions?: Record<identityId, RegionMask>` beside the party `region`. Auto-explore
  writes cells seen by eyes(V) into V's record, for every V with a claimed token
  (connected or not — state-based). The DM brush (`region-set`) writes ALL current
  records + the party record (a DM reveal is for the table), unless/until a per-player
  brush is ever asked for (non-goal).
- **Share-mode switching merges, never destroys**: party → individual seeds each
  identity that owns a claimed token with a copy of the party record; individual →
  party ORs every identity record into the party record. Both directions keep the
  other side's data in place (switching back and forth loses nothing).
- **Redaction does the viewer mapping**: `fogModule.redact(state, viewer)` in
  individual mode replaces the `region` field with `regions[viewer.identityId]` (and
  strips `regions` — a player never sees another player's memory record). THE CLIENT
  MASK CODE DOES NOT CHANGE for memory — it keeps reading `region`. The DM keeps the
  full state (redact is identity for DMs).
- **Token redaction per viewer**: `SceneVision.canSee` becomes viewer-aware server-side
  — the server computes and caches a sweep union PER identity (same dirty conditions
  as the party union; cache keyed identity → polygons within the existing per-scene
  computed record). `tokensModule.redact` already receives the viewer; the injected
  vision supplies the right `canSee` for that viewer. Own claimed tokens + tokens in
  eyes(V) closure always visible, hidden stays DM-only — unchanged rules, narrower set.
- **Client live sight**: `visionSight`'s eye filter becomes share-aware: party mode =
  all claimed (closure), individual = closure of tokens claimed by `you.identityId`.
  One predicate change; everything downstream (lights, night, drained) already keys
  off the eye set.

## Scope of changes (expected small — the machinery exists)

- mechanics fog: `regions` field + share-switch merge in `set-share`; redact viewer
  mapping; region-set writes all records in individual mode; auto-explore payload
  gains per-identity cell sets (the internal `auto-explore` command carries
  `{ rooms, cells }` today — it grows a per-identity shape; keep the party shape
  working unchanged).
- server vision.ts/sweep.ts: per-identity eye assembly + sweep-union cache +
  per-identity autoExplorePatch in individual mode; `visionOf` returns viewer-aware
  canSee (plumb the viewer from the redaction call path — check how Broadcaster
  passes viewer into module redaction and extend the injected SceneVision seam,
  NOT the Broadcaster itself, if possible).
- client visionSight: the share-aware eye predicate. Nothing else client-side.
- e2e: the two-seat divergence row (the approved P5 mockup sketch): two players,
  different claims; player A's mask shows their hall, player B sees through a linked
  familiar into a room A has never lit; each seat's wire lacks the tokens only the
  other is entitled to (byte-search both directions); a reload preserves each seat's
  own memory; flipping share individual→party live merges the masks on both seats.

## Tests (phase gate)

- Mechanics: regions field additive-load; set-share merges both directions
  (party→individual seeding, individual→party OR, nothing destroyed); redact maps
  own record + strips others (byte-level: another identity's id never in a player's
  fog slice); region-set writes all records in individual mode; auto-explore
  per-identity writes.
- Server: two-identity fixture — each identity's record accrues only what its eyes
  saw; linked token feeds both linkees' records; wire test both directions (A never
  receives B-only tokens AND B never receives A-only tokens, raw byte search);
  share-flip mid-session behaves per the merge rules; party mode untouched (existing
  36 vision-mode rows unmodified).
- Client unit: the share-aware eye predicate (individual = own+linked only).
- Full gate: all suites + typecheck + FULL sprint3 e2e (existing 20 rows + the new
  divergence row(s)) green, exact numbers, falsifiability on the redact mapping
  (revert → wire test fails).

## Non-goals (P5)

Per-viewer geometry clipping; per-player DM brush targeting; DM UI for inspecting a
specific player's memory (backlog); spectate-as-player view; per-identity room
records.
