# Token-vision fog of war — the complete plan (S3 "fog/vision" landing)

Status: DRAFT v2 — awaiting approval. Nothing here is built.
v2 incorporates the DM-control decisions: dual memory model, partial reveals, auto-explore
as a DM choice with map parameters, party/individual vision, and DM-linked token sight.

## The product statement

A claimed token with `sight.range = 6` (world units = grid cells; 30 ft) sees what is
within range *and* in line of sight — walls and closed doors occlude — *and* lit: by the
scene's ambient light level, or by a light source (placed, or carried by a token).
Darkvision is a separate stat: it sees unlit space within its own range. Everything about
what the table experiences stays a DM decision: the fog mode, what auto-explores, what is
revealed by hand, how much of a room, whose sight counts, and who shares it. The DM's own
canvas never masks anything (principle 3). Redaction stays server-enforced (the Owlbear
anti-reference): nothing secret ever reaches a client to be "masked" there.

## What already exists (why this is buildable)

- `Token.sight: { range, angle, visionMode: 'normal' | 'darkvision' } | null` and
  `Token.light: { dim, bright, color, angle } | null` — already in the schema
  (`packages/mechanics/src/tokens/types.ts:31`), panel section "Sight & light (S3)"
  already stubbed. This feature was provisioned for.
- `clockwiseSweep` (shadowcasting with radius clamp) + `SegmentQuadtree` +
  `extractWallSegments` + per-source dirty-tracked shadow cache — all live in
  `packages/core/src/engine/lighting/`, pure math, reusable client- and server-side.
- Rooms, doors (with live state), zones (schema 3.1), lighting, ambientLight in
  mapSettings, the D5 reveal-delta pipeline, room redaction, `__fogProbe`, the ring-tree
  mask, and the sprint3 e2e harness — all carry over.

## Core model

### Fog modes (per scene, DM-set)

`SceneFog.mode: 'rooms' | 'vision'`. `'rooms'` is exactly today's behaviour — nothing in
this plan changes it. `'vision'` activates everything below. Default `'rooms'`; the DM
flips it per scene in the fog panel.

### Sight memory: rooms AND regions, DM-controlled

Two records, kept simultaneously; the DM chooses per scene which one drives presentation:

- **Room record** (exists today): Unrevealed / Revealed / Explored per room. Stays the
  unit of *geometry shipping*: a room ships to players when any part of it has been
  legitimately seen or DM-revealed. This is the server-truth redaction boundary.
- **Region record** (new): a per-scene grid bitmask of cells the party's sight has swept
  (resolution: one bit per grid cell; half-cell if the look demands it). Accumulated
  server-side from the same sweeps that drive visibility, persisted in module state
  (bytes, not textures), unioned with trivial ORs. This is the unit of *presentation
  memory*: with region memory on, a half-explored room renders its seen half as memory
  and its unseen half as void.

**DM partial reveals**: in vision mode the DM can reveal *less than a room* — a fog brush
on the DM overlay paints reveal/hide directly into the region record (cells), alongside
the existing per-room buttons (which set whole rooms, as today). Reveal-all / hide-all /
starting-room keep their semantics in both modes.

**Trust boundary, stated honestly**: region memory masks client-side *within* a shipped
room. The floor tiles of an unseen half-room are therefore client-held but masked —
acceptable because geometry is low-secret; everything actually secret in a room
(tokens, prep, zone triggers, secret doors, props flagged hidden) is entity-level and
stays server-filtered exactly as today. If we ever decide half-room *geometry* is secret
(e.g. interior walls), the escalation path is server-side clipping of the shipped
document to the region — recorded here as a non-goal, revisit if a real map needs it.

### Visibility (what a player sees right now)

Union over the sight sources the viewer is entitled to (see sharing, below), each source
contributing `clockwiseSweep(origin, sight.range, walls + closed doors)` clipped by the
light test:

- **Normal vision**: the swept area ∩ (ambient-lit ∪ light-source-lit). Scene gains an
  `ambientLightLevel` dial (darkness slider, DM-set, per scene — the existing
  `ambientLight` colour stays the *tint*, this is the *gate*): above the bright
  threshold, everything in sweep range is lit (daylight — vision is purely geometric);
  below it, only light-source coverage counts. Light sources = placed lights (exist) +
  token-carried lights (`Token.light`, new) — both already/naturally feed LightManager.
- **Darkvision**: additionally sees unlit swept area within `range`, rendered through a
  desaturated treatment (art-style-guide gates the look; impeccable pass on it).
- Dim light (light's `dim` vs `bright` radii) renders dimmer but counts as lit — v1 keeps
  the rule binary (lit/unlit) and dim is presentation only.

### Vision sharing (DM-set, because it matters)

Per-scene (or session) setting `visionShare: 'party' | 'individual'`:

- **party**: every player's mask is the union of *all* claimed tokens' sight; one shared
  region record. Cheapest, matches most tables, ships first.
- **individual**: each viewer sees through their *own* claimed tokens only; region memory
  becomes per-identity. More state, real redaction differences per viewer (token
  filtering diverges per player).

**Sight links**: the DM can link tokens (settings on the token / a link-group UI): linked
tokens share live vision both ways regardless of the share mode — a familiar, a scout, a
shared-senses spell. A link group acts as one compound sight source for every owner of
any token in it. Links are DM-only to create/remove.

### Auto-explore (DM choice + map parameters)

- Per-scene toggle `autoExplore: on | off` (DM): when on, sight writes the room and
  region records as tokens move — the map explores itself. When off, sight limits
  *current* visibility but writes nothing; exploration stays whatever the DM reveals by
  hand.
- **Explore locks**: the DM can mark areas exempt from auto-explore (a curtained vault, a
  boss room saved for the dramatic reveal). Authoring surface: zones — a zone flag
  `blocksAutoExplore` (zones + prep authoring already shipped in schema 3.1, so this is a
  flag and a check, not a new editor tool). Sight into a locked area shows nothing until
  the DM reveals it by hand; locks beat sweeps by construction, server-side.

### Token redaction by vision (the real new secret)

Non-DM viewers receive only: their own claimed tokens; tokens inside their entitled
sight (range + LOS + light rules, link groups included); and nothing else — re-evaluated
on token move and door toggle in the existing `Broadcaster`/`buildRedactor` seam. Hidden
tokens stay DM-only as today. The wire test for this is the integration.test byte-search
pattern: script a session, search every frame a viewer receives for token ids they have
not earned.

## Performance discipline (the "no rendering issues" contract)

- Sweeps recompute **only on change** (token move, door toggle, light change, fog write),
  per-source dirty tracking — the LightManager pattern generalised to sight sources; the
  mask stays build-on-mutation, draw-per-frame (today's contract, kept).
- Quadtree culling bounds every sweep; segments extracted once per geometry change.
- Region memory renders from the bitmask as batched cell geometry with the existing
  feather — rebuilt only when the bitmask changes, cacheable as a texture if profiling
  says so (the Sprint-4 mask-cache idea has a natural home here).
- Server: bitmask ORs are trivial; per-move LOS checks are one sweep per moved token
  (cached) plus point-in-polygon per candidate token.
- Budgets, e2e-pinned on the gate map: 8 claimed tokens < 2 ms mask rebuild; 60 fps held
  through a mid-drag sweep (extends the existing fps row); no per-frame geometry, no
  filters.
  ADJUDICATED at the P6 gate (2026-08-15): 60 fps mid-drag is MET outright (60.1 vs
  60.1 against the DM control, dark included). The 2 ms rebuild target is not
  reachable with Clipper booleans in the loop — measured floor after the memo work is
  ~12 ms median / ~10.5 ms fastest step on the gate map (was ~34 ms), dominated by
  four boolean ops over ~1600 offset-sweep vertices; vertex thinning was tried and
  rejected (8% for 4.6 sq cells of accuracy). Pinned gate bounds: ≤30 ms median +
  ≤20 ms fastest step (dual bound because box load swings the median on identical
  code). The path to ~2 ms is a raster/composited mask — its own phase, tracked as
  a follow-up, not a gate item.

## DM controls summary (everything stays with the DM)

Fog panel: mode (Rooms / Token vision), auto-explore toggle, vision share
(party/individual), per-room reveal/hide (as today), reveal-all/hide-all/conceal (as
today), fog brush for partial reveals. Token panel: sight range, vision mode
(normal/darkvision), light (dim/bright/color), link management. Scene: ambient light
level dial. Zones: `blocksAutoExplore` flag. HostSetup: unchanged. Every fork with real
UI surface (fog brush, link UI, darkness dial placement) goes through mockup options
before build, per workflow.

## Phases (each ships green; all behind `mode: 'vision'` until the gate)

- **P1 — mechanics + server truth**: mode/share/autoExplore fields + commands; sweep
  service shared client/server; region bitmask record; party-mode auto-explore; explore
  locks; token redaction by vision; unit + wire tests.
- **P2 — client mask**: vision-mode FogRenderer layer (sweep union + region memory +
  void), dirty-tracked sweeps, probe extensions, perf budget tests.
- **P3 — light model**: ambient level dial, light-gated normal vision, token-carried
  light, darkvision treatment (impeccable on the look).
- **P4 — DM controls**: panel UI live (mockups first), fog brush, link groups (party
  share mode).
- **P5 — individual vision**: per-identity region records + per-viewer redaction
  divergence; link groups across share modes.
- **P6 — gate**: e2e spec (30 ft honoured; wall blocks; door opens → vision extends live
  across two contexts; darkvision in an unlit room; ambient dial flips visibility; locked
  zone resists auto-explore; partial reveal renders half a room; token-position
  redaction; fps mid-drag), full suites, Docker + browser walk on the dressed map.

## Non-goals (v1)

Vision cones (`sight.angle` — schema ready, UI later), server-side geometry clipping to
regions (escalation path only), DM-seat masking (never), animated fog treatment (separate
track), dim-light mechanical effects beyond presentation.
